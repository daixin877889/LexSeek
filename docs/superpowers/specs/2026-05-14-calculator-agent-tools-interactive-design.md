# 办案计算器 Agent 工具交互式接入设计

> 设计日期：2026-05-14
> 目标：把 10 个办案计算器接入到法律助手 Agent，信息充足直接算，信息不足在对话中弹出可编辑卡片让用户补全，结果统一展示并写入案件记忆。

## 1. 背景

[办案工具重构 PR3](2026-05-14-tools-refactor-design.md) 已经完成了 10 个 `*.tool.ts` 工具文件 + 类型定义 + 单测，但实际**没接通到 Agent**：

- `server/services/agent-platform/tools/index.ts` 的 `toolModules` 注册表没注册这 10 个工具
- DB `nodes.assistantMain.tools` 字段没挂载
- 所有"必填"参数 schema 都写了 `.default(0) / .default('shared')`，LLM 不传参也会用默认值算出垃圾结果（0 元赔偿金）

直接放进去会产生静默失败：LLM 拿到 0 元结果当真实数字回复用户。

## 2. 设计目标

- **零垃圾结果**：必填字段缺失时不允许"用 0 算出 0"
- **少追问**：LLM 反向追问每个字段对用户体验不友好；用 inline 卡片一次性收集
- **预填友好**：能从案件上下文自动抽到的字段直接预填，用户只填缺的
- **统一结果展示**：信息充足直算 vs 用户卡片提交，最终都进入同一种"结果卡片"
- **历史可追溯**：每次计算自动写入案件记忆，下次同案件再算时自动预填

## 3. 整体架构与数据流

### 3.1 完整数据流（3 条路径）

```
用户在法律助手问 "帮我算下我的赔偿金"
    ↓
caseContextSync 中间件（已有，自动）
    把 4 段案件上下文（基础信息 + 材料 + 分析 + 记忆）注入 HumanMessage
    ↓
LLM 看到上下文，决定调 calculate_compensation
    能从上下文抽到的参数（如 salary=12000）直接填入 tool call
    ↓
工具内部：
    ① ctx.caseId 查 case_memory 里 type='calculation' 同 toolName 历史 → memoryPrefill
    ② merged = { ...memoryPrefill, ...input }
    ③ checkRequired(merged) → missing 字段列表
    ↓
┌───────────────────────────────┬───────────────────────────────┐
│ 路径 A · missing 为空          │ 路径 B · missing 不为空       │
│ 信息充足直算                  │ 信息不足弹卡片                │
├───────────────────────────────┼───────────────────────────────┤
│ 直接调 service 算结果         │ interrupt() 暂停 graph        │
│   ↓                           │   { type, toolName, prefilled,│
│ 写入 case_memory              │     missing }                 │
│   ↓                           │   ↓                           │
│ return JSON 给 LLM            │ 前端 CalculatorTool 卡片输入态│
│                               │   ↓                           │
│                               │ ┌─ 提交 → 用 userInput resume │
│                               │ │           续走路径 A 后半段 │
│                               │ └─ 取消 → return cancelled    │
│                               │           跳到 LLM 衔接       │
└───────────────────────────────┴───────────────────────────────┘
    ↓
LLM 拿到 tool result（结果 / cancelled）继续对话
    ↓
前端 CalculatorTool 卡片切换为「结果态」（路径 A 和 B 路径汇合）
```

### 3.2 三层预填叠加

| 层 | 来源 | 时机 | 实现 |
|---|---|---|---|
| **L1** LLM 自动抽取 | 4 段案件上下文（caseContextSync 中间件注入到 prompt） | LLM 调工具时 | 已有，免费 |
| **L2** 工具兜底查询 | `case_memory` 里 type='calculation' 同 toolName 历史 | 工具内部 step ① | 新增 |
| **L3** 用户手填 | inline 卡片输入态 | 路径 B | 新增 |

合并优先级：**L3 > L2 > L1**（后者覆盖前者）。

## 4. 数据模型变更

### 4.1 InterruptType 枚举增量

文件：`shared/types/case.ts`

```typescript
export enum InterruptType {
    CASE_INFO_CHECK = 'case_info_check',
    BASIC_INFO_CONFIRM = 'basic_info_confirm',
    MODULE_SELECT = 'module_select',
    INSUFFICIENT_POINTS = 'insufficient_points',
    AWAITING_STANCE = 'awaiting_stance',
    /** 新增：办案计算器需要用户补全参数 */
    CALCULATOR_INPUT = 'calculator_input',
}
```

### 4.2 case_memory 表 type 字段增量

不需要 prisma schema 改动 — 现有 `caseMemories.type` 是 `String @db.VarChar(32)`（非枚举），追加新值即可。

文件：`shared/types/memory.ts`（新增枚举值）

```typescript
export enum CaseMemoryType {
    EXTRACTED = 'extracted',
    USER_NOTE = 'user_note',
    ANALYSIS = 'analysis',
    /** 新增：计算器历史 */
    CALCULATION = 'calculation',
}
```

`caseMemories.content` 字段（JSON）存储格式：

```typescript
{
    tool: 'calculate_compensation',      // 工具名
    input: { type: 'workInjury', salary: 12000, disabilityLevel: 8, ... },
    output: { totalCompensation: 132000, disabilityCompensation: 96000, ... },
    calculatedAt: '2026-05-14T19:30:00+08:00'
}
```

## 5. 文件结构

### 5.1 新建文件

```
shared/types/agentInterrupt.ts                                 # CalculatorInputInterruptPayload 类型（CALCULATOR_INPUT 携带的数据）
shared/utils/tools/agentTools/_fieldMetadata.ts                # 10 工具的字段元数据（前端表单渲染用）
server/services/memory/caseCalculation.service.ts              # case_memory 计算历史的读/写 service
app/components/ai/tools/CalculatorTool.vue                     # 通用计算器卡片（输入态 + 结果态）
app/components/ai/tools/CalculatorFormFields.vue               # 动态表单（按 toolName + 分支切换字段集）
app/components/ai/tools/CalculatorResultSummary.vue            # 结果摘要 row 渲染（按 toolName 切换字段）
app/components/ai/tools/CalculatorResultDetails.vue            # 复杂结果展示（分段表格 / 多 Accordion）
tests/server/services/memory/caseCalculation.service.test.ts
tests/server/agents/legal-assistant/calculator-tools.e2e.test.ts
```

### 5.2 修改文件

```
shared/types/case.ts                                           # 加 InterruptType.CALCULATOR_INPUT
shared/types/memory.ts                                         # 加 CaseMemoryType.CALCULATION
shared/utils/tools/agentTools/*.tool.ts (10 个)                # 每个工具加 interrupt + 必填校验 + 写记忆
server/services/agent-platform/tools/index.ts                  # toolModules 注册 10 个 calculate_*
app/components/ai/AiToolRenderer.vue                           # INTERNAL_TOOL_MAP 映射 10 个 calculate_* → CalculatorTool
prisma/seeds/seedData.sql                                      # nodes.assistantMain.tools 字段追加 10 个工具名
```

## 6. 后端工具改造模板

每个 `*.tool.ts` 都走以下模式（以 compensation 为例）：

```typescript
// shared/utils/tools/agentTools/compensationCalculator.tool.ts
import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { interrupt } from '@langchain/langgraph'
import { InterruptType } from '#shared/types/case'
import type { ToolModule, ToolContext } from '#shared/types/agentTools'
import {
    calculateWorkInjuryCompensation,
    calculateTrafficAccidentCompensation,
    calculateDeathCompensation,
} from '#shared/utils/tools/compensationService'
import {
    fetchCaseCalculationContextService,
    writeCaseCalculationService,
} from '~~/server/services/memory/caseCalculation.service'

// schema 取消 .default()，必填字段改 .optional() 让工具内部主动校验
const schema = z.object({
    type: z.enum(['workInjury', 'trafficAccident', 'death']),
    salary: z.number().min(0).optional(),
    disabilityLevel: z.number().int().min(1).max(10).optional(),
    medicalExpenses: z.number().min(0).optional(),
    // ... 其他字段
})

// 按 type 分支声明哪些字段必填
const REQUIRED_FIELDS: Record<string, string[]> = {
    workInjury: ['salary', 'disabilityLevel'],
    trafficAccident: ['medicalExpenses', 'disabilityCompensation'],
    death: ['annualIncome'],
}

export const compensationCalculatorTool: ToolModule = {
    toolDefinition: {
        name: 'calculate_compensation',
        description: '赔偿金计算：支持工伤/交通事故/死亡 3 种场景。当必填字段缺失时会通过 interrupt 让用户在 inline 卡片补全，禁止使用 0 或默认值替代真实数据。',
        schema,
    },
    createTool: (ctx: ToolContext) =>
        tool(async (input) => {
            // ① 兜底查 case_memory
            const memoryPrefill = ctx.caseId
                ? await fetchCaseCalculationContextService(ctx.caseId, 'calculate_compensation')
                : {}
            let merged = { ...memoryPrefill, ...input }

            // ② 必填校验
            const required = REQUIRED_FIELDS[merged.type] ?? []
            const missing = required.filter(
                (f) => merged[f] === undefined || merged[f] === null || merged[f] === '',
            )

            // ③ 信息不足 → interrupt
            if (missing.length > 0) {
                const userInput = interrupt({
                    type: InterruptType.CALCULATOR_INPUT,
                    toolName: 'calculate_compensation',
                    prefilled: merged,
                    missing,
                })
                // 用户取消
                if (userInput?.cancelled) {
                    return JSON.stringify({ cancelled: true, reason: '用户取消了本次计算' })
                }
                merged = { ...merged, ...userInput }
            }

            // ④ 调 service 算结果
            let result: unknown
            if (merged.type === 'workInjury') {
                result = calculateWorkInjuryCompensation(
                    merged.salary, merged.disabilityLevel, merged.medicalExpenses ?? 0,
                    merged.nursingExpenses ?? 0, merged.nutritionExpenses ?? 0,
                )
            } else if (merged.type === 'trafficAccident') {
                result = calculateTrafficAccidentCompensation(...)
            } else {
                result = calculateDeathCompensation(...)
            }

            // ⑤ 写入 case_memory
            if (ctx.caseId) {
                await writeCaseCalculationService({
                    caseId: ctx.caseId,
                    tool: 'calculate_compensation',
                    input: merged,
                    output: result,
                })
            }

            return JSON.stringify(result)
        }, { name: 'calculate_compensation', description: '...', schema }),
}
```

## 7. 7 个条件分支工具的分支策略

| 工具 | 分支字段 | 分支数 | UI 形式 | 子分支 |
|---|---|---|---|---|
| `calculate_compensation` | type | 3（工伤/车祸/死亡） | **Tab** | — |
| `calculate_court_fee` | feeTypeLevel1 | 2（受理费/申请费） | **Tab** | nonPropertyType（嵌套 Radio） |
| `calculate_lawyer_fee` | caseType | 6（民事/刑事/行政/商事/咨询/文书） | **Select** | — |
| `calculate_interest` | mode | 3（LPR/PBOC/简单） | **Tab** | — |
| `calculate_date` | mode | 6（加减天/月/年/工作日/法定期限/诉讼时效） | **Select** | — |
| `bank_rate_query` | queryType | 4（LPR/存款/贷款/全部） | **Tab** | — |
| `calculate_divorce_property` | childCustody | 单参数枚举 | **不切表单** | — |

**Tab vs Select 阈值**：分支 ≤ 4 用 Tab，≥ 5 用 Select。

**切换分支时同名字段保留值**（如 compensation 的 medicalExpenses 在 workInjury / trafficAccident 都有，切换不丢）。

## 8. 前端组件

### 8.1 CalculatorTool.vue（一个组件两态）

```vue
<template>
  <Confirmation :approval="approval" :state="confirmationState" class="w-full">
    <!-- 输入态：动态表单 -->
    <ConfirmationRequest v-if="needsInput">
      <ConfirmationTitle>{{ toolDisplayName }}</ConfirmationTitle>
      <p class="text-muted-foreground text-sm">{{ branchHint }}</p>

      <CalculatorFormFields
        :tool-name="toolName"
        :prefilled="prefilled"
        :missing="missing"
        v-model="formData"
        v-model:branch="selectedBranch"
      />

      <ConfirmationActions>
        <ConfirmationAction variant="outline" @click="onCancel">取消</ConfirmationAction>
        <ConfirmationAction @click="onSubmit" :disabled="!isValid">计算</ConfirmationAction>
      </ConfirmationActions>
    </ConfirmationRequest>

    <!-- 结果态：参考各工具页面完整明细 -->
    <ConfirmationAccepted v-else-if="output && !cancelled">
      <div class="space-y-3">
        <h3 class="font-semibold">✅ {{ toolDisplayName }}结果</h3>

        <!-- 摘要 row：所有 service 返回字段 -->
        <CalculatorResultSummary :tool-name="toolName" :input="input" :output="output" />

        <!-- 复杂结果：分段表格 / 多 Accordion -->
        <CalculatorResultDetails :tool-name="toolName" :output="output" />

        <Alert variant="success">
          ✓ 已自动保存到案件记忆，下次再算时会自动预填这些字段
        </Alert>
      </div>
    </ConfirmationAccepted>

    <!-- 取消态：保留卡片置灰 -->
    <ConfirmationRejected v-else>
      <p class="text-muted-foreground">⊘ 用户取消了本次计算输入</p>
    </ConfirmationRejected>
  </Confirmation>
</template>
```

### 8.2 _fieldMetadata.ts 字段元数据

把 10 个工具的字段定义提取为一份"前端表单 spec"，因为 zod schema 本身不能直接渲染表单（需要标签、单位、分支映射等额外元数据）：

```typescript
// shared/utils/tools/agentTools/_fieldMetadata.ts
export interface CalcFieldMeta {
    name: string
    label: string                       // 中文标签
    type: 'number' | 'text' | 'select' | 'date' | 'boolean'
    unit?: string                       // 单位（元 / 天 / %）
    required?: boolean                  // 必填（按分支动态判断时另用 requiredBy）
    requiredBy?: Record<string, boolean> // 按分支判 required，如 { workInjury: true }
    options?: Array<{ value: string; label: string }>  // select 选项
    placeholder?: string
}

export interface CalcToolMeta {
    toolName: string
    displayName: string
    branchField?: string                // 分支字段名（如 'type' / 'caseType' / 'mode'）
    branchOptions?: Array<{ value: string; label: string }>
    branchUiType?: 'tab' | 'select'     // 分支 ≤ 4 tab，≥ 5 select
    fields: CalcFieldMeta[]
    fieldsByBranch?: Record<string, string[]>  // 每个分支显示哪些字段
}

export const CALCULATOR_TOOL_META: Record<string, CalcToolMeta> = {
    calculate_compensation: {
        toolName: 'calculate_compensation',
        displayName: '赔偿金计算',
        branchField: 'type',
        branchOptions: [
            { value: 'workInjury', label: '工伤赔偿' },
            { value: 'trafficAccident', label: '交通事故' },
            { value: 'death', label: '死亡赔偿' },
        ],
        branchUiType: 'tab',
        fields: [
            { name: 'salary', label: '月工资', type: 'number', unit: '元', requiredBy: { workInjury: true } },
            { name: 'disabilityLevel', label: '伤残等级', type: 'select', options: [...], requiredBy: { workInjury: true } },
            { name: 'medicalExpenses', label: '医疗费用', type: 'number', unit: '元' },
            // ... 共约 15 个字段，按 fieldsByBranch 分组
        ],
        fieldsByBranch: {
            workInjury: ['salary', 'disabilityLevel', 'medicalExpenses', 'nursingExpenses', 'nutritionExpenses'],
            trafficAccident: ['medicalExpenses', 'disabilityCompensation', 'nursingExpenses', 'lostIncome', ...],
            death: ['annualIncome', 'deathCompensationYears', 'funeralExpenses', ...],
        },
    },
    // ... 其余 9 个工具
}
```

### 8.3 AiToolRenderer 注册

```typescript
// app/components/ai/AiToolRenderer.vue
const INTERNAL_TOOL_MAP: Record<string, Component> = {
    // ... 已有
    calculate_compensation: AiToolsCalculatorTool,
    calculate_interest: AiToolsCalculatorTool,
    calculate_delay_interest: AiToolsCalculatorTool,
    calculate_court_fee: AiToolsCalculatorTool,
    calculate_lawyer_fee: AiToolsCalculatorTool,
    calculate_overtime_pay: AiToolsCalculatorTool,
    calculate_social_insurance: AiToolsCalculatorTool,
    calculate_divorce_property: AiToolsCalculatorTool,
    calculate_date: AiToolsCalculatorTool,
    bank_rate_query: AiToolsCalculatorTool,
}
```

10 个工具复用同一个 CalculatorTool 组件，按 toolName 查 `CALCULATOR_TOOL_META` 动态渲染。

## 9. 案件记忆联动

### 9.1 写入

工具计算完成后立即写：

```typescript
await writeCaseCalculationService({
    caseId: ctx.caseId,
    tool: 'calculate_compensation',
    input: { type: 'workInjury', salary: 12000, disabilityLevel: 8 },
    output: { totalCompensation: 132000, ... },
})
// 内部转为：
// prisma.caseMemories.create({ data: {
//     caseId, type: 'calculation', source: 'calculator_tool',
//     content: { tool, input, output, calculatedAt: new Date().toISOString() }
// }})
```

### 9.2 读取（兜底预填）

工具开始时查最近一次同 toolName 的记录：

```typescript
async function fetchCaseCalculationContextService(
    caseId: number,
    tool: string,
): Promise<Record<string, unknown>> {
    const memory = await prisma.caseMemories.findFirst({
        where: {
            caseId,
            type: 'calculation',
            content: { path: ['tool'], equals: tool },  // Postgres JSONB 查询
        },
        orderBy: { createdAt: 'desc' },
    })
    return (memory?.content as any)?.input ?? {}
}
```

### 9.3 LLM 通过 search_case_memory 自然引用

`search_case_memory` 工具已存在。新增的 `type='calculation'` 记录会被它的语义搜索自然检索到，LLM 可以引用"案件之前算过 3 次利息"。

## 10. 错误处理与边界

| 场景 | 行为 |
|---|---|
| LLM 没传 type/mode 等分支字段 | zod 校验失败 → ToolError → LLM 重新规划（这里 type 是 enum 不带 default） |
| LLM 传了 type 但 missing 字段为空（其他都用了默认值） | 不会发生（其他字段都改 `.optional()` 不强制） |
| 工具内部检测 missing 不为空 | interrupt() 暂停 graph 弹卡片 |
| 用户在卡片点取消 | 工具返回 `{cancelled:true, reason:'...'}`，LLM 衔接 |
| 用户提交但带非法值（如负数）| 前端表单校验拦截，提交前不允许 |
| service 计算抛错 | catch 后返回 `{error: '...'}`，LLM 转化为友好回复 |
| 写入 case_memory 失败 | 不阻塞计算结果返回；记 logger.error |
| ctx.caseId 为空（通用问答场景） | 跳过 ① 兜底查询和 ⑤ 写入；其余流程不变 |

## 11. 测试策略

### 11.1 单元测试

- `caseCalculation.service.test.ts` — 写入 / 查最近一次的正确性
- 10 个 `*.tool.test.ts` 改造，覆盖：
  - 信息充足直算（mock case_memory 返回完整 prefill）
  - 信息不足 interrupt（assert 抛出 GraphInterrupt）
  - 取消处理（mock userInput = {cancelled:true}，assert 返回 cancelled）
  - 写入 case_memory（assert 调用 writeCaseCalculationService）

### 11.2 E2E 测试

`tests/server/agents/legal-assistant/calculator-tools.e2e.test.ts`：

- 路径 A：案件素材里有月工资，问"算工伤赔偿" → 工具直接返回结果 + case_memory 落库
- 路径 B：案件素材里没月工资，问"算工伤赔偿" → 工具触发 interrupt → resume 用户输入 → 返回结果
- 路径 C：interrupt 后传 `{cancelled:true}` → 工具返回 cancelled → LLM 给出衔接回复

### 11.3 浏览器手动测试

走查路径 A/B/C 各一遍，特别验证：
- 切换分支时同名字段保留
- 必填项灰按钮 → 填齐后激活
- 结果卡片显示完整 + 「已保存案件记忆」提示

## 12. 完成判定

- [ ] `server/services/agent-platform/tools/index.ts` 注册了 10 个 `calculate_*` 工具
- [ ] DB `nodes.assistantMain.tools` 字段含这 10 个工具名（seedData.sql 同步）
- [ ] RBAC：用户访问 assistant 接口时能正常调用工具（依赖现有 ASSISTANT scope 权限）
- [ ] 在浏览器法律助手里走通 3 条路径
- [ ] `tests/server/agents/legal-assistant/calculator-tools.e2e.test.ts` 全绿
- [ ] case_memory 真有 type='calculation' 记录生成
- [ ] LLM 通过 search_case_memory 能搜到历史计算

## 13. 不实施清单（YAGNI）

- **不做**：从案件素材 OCR 文本里抽月工资 / 工龄等字段（LLM 已经从上下文自然抽，没必要再做 sub-LLM 抽取）
- **不做**：案件记忆历史的 admin 管理页（用现有 search_case_memory 工具检索即可）
- **不做**：计算器结果的 Excel 导出（calculator 工具的 output 进入对话流后用户已能复制，YAGNI；后续真有需求再加）
- **不做**：跨会话的"全局计算器配置"（每次计算独立，从 case_memory 取上次输入即足够）
- **不做**：interrupt 卡片的"我不知道"软取消选项（直接点"取消"按钮够用）

## 14. 风险与缓解

| 风险 | 缓解 |
|---|---|
| LangGraph interrupt 后前端如何 resume — 项目内现有先例（如 parseAndAskStance）跑通过；新工具沿用同样模式 | 阅读 `server/agents/contract/parseAndAskStance.tool.ts` 实现细节 |
| 10 个工具的字段元数据维护成本 | 集中在一个 `_fieldMetadata.ts` 文件，类型由 zod schema 派生（zod schema 是 source of truth） |
| 用户在不同分支频繁切换导致字段值丢失 | 切换分支时**保留所有同名字段值**，仅隐藏当前分支不需要的字段 |
| 案件记忆数据膨胀（每次计算一条） | 第一版不做清理；后续如需要再加"每个 toolName 只保留最近 N 条" |
| 通用问答场景（无 caseId）调用工具 | ctx.caseId 为空时跳过 case_memory 查询和写入，其他流程不变 |

## 15. 决策记录

| 决策 | 选项 | 选择 | 理由 |
|---|---|---|---|
| 信息不足处理方式 | 反向追问 / inline 卡片 / 自动补全 | inline 卡片 | 产品体验：避免对话冗长，一次性收集多字段 |
| 预填来源 | 仅记忆 / 记忆+素材OCR | 记忆 +「LLM 已注入的上下文自然抽取」 | LLM 抽取免费、记忆兜底；不做 OCR 抽取（复杂度高准确率不稳）|
| 前端组件 | 10 个独立 vs 1 个通用 | 1 个通用 CalculatorTool.vue | 复用 90% 代码；新增工具只需扩字段元数据 |
| 取消处理 | throw error / 返回 cancelled | 返回 cancelled | LLM 自然衔接，不出红色错误 |
| 分支 UI | 全用 Tab / 全用 Select / 阈值切换 | 阈值切换（≤4 Tab，≥5 Select） | 平衡空间和易用性，参考 shadcn-vue 惯例 |
| 结果展示 | 简略数字 / 完整明细 | 完整明细 + Accordion 折叠 | 用户看完整数据有信任感；不重要的展开后查看 |

## 16. 后续

实施计划由 writing-plans skill 产出，落地为 `docs/superpowers/plans/2026-05-14-calculator-agent-tools-interactive-plan.md`。

预计工作量 8-9 小时，分两个 PR：
- **PR-A（4-5h）**：基建 + calculate_compensation 跑通 3 条路径 + E2E
- **PR-B（3-4h）**：剩余 9 个工具批量改造
