# 办案计算器 Agent 工具交互式接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 10 个办案计算器接入到法律助手 Agent，信息充足直接算 / 信息不足在对话内弹出 inline 卡片让用户补全 / 结果自动写入案件记忆。

**Architecture:** 4 层协同：① 工具层（`*.tool.ts` 用 `interrupt()` 暂停 graph 弹卡）→ ② 记忆层（复用 `writeMemoryService` + extraMetadata 透传 + `findLastCalculationByCase` 兜底查询）→ ③ 渲染层（通用 `CalculatorTool.vue` 三态壳 + `CalculatorFormFields.vue` 动态分支表单 + `CalculatorResult.vue` 完整结果展示）→ ④ 注册层（`globalInterruptRegistry` + `AiToolRenderer.INTERNAL_TOOL_MAP` + `agent-platform/tools/index.ts.toolModules` + DB `nodes.assistantMain.tools`）。

**Tech Stack:** Nuxt 4 + Vue 3 + TypeScript + LangGraph `interrupt()` + LangChain `tool()` + zod + shadcn-vue Confirmation + Prisma + LangChain PGVectorStore + Vitest

**Spec:** [docs/superpowers/specs/2026-05-14-calculator-agent-tools-interactive-design.md](../specs/2026-05-14-calculator-agent-tools-interactive-design.md)

**测试基线契约:** 不得破坏现有 tools 测试 100% 覆盖 + 719 案件管理回归测试。命令：`npx vitest run tests/shared/utils/tools/ tests/server/services/rates/ tests/server/services/memory/ tests/server/agents/legal-assistant/`

---

## 文件结构总览

### 新建文件

```
shared/utils/tools/agentTools/_fieldMetadata.ts                      # PR-A T3 / PR-B T12
app/components/ai/tools/CalculatorTool.vue                           # PR-A T6
app/components/ai/tools/CalculatorFormFields.vue                     # PR-A T5
app/components/ai/tools/CalculatorResult.vue                         # PR-A T4
tests/server/agents/legal-assistant/calculator-tools.e2e.test.ts     # PR-A T10
```

### 修改文件

```
shared/types/case.ts                              # PR-A T1 加 InterruptType.CALCULATOR_INPUT + TypedInterruptData 联合
shared/types/memory.ts                            # PR-A T1 MemoryKind 加 'calculation' + CaseMemoryMetadata 加 calculation 字段
server/services/memory/memory.service.ts          # PR-A T2 MemoryWriteInput 加 extraMetadata + 新增 findLastCalculationByCase
shared/utils/tools/agentTools/compensationCalculator.tool.ts  # PR-A T8（先驱工具）
shared/utils/tools/agentTools/*.tool.ts (剩余 9 个)              # PR-B T13-T21
server/services/agent-platform/tools/index.ts     # PR-A T9 注册 1 个 / PR-B T22 注册剩余 9 个
app/components/ai/AiToolRenderer.vue              # PR-A T7 INTERNAL_TOOL_MAP 注册 10 个
app/components/case/interrupt/index.ts            # PR-A T6 globalInterruptRegistry.register('calculator_input', ...)
prisma/seeds/seedData.sql                         # PR-A T9 + PR-B T22 追加 calculate_* 到 assistantMain.tools
tests/shared/utils/tools/agentTools/*.tool.test.ts (10 个)     # PR-A T8 + PR-B T13-T21 改造单测
```

---

# PR-A · 基建 + calculate_compensation 跑通 3 条路径（4-5h）

## 任务 PR-A-T1：类型层扩展

**Files:**
- Modify: `shared/types/case.ts`
- Modify: `shared/types/memory.ts`

- [ ] **Step 1: `shared/types/case.ts` InterruptType 加新值**

Read 文件找到 `InterruptType` 枚举，在末尾加：

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

- [ ] **Step 2: 同文件添加 `CalculatorInputInterruptData` 接口 + 加入联合类型**

在 `TypedInterruptData` 联合类型定义附近追加：

```typescript
export interface CalculatorInputInterruptData {
    type: InterruptType.CALCULATOR_INPUT
    toolName: string                          // 如 'calculate_compensation'
    prefilled: Record<string, unknown>        // L1 + L2 合并后的预填值
    missing: string[]                         // 缺失必填字段名列表
}
```

然后把 `CalculatorInputInterruptData` 加到 `TypedInterruptData` 联合的末尾。

- [ ] **Step 3: `shared/types/memory.ts` MemoryKind 加新值**

```typescript
export type MemoryKind = 'fact' | 'preference' | 'dialogue_note' | 'event' | 'decision' | 'note' | 'calculation'
```

- [ ] **Step 4: 同文件 CaseMemoryMetadata 加 `calculation` 可选字段**

在 `CaseMemoryMetadata` 接口定义末尾追加（保持现有字段不变）：

```typescript
export interface CaseMemoryMetadata {
    id: string
    caseId: number
    kind: MemoryKind
    subjectKey?: string
    confidence?: number
    source?: MemorySource
    supersedes?: string
    /** 新增：计算器历史详情，仅当 kind='calculation' 时填入 */
    calculation?: {
        tool: string
        input: Record<string, unknown>
        output: Record<string, unknown>
        calculatedAt: string
    }
}
```

- [ ] **Step 5: typecheck**

Run: `bun run typecheck 2>&1 | grep -E "case\.ts|memory\.ts" | head -5`
Expected: 无错误（输出为空）

- [ ] **Step 6: Commit**

```bash
git add shared/types/case.ts shared/types/memory.ts
git commit -m "feat(agent): 类型层扩展 InterruptType.CALCULATOR_INPUT + MemoryKind 加 calculation"
```

---

## 任务 PR-A-T2：writeMemoryService 扩 extraMetadata + 新增 findLastCalculationByCase

**Files:**
- Modify: `server/services/memory/memory.service.ts`
- Modify: `tests/server/services/memory/memory.service.test.ts`（若已存在）或 Create

- [ ] **Step 1: 先写测试，验证两个行为**

Read 现有 `tests/server/services/memory/` 看是否已有 `memory.service.test.ts`。若没有则创建；若有则追加。

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import {
    writeMemoryService,
    findLastCalculationByCase,
} from '~~/server/services/memory/memory.service'

describe('memory.service - calculation 扩展', () => {
    const createdIds: string[] = []
    const testCaseId = 1  // 用 seed 里的现有案件

    afterEach(async () => {
        if (createdIds.length > 0) {
            await prisma.$executeRawUnsafe(
                `DELETE FROM case_memories WHERE id = ANY($1::uuid[])`,
                createdIds,
            )
            createdIds.length = 0
        }
    })

    it('writeMemoryService 透传 extraMetadata.calculation 到 PGVectorStore metadata', async () => {
        const { id } = await writeMemoryService({
            caseId: testCaseId,
            kind: 'calculation',
            text: '[计算] 测试',
            subjectKey: 'calculation:test_tool',
            source: 'manual',
            extraMetadata: {
                calculation: {
                    tool: 'test_tool',
                    input: { foo: 1 },
                    output: { bar: 2 },
                    calculatedAt: '2026-05-14T10:00:00+08:00',
                },
            },
        })
        createdIds.push(id)

        // 验证 metadata 包含 calculation 字段
        const rows = await prisma.$queryRaw<Array<{ metadata: any }>>`
            SELECT metadata FROM case_memories WHERE id = ${id}::uuid
        `
        expect(rows[0]?.metadata?.calculation?.tool).toBe('test_tool')
        expect(rows[0]?.metadata?.calculation?.input).toEqual({ foo: 1 })
    })

    it('findLastCalculationByCase 返回同 case + tool 最近一次有效记录', async () => {
        // 先写一条
        const { id: id1 } = await writeMemoryService({
            caseId: testCaseId,
            kind: 'calculation',
            text: '[计算] 旧',
            subjectKey: 'calculation:test_find',
            source: 'manual',
            extraMetadata: {
                calculation: {
                    tool: 'test_find',
                    input: { value: 100 },
                    output: { total: 100 },
                    calculatedAt: '2026-05-13T10:00:00+08:00',
                },
            },
        })
        createdIds.push(id1)

        // 再写一条（应触发版本链，旧的被 invalidate）
        const { id: id2 } = await writeMemoryService({
            caseId: testCaseId,
            kind: 'calculation',
            text: '[计算] 新',
            subjectKey: 'calculation:test_find',
            source: 'manual',
            extraMetadata: {
                calculation: {
                    tool: 'test_find',
                    input: { value: 200 },
                    output: { total: 200 },
                    calculatedAt: '2026-05-14T10:00:00+08:00',
                },
            },
        })
        createdIds.push(id2)

        const last = await findLastCalculationByCase(testCaseId, 'test_find')
        expect(last?.tool).toBe('test_find')
        expect(last?.input).toEqual({ value: 200 })  // 拿新的，不是旧的
    })

    it('findLastCalculationByCase 无记录时返回 null', async () => {
        const result = await findLastCalculationByCase(testCaseId, 'non_existent_tool')
        expect(result).toBeNull()
    })
})
```

- [ ] **Step 2: 跑测试验证 FAIL**

Run: `npx vitest run tests/server/services/memory/memory.service.test.ts`
Expected: FAIL — `findLastCalculationByCase` 不存在 / `extraMetadata` 不存在

- [ ] **Step 3: 改 MemoryWriteInput 接口 + writeMemoryService 内部透传**

Read `server/services/memory/memory.service.ts`，定位 `MemoryWriteInput` 接口和 `writeMemoryService` 函数。

在 `MemoryWriteInput` 接口末尾追加：

```typescript
    /** 新增：透传到 PGVectorStore.metadata 的额外字段（如 calculation 详情） */
    extraMetadata?: Partial<Pick<CaseMemoryMetadata, 'calculation'>>
```

在 `writeMemoryService` 内部构造 `metadata` 后浅合并 `extraMetadata`：

```typescript
const metadata: CaseMemoryMetadata = {
    id: newId,
    caseId: input.caseId,
    kind: input.kind,
    subjectKey: input.subjectKey,
    confidence: input.confidence,
    source: input.source,
    supersedes,
    createdAt: new Date().toISOString(),
    ...input.extraMetadata,  // 新增：透传 calculation 等可选字段
}
```

- [ ] **Step 4: 在同文件末尾新增 `findLastCalculationByCase` 函数**

```typescript
/**
 * 查最近一次同案件同工具的计算输入（用于 L2 兜底预填）。
 * 利用 subjectKey='calculation:{tool}' 精确匹配，借助 writeMemoryService 已有的版本链机制：
 * 每次写新值会 invalidate 旧值，所以"未失效的"自然就是最新一条。
 */
export async function findLastCalculationByCase(
    caseId: number,
    tool: string,
): Promise<CaseMemoryMetadata['calculation'] | null> {
    const rows = await prisma.$queryRaw<Array<{ metadata: CaseMemoryMetadata }>>`
        SELECT metadata FROM case_memories
        WHERE (metadata->>'caseId')::int = ${caseId}
          AND metadata->>'kind' = 'calculation'
          AND metadata->>'subjectKey' = ${`calculation:${tool}`}
          AND (metadata->>'invalidatedAt') IS NULL
        LIMIT 1
    `
    return rows[0]?.metadata?.calculation ?? null
}
```

- [ ] **Step 5: 跑测试验证 PASS**

Run: `npx vitest run tests/server/services/memory/memory.service.test.ts`
Expected: 3 tests passed

- [ ] **Step 6: Commit**

```bash
git add server/services/memory/memory.service.ts tests/server/services/memory/memory.service.test.ts
git commit -m "feat(memory): writeMemoryService 加 extraMetadata + 新增 findLastCalculationByCase"
```

---

## 任务 PR-A-T3：_fieldMetadata.ts（仅 compensation 一个工具）

**Files:**
- Create: `shared/utils/tools/agentTools/_fieldMetadata.ts`

- [ ] **Step 1: 创建文件，定义类型 + 仅 compensation 的元数据**

```typescript
/**
 * Calculator Agent 工具的字段元数据（前端表单渲染用）
 *
 * 为什么不直接用 zod schema：zod 不承载 label/unit/分支可见性等 UI 元数据。
 * 本文件按 toolName 提供 source of truth。
 */

export interface CalcFieldMeta {
    /** 字段名（对应 zod schema 字段） */
    name: string
    /** 中文标签 */
    label: string
    /** 字段类型 */
    type: 'number' | 'text' | 'select' | 'date' | 'boolean'
    /** 单位（元 / 天 / %） */
    unit?: string
    /** 全分支必填 */
    required?: boolean
    /** 按分支判定必填，key 是分支值 */
    requiredBy?: Record<string, boolean>
    /** select 类型的选项 */
    options?: Array<{ value: string; label: string }>
    placeholder?: string
}

export interface CalcToolMeta {
    toolName: string
    displayName: string
    /** 分支字段名（如 type/caseType/mode），无分支不填 */
    branchField?: string
    /** 分支选项 */
    branchOptions?: Array<{ value: string; label: string }>
    /** UI 形式：≤4 用 tab，≥5 用 select（spec §7） */
    branchUiType?: 'tab' | 'select'
    /** 全部字段（含跨分支） */
    fields: CalcFieldMeta[]
    /** 每个分支显示哪些字段（name 列表，按显示顺序） */
    fieldsByBranch?: Record<string, string[]>
}

/** Calculator 工具元数据注册表，按 toolName 索引 */
export const CALCULATOR_TOOL_META: Record<string, CalcToolMeta> = {
    calculate_compensation: {
        toolName: 'calculate_compensation',
        displayName: '赔偿金计算',
        branchField: 'type',
        branchUiType: 'tab',
        branchOptions: [
            { value: 'workInjury', label: '工伤赔偿' },
            { value: 'trafficAccident', label: '交通事故' },
            { value: 'death', label: '死亡赔偿' },
        ],
        fields: [
            // 工伤
            { name: 'salary', label: '月工资', type: 'number', unit: '元', requiredBy: { workInjury: true } },
            { name: 'disabilityLevel', label: '伤残等级', type: 'select',
              options: Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} 级` })),
              requiredBy: { workInjury: true } },
            { name: 'medicalExpenses', label: '医疗费用', type: 'number', unit: '元',
              requiredBy: { trafficAccident: true } },
            { name: 'nursingExpenses', label: '护理费用', type: 'number', unit: '元' },
            { name: 'nutritionExpenses', label: '营养费用', type: 'number', unit: '元' },
            // 车祸
            { name: 'disabilityCompensation', label: '伤残赔偿金', type: 'number', unit: '元',
              requiredBy: { trafficAccident: true } },
            { name: 'lostIncome', label: '误工费', type: 'number', unit: '元' },
            { name: 'transportationExpenses', label: '交通费', type: 'number', unit: '元' },
            { name: 'accommodationExpenses', label: '住宿费', type: 'number', unit: '元' },
            { name: 'propertyLoss', label: '财产损失', type: 'number', unit: '元' },
            // 死亡
            { name: 'annualIncome', label: '年收入', type: 'number', unit: '元', requiredBy: { death: true } },
            { name: 'deathCompensationYears', label: '死亡赔偿金年限', type: 'number', unit: '年',
              placeholder: '默认 20' },
            { name: 'funeralExpenses', label: '丧葬费', type: 'number', unit: '元' },
            { name: 'dependentCompensation', label: '被抚养人生活费', type: 'number', unit: '元' },
            { name: 'emotionalDamages', label: '精神损害赔偿金', type: 'number', unit: '元' },
        ],
        fieldsByBranch: {
            workInjury: ['salary', 'disabilityLevel', 'medicalExpenses', 'nursingExpenses', 'nutritionExpenses'],
            trafficAccident: ['medicalExpenses', 'disabilityCompensation', 'nursingExpenses', 'lostIncome',
                              'nutritionExpenses', 'transportationExpenses', 'accommodationExpenses', 'propertyLoss'],
            death: ['annualIncome', 'deathCompensationYears', 'funeralExpenses', 'dependentCompensation', 'emotionalDamages'],
        },
    },
}
```

- [ ] **Step 2: typecheck**

Run: `bun run typecheck 2>&1 | grep "_fieldMetadata" | head -3`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add shared/utils/tools/agentTools/_fieldMetadata.ts
git commit -m "feat(agent): 新增 _fieldMetadata.ts（calculator 工具字段元数据）+ compensation 元数据"
```

---

## 任务 PR-A-T4：CalculatorResult.vue（结果展示组件）

**Files:**
- Create: `app/components/ai/tools/CalculatorResult.vue`

- [ ] **Step 1: 创建文件**

```vue
<template>
    <div class="space-y-3">
        <!-- 摘要 row：按 toolName 切换不同布局 -->
        <div v-if="toolName === 'calculate_compensation'" class="rounded-md bg-muted/50 p-4 space-y-2">
            <div class="flex justify-between text-sm">
                <span>赔偿类型</span>
                <span class="font-medium">{{ compensationTypeText }}</span>
            </div>
            <div v-if="input.type === 'workInjury'" class="space-y-1.5">
                <div class="flex justify-between text-sm">
                    <span>月工资</span><span>{{ formatCurrency(input.salary) }}</span>
                </div>
                <div class="flex justify-between text-sm">
                    <span>伤残等级</span><span>{{ input.disabilityLevel }} 级</span>
                </div>
                <div class="flex justify-between text-sm">
                    <span>一次性伤残补助金</span><span>{{ formatCurrency(output.disabilityCompensation) }}</span>
                </div>
                <div class="flex justify-between text-sm">
                    <span>医疗费用</span><span>{{ formatCurrency(output.medicalExpenses) }}</span>
                </div>
                <div class="flex justify-between text-sm">
                    <span>护理费用</span><span>{{ formatCurrency(output.nursingExpenses) }}</span>
                </div>
                <div class="flex justify-between text-sm">
                    <span>营养费用</span><span>{{ formatCurrency(output.nutritionExpenses) }}</span>
                </div>
            </div>
            <!-- trafficAccident / death 分支字段类似省略，PR-B 时再补全 -->
            <div class="flex justify-between border-t pt-2 mt-2">
                <span class="font-semibold">赔偿总额</span>
                <span class="font-semibold text-primary text-lg">
                    {{ formatCurrency(output.totalCompensation) }}
                </span>
            </div>
        </div>

        <!-- 计算明细 Accordion -->
        <Accordion v-if="Array.isArray(output.details) && output.details.length > 0"
                   type="single" collapsible class="w-full" default-value="details">
            <AccordionItem value="details">
                <AccordionTrigger>计算明细（按法条逐项展开）</AccordionTrigger>
                <AccordionContent>
                    <ul class="text-sm space-y-1 list-disc pl-5">
                        <li v-for="(line, i) in (output.details as string[])" :key="i">{{ line }}</li>
                    </ul>
                </AccordionContent>
            </AccordionItem>
        </Accordion>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '~/components/ui/accordion'

const props = defineProps<{
    toolName: string
    input: Record<string, any>
    output: Record<string, any>
}>()

function formatCurrency(n: unknown): string {
    if (typeof n !== 'number') return '—'
    return `¥ ${n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}

const compensationTypeText = computed(() => {
    const map: Record<string, string> = {
        workInjury: '工伤赔偿',
        trafficAccident: '交通事故',
        death: '死亡赔偿',
    }
    return map[props.input.type as string] ?? '—'
})
</script>
```

> 注：PR-A 只实现 compensation 的结果展示，PR-B 时按 spec §8.5 对照表补全其他 9 个工具的 v-if 分支。

- [ ] **Step 2: typecheck**

Run: `bun run typecheck 2>&1 | grep "CalculatorResult" | head -3`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add app/components/ai/tools/CalculatorResult.vue
git commit -m "feat(agent-ui): 新增 CalculatorResult.vue（compensation 结果展示）"
```

---

## 任务 PR-A-T5：CalculatorFormFields.vue（动态表单）

**Files:**
- Create: `app/components/ai/tools/CalculatorFormFields.vue`

- [ ] **Step 1: 创建文件**

```vue
<template>
    <div class="space-y-4">
        <!-- 分支选择器：Tab 或 Select -->
        <Tabs v-if="meta.branchField && meta.branchUiType === 'tab'"
              :model-value="branchValue"
              @update:model-value="onBranchChange">
            <TabsList class="w-full">
                <TabsTrigger v-for="opt in meta.branchOptions" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                </TabsTrigger>
            </TabsList>
        </Tabs>

        <div v-else-if="meta.branchField && meta.branchUiType === 'select'" class="space-y-1.5">
            <Label>{{ branchFieldLabel }}</Label>
            <Select :model-value="branchValue" @update:model-value="onBranchChange">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                    <SelectItem v-for="opt in meta.branchOptions" :key="opt.value" :value="opt.value">
                        {{ opt.label }}
                    </SelectItem>
                </SelectContent>
            </Select>
        </div>

        <!-- 字段网格：根据当前分支显示对应字段 -->
        <div class="grid grid-cols-2 gap-3">
            <div v-for="field in visibleFields" :key="field.name" class="space-y-1.5">
                <Label>
                    <span v-if="isRequired(field)" class="text-destructive mr-1">*</span>
                    {{ field.label }}
                    <Badge v-if="prefilled[field.name] !== undefined && !isMissing(field)"
                           variant="secondary" class="ml-2 text-xs">已自动填入</Badge>
                    <Badge v-if="isMissing(field)" variant="destructive" class="ml-2 text-xs">需补全</Badge>
                </Label>

                <Input v-if="field.type === 'number'"
                       type="number"
                       :model-value="formData[field.name]"
                       :placeholder="field.placeholder || '0'"
                       :class="isMissing(field) ? 'border-destructive' : (prefilled[field.name] !== undefined ? 'bg-primary/5' : '')"
                       @update:model-value="(v: any) => onFieldInput(field.name, v === '' ? undefined : Number(v))" />

                <Select v-else-if="field.type === 'select'"
                        :model-value="String(formData[field.name] ?? '')"
                        @update:model-value="(v: any) => onFieldInput(field.name, v)">
                    <SelectTrigger><SelectValue placeholder="请选择" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem v-for="opt in field.options" :key="opt.value" :value="opt.value">
                            {{ opt.label }}
                        </SelectItem>
                    </SelectContent>
                </Select>

                <Input v-else
                       :model-value="formData[field.name]"
                       :placeholder="field.placeholder"
                       @update:model-value="(v: any) => onFieldInput(field.name, v)" />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Badge } from '~/components/ui/badge'
import { CALCULATOR_TOOL_META, type CalcFieldMeta } from '#shared/utils/tools/agentTools/_fieldMetadata'

const props = defineProps<{
    toolName: string
    prefilled: Record<string, any>
    missing: string[]
    modelValue: Record<string, any>
    branch?: string
}>()

const emit = defineEmits<{
    (e: 'update:modelValue', val: Record<string, any>): void
    (e: 'update:branch', val: string): void
}>()

const meta = computed(() => CALCULATOR_TOOL_META[props.toolName]!)
const branchValue = computed(() => props.branch ?? (props.prefilled[meta.value.branchField ?? ''] as string)
                                  ?? meta.value.branchOptions?.[0]?.value ?? '')

const branchFieldLabel = computed(() => {
    const map: Record<string, string> = { type: '赔偿类型', caseType: '案件类型', mode: '计算模式',
                                           feeTypeLevel1: '费用类型', queryType: '查询类型' }
    return map[meta.value.branchField!] ?? meta.value.branchField!
})

const formData = computed(() => props.modelValue)

const visibleFields = computed<CalcFieldMeta[]>(() => {
    const branch = branchValue.value
    const names = meta.value.fieldsByBranch?.[branch] ?? meta.value.fields.map((f) => f.name)
    return names
        .map((name) => meta.value.fields.find((f) => f.name === name))
        .filter((f): f is CalcFieldMeta => f !== undefined)
})

function isRequired(field: CalcFieldMeta): boolean {
    if (field.required) return true
    return field.requiredBy?.[branchValue.value] ?? false
}

function isMissing(field: CalcFieldMeta): boolean {
    return props.missing.includes(field.name) && (formData.value[field.name] === undefined
                                                  || formData.value[field.name] === '')
}

function onFieldInput(name: string, value: any) {
    emit('update:modelValue', { ...formData.value, [name]: value })
}

function onBranchChange(v: any) {
    if (meta.value.branchField) {
        emit('update:branch', v as string)
        // 同步把分支字段值也写到 formData
        emit('update:modelValue', { ...formData.value, [meta.value.branchField]: v })
    }
}
</script>
```

- [ ] **Step 2: typecheck**

Run: `bun run typecheck 2>&1 | grep "CalculatorFormFields" | head -3`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add app/components/ai/tools/CalculatorFormFields.vue
git commit -m "feat(agent-ui): 新增 CalculatorFormFields.vue（动态分支表单）"
```

---

## 任务 PR-A-T6：CalculatorTool.vue 三态壳 + interrupt 注册

**Files:**
- Create: `app/components/ai/tools/CalculatorTool.vue`
- Modify: `app/components/case/interrupt/index.ts`

- [ ] **Step 1: 创建 `CalculatorTool.vue`**

```vue
<template>
    <Confirmation :approval="approval" :state="confirmationState" class="w-full">
        <!-- 输入态：动态表单 -->
        <ConfirmationRequest v-if="needsInput">
            <ConfirmationTitle>{{ displayName }}</ConfirmationTitle>
            <p class="text-muted-foreground text-sm mb-3">
                <template v-if="missing.length > 0">案件信息不全，请补全 <strong class="text-destructive">{{ missing.length }}</strong> 个必填项</template>
                <template v-else>请确认参数</template>
            </p>

            <CalculatorFormFields
                :tool-name="toolName"
                :prefilled="prefilled"
                :missing="missing"
                v-model="formData"
                v-model:branch="selectedBranch"
            />

            <ConfirmationActions class="mt-4">
                <ConfirmationAction variant="outline" @click="onCancel">取消</ConfirmationAction>
                <ConfirmationAction :disabled="!isValid" @click="onSubmit">计算</ConfirmationAction>
            </ConfirmationActions>
        </ConfirmationRequest>

        <!-- 结果态：参考各工具页面完整明细 -->
        <ConfirmationAccepted v-else-if="output && !cancelled">
            <div class="space-y-3">
                <h3 class="font-semibold flex items-center gap-2">
                    <CheckCircle2 class="w-5 h-5 text-emerald-600" />
                    {{ displayName }}结果
                </h3>
                <CalculatorResult :tool-name="toolName" :input="finalInput" :output="output" />
                <Alert variant="success" class="block">
                    <Check class="w-4 h-4 mr-2 inline" />
                    已自动保存到案件记忆，下次再算时会自动预填这些字段
                </Alert>
            </div>
        </ConfirmationAccepted>

        <!-- 取消态：保留卡片置灰 -->
        <ConfirmationRejected v-else>
            <p class="text-muted-foreground flex items-center gap-2">
                <Ban class="w-4 h-4" />
                用户取消了本次计算输入
            </p>
        </ConfirmationRejected>
    </Confirmation>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
    Confirmation, ConfirmationRequest, ConfirmationAccepted, ConfirmationRejected,
    ConfirmationTitle, ConfirmationActions, ConfirmationAction,
} from '~/components/ai-elements/confirmation'
import type { ToolUIPartApproval } from '~/components/ai-elements/confirmation/context'
import type { ExtendedToolState } from '~/components/ai-elements/types'
import { Alert } from '~/components/ui/alert'
import { CheckCircle2, Check, Ban } from 'lucide-vue-next'
import CalculatorFormFields from '~/components/ai/tools/CalculatorFormFields.vue'
import CalculatorResult from '~/components/ai/tools/CalculatorResult.vue'
import { CALCULATOR_TOOL_META, type CalcFieldMeta } from '#shared/utils/tools/agentTools/_fieldMetadata'

const props = defineProps<{
    /** 工具调用的输入（中断时的 prefilled）+ 状态等 */
    toolName: string
    input?: any           // interrupt 数据 { type, toolName, prefilled, missing }
    output?: any          // 工具最终返回 JSON
    state: ExtendedToolState
}>()

const emit = defineEmits<{
    confirm: [merged: Record<string, any>]   // 用户提交 → 父级 dispatch resume payload
    reject: []                                // 用户取消 → 父级 dispatch resume payload {cancelled:true}
}>()

const approval = ref<ToolUIPartApproval>({ id: 'calculator-input' })
const confirmationState = ref<ExtendedToolState>('approval-requested')

const prefilled = computed<Record<string, any>>(() => props.input?.prefilled ?? {})
const missing = computed<string[]>(() => props.input?.missing ?? [])
const displayName = computed(() => CALCULATOR_TOOL_META[props.toolName]?.displayName ?? props.toolName)

const formData = ref<Record<string, any>>({ ...prefilled.value })
const selectedBranch = ref<string>(
    (prefilled.value[CALCULATOR_TOOL_META[props.toolName]?.branchField ?? ''] as string)
    ?? CALCULATOR_TOOL_META[props.toolName]?.branchOptions?.[0]?.value
    ?? '',
)

const cancelled = computed(() => {
    try {
        const parsed = typeof props.output === 'string' ? JSON.parse(props.output) : props.output
        return parsed?.cancelled === true
    } catch { return false }
})

const needsInput = computed(() => {
    return missing.value.length > 0
        && !props.output
        && confirmationState.value !== 'approval-responded'
})

const isValid = computed(() => {
    const meta = CALCULATOR_TOOL_META[props.toolName]
    if (!meta) return false
    const branch = selectedBranch.value
    const requiredFieldNames = meta.fields
        .filter((f: CalcFieldMeta) => f.required || f.requiredBy?.[branch])
        .map((f) => f.name)
    return requiredFieldNames.every(
        (name) => formData.value[name] !== undefined && formData.value[name] !== '',
    )
})

const finalInput = computed(() => {
    // 结果态时优先用 props.input.prefilled 合并 formData 后的最终入参
    return { ...prefilled.value, ...formData.value }
})

function onSubmit() {
    if (!isValid.value) return
    approval.value = { id: 'calculator-input', approved: true }
    confirmationState.value = 'approval-responded'
    emit('confirm', formData.value)
}

function onCancel() {
    approval.value = { id: 'calculator-input', approved: false, reason: '用户取消' }
    confirmationState.value = 'approval-responded'
    emit('reject')
}
</script>
```

- [ ] **Step 2: 在 `app/components/case/interrupt/index.ts` 末尾注册**

Read 该文件，在末尾追加：

```typescript
import CalculatorTool from '~/components/ai/tools/CalculatorTool.vue'

globalInterruptRegistry.register('calculator_input', CalculatorTool, { isToolCard: true })
```

- [ ] **Step 3: typecheck**

Run: `bun run typecheck 2>&1 | grep -E "CalculatorTool|interrupt/index" | head -5`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add app/components/ai/tools/CalculatorTool.vue app/components/case/interrupt/index.ts
git commit -m "feat(agent-ui): CalculatorTool.vue 三态壳 + 注册到 globalInterruptRegistry"
```

---

## 任务 PR-A-T7：AiToolRenderer INTERNAL_TOOL_MAP 注册

**Files:**
- Modify: `app/components/ai/AiToolRenderer.vue`

- [ ] **Step 1: 在 INTERNAL_TOOL_MAP 加 calculate_compensation**

Read 文件找到 `INTERNAL_TOOL_MAP` 对象。在顶部 import 区加：

```typescript
import AiToolsCalculatorTool from '~/components/ai/tools/CalculatorTool.vue'
```

在 INTERNAL_TOOL_MAP 末尾加：

```typescript
calculate_compensation: AiToolsCalculatorTool,
```

> PR-B 时其余 9 个工具复用这个组件，到时再补 9 行映射。

- [ ] **Step 2: typecheck**

Run: `bun run typecheck 2>&1 | grep AiToolRenderer | head -3`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add app/components/ai/AiToolRenderer.vue
git commit -m "feat(agent-ui): AiToolRenderer INTERNAL_TOOL_MAP 注册 calculate_compensation"
```

---

## 任务 PR-A-T8：compensation 工具改造（interrupt + writeMemory + 必填校验）

**Files:**
- Modify: `shared/utils/tools/agentTools/compensationCalculator.tool.ts`
- Modify: `tests/shared/utils/tools/agentTools/compensationCalculator.tool.test.ts`

- [ ] **Step 1: 先写测试**

替换原测试文件内容（或追加 describe block）：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { compensationCalculatorTool } from '#shared/utils/tools/agentTools/compensationCalculator.tool'

// Mock LangGraph interrupt
vi.mock('@langchain/langgraph', () => ({
    interrupt: vi.fn(),
}))

// Mock memory service
vi.mock('~~/server/services/memory/memory.service', () => ({
    writeMemoryService: vi.fn().mockResolvedValue({ id: 'fake-id' }),
    findLastCalculationByCase: vi.fn().mockResolvedValue(null),
}))

import { interrupt } from '@langchain/langgraph'
import {
    writeMemoryService,
    findLastCalculationByCase,
} from '~~/server/services/memory/memory.service'

describe('compensationCalculator.tool - 3 条路径', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('路径 A：信息充足时直接计算，不调 interrupt', async () => {
        const tool = compensationCalculatorTool.createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const result = await (tool as any).invoke({
            type: 'workInjury',
            salary: 12000,
            disabilityLevel: 8,
            medicalExpenses: 25000,
            nursingExpenses: 8000,
            nutritionExpenses: 3000,
        })

        expect(interrupt).not.toHaveBeenCalled()
        const parsed = JSON.parse(result as string)
        expect(parsed.totalCompensation).toBeGreaterThan(0)
        expect(writeMemoryService).toHaveBeenCalledWith(
            expect.objectContaining({
                caseId: 100,
                kind: 'calculation',
                subjectKey: 'calculation:calculate_compensation',
                extraMetadata: expect.objectContaining({
                    calculation: expect.objectContaining({ tool: 'calculate_compensation' }),
                }),
            }),
        )
    })

    it('路径 B：缺必填字段时调 interrupt 并用 resume 值继续', async () => {
        vi.mocked(interrupt).mockReturnValue({ salary: 12000, disabilityLevel: 8 })

        const tool = compensationCalculatorTool.createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const result = await (tool as any).invoke({
            type: 'workInjury',
            // salary / disabilityLevel 缺失
        })

        expect(interrupt).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'calculator_input',
                toolName: 'calculate_compensation',
                missing: expect.arrayContaining(['salary', 'disabilityLevel']),
            }),
        )
        const parsed = JSON.parse(result as string)
        expect(parsed.totalCompensation).toBeGreaterThan(0)
        expect(writeMemoryService).toHaveBeenCalled()
    })

    it('路径 C：resume 返回 cancelled 时工具返回 cancelled', async () => {
        vi.mocked(interrupt).mockReturnValue({ cancelled: true, reason: '用户取消' })

        const tool = compensationCalculatorTool.createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const result = await (tool as any).invoke({ type: 'workInjury' })

        const parsed = JSON.parse(result as string)
        expect(parsed.cancelled).toBe(true)
        expect(parsed.reason).toContain('用户取消')
        expect(writeMemoryService).not.toHaveBeenCalled()
    })

    it('ctx.caseId 为空时跳过 case_memory 查询和写入', async () => {
        const tool = compensationCalculatorTool.createTool({ userId: 1, sessionId: 's1' })  // 无 caseId
        await (tool as any).invoke({
            type: 'workInjury',
            salary: 12000,
            disabilityLevel: 8,
        })

        expect(findLastCalculationByCase).not.toHaveBeenCalled()
        expect(writeMemoryService).not.toHaveBeenCalled()
    })

    it('resume payload 非法时抛错', async () => {
        vi.mocked(interrupt).mockReturnValue('invalid' as any)

        const tool = compensationCalculatorTool.createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        await expect(
            (tool as any).invoke({ type: 'workInjury' }),
        ).rejects.toThrow(/resume payload 非法/)
    })
})
```

- [ ] **Step 2: 跑测试验证 FAIL**

Run: `npx vitest run tests/shared/utils/tools/agentTools/compensationCalculator.tool.test.ts`
Expected: FAIL — 现 tool 没有 interrupt 逻辑

- [ ] **Step 3: 改造 `compensationCalculator.tool.ts` 全文重写**

```typescript
/**
 * 赔偿金计算 Agent 工具（交互式版本）
 */
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
    writeMemoryService,
    findLastCalculationByCase,
} from '~~/server/services/memory/memory.service'

const schema = z.object({
    type: z.enum(['workInjury', 'trafficAccident', 'death']).describe(
        '赔偿类型：workInjury（工伤）、trafficAccident（交通事故）、death（死亡）',
    ),
    salary: z.number().min(0).optional().describe('月工资（元），workInjury 必填'),
    disabilityLevel: z.number().int().min(1).max(10).optional().describe('伤残等级（1-10级），workInjury 必填'),
    medicalExpenses: z.number().min(0).optional().describe('医疗费用（元），trafficAccident 必填'),
    nursingExpenses: z.number().min(0).optional().describe('护理费用（元）'),
    nutritionExpenses: z.number().min(0).optional().describe('营养费用（元）'),
    disabilityCompensation: z.number().min(0).optional().describe('伤残赔偿金（元），trafficAccident 必填'),
    lostIncome: z.number().min(0).optional().describe('误工费（元）'),
    transportationExpenses: z.number().min(0).optional().describe('交通费（元）'),
    accommodationExpenses: z.number().min(0).optional().describe('住宿费（元）'),
    propertyLoss: z.number().min(0).optional().describe('财产损失（元）'),
    annualIncome: z.number().min(0).optional().describe('年收入（元），death 必填'),
    deathCompensationYears: z.number().int().min(1).max(20).optional().describe('死亡赔偿金年限（年），默认 20'),
    funeralExpenses: z.number().min(0).optional().describe('丧葬费（元）'),
    dependentCompensation: z.number().min(0).optional().describe('被抚养人生活费（元）'),
    emotionalDamages: z.number().min(0).optional().describe('精神损害赔偿金（元）'),
})

const REQUIRED_FIELDS: Record<string, string[]> = {
    workInjury: ['salary', 'disabilityLevel'],
    trafficAccident: ['medicalExpenses', 'disabilityCompensation'],
    death: ['annualIncome'],
}

export const compensationCalculatorTool: ToolModule = {
    toolDefinition: {
        name: 'calculate_compensation',
        description: '赔偿金计算：支持工伤、交通事故、死亡 3 种场景。当必填字段缺失时会通过 interrupt 让用户在 inline 卡片补全，禁止使用 0 或默认值替代真实数据。',
        schema,
    },
    createTool: (ctx: ToolContext) =>
        tool(async (input) => {
            // ① L2 兜底查 case_memory
            const memoryCalc = ctx.caseId
                ? await findLastCalculationByCase(ctx.caseId, 'calculate_compensation')
                : null
            let merged = { ...(memoryCalc?.input ?? {}), ...input } as Record<string, any>

            // ② 必填校验
            const required = REQUIRED_FIELDS[merged.type] ?? []
            const missing = required.filter(
                (f) => merged[f] === undefined || merged[f] === null || merged[f] === '',
            )

            // ③ 信息不足 → interrupt
            if (missing.length > 0) {
                const resumed = interrupt({
                    type: InterruptType.CALCULATOR_INPUT,
                    toolName: 'calculate_compensation',
                    prefilled: merged,
                    missing,
                }) as unknown

                if (!resumed || typeof resumed !== 'object') {
                    throw new Error(`calculate_compensation: resume payload 非法 (${typeof resumed})`)
                }
                const payload = resumed as { cancelled?: boolean; reason?: string; [k: string]: unknown }
                if (payload.cancelled) {
                    return JSON.stringify({ cancelled: true, reason: payload.reason ?? '用户取消了本次计算' })
                }
                merged = { ...merged, ...payload }
            }

            // ④ 调 service 算结果
            let result: Record<string, unknown>
            if (merged.type === 'workInjury') {
                result = calculateWorkInjuryCompensation(
                    merged.salary, merged.disabilityLevel,
                    merged.medicalExpenses ?? 0, merged.nursingExpenses ?? 0, merged.nutritionExpenses ?? 0,
                ) as unknown as Record<string, unknown>
            } else if (merged.type === 'trafficAccident') {
                result = calculateTrafficAccidentCompensation(
                    merged.medicalExpenses ?? 0, merged.disabilityCompensation ?? 0,
                    merged.nursingExpenses ?? 0, merged.lostIncome ?? 0,
                    merged.nutritionExpenses ?? 0, merged.transportationExpenses ?? 0,
                    merged.accommodationExpenses ?? 0, merged.propertyLoss ?? 0,
                ) as unknown as Record<string, unknown>
            } else {
                result = calculateDeathCompensation(
                    merged.annualIncome, merged.deathCompensationYears ?? 20,
                    merged.funeralExpenses ?? 0, merged.dependentCompensation ?? 0,
                    merged.emotionalDamages ?? 0,
                ) as unknown as Record<string, unknown>
            }

            // ⑤ 写入 case_memory
            if (ctx.caseId) {
                await writeMemoryService({
                    caseId: ctx.caseId,
                    kind: 'calculation',
                    text: `[计算] 赔偿金 · ${merged.type} · 总额 ${result.totalCompensation ?? '-'} 元`,
                    subjectKey: 'calculation:calculate_compensation',
                    source: 'manual',
                    extraMetadata: {
                        calculation: {
                            tool: 'calculate_compensation',
                            input: merged,
                            output: result,
                            calculatedAt: new Date().toISOString(),
                        },
                    },
                })
            }

            return JSON.stringify(result)
        }, {
            name: 'calculate_compensation',
            description: '赔偿金计算',
            schema,
        }) as any,
}
```

- [ ] **Step 4: 跑测试验证 PASS**

Run: `npx vitest run tests/shared/utils/tools/agentTools/compensationCalculator.tool.test.ts`
Expected: 5 tests passed

- [ ] **Step 5: Commit**

```bash
git add shared/utils/tools/agentTools/compensationCalculator.tool.ts tests/shared/utils/tools/agentTools/compensationCalculator.tool.test.ts
git commit -m "feat(agent): compensation 工具改造（interrupt + writeMemory + 必填校验）"
```

---

## 任务 PR-A-T9：agent-platform 注册 + DB nodes 挂载

**Files:**
- Modify: `server/services/agent-platform/tools/index.ts`
- Modify: `prisma/seeds/seedData.sql`

- [ ] **Step 1: 在 `agent-platform/tools/index.ts` 顶部 import 区加**

```typescript
import * as compensationCalculatorTool from '#shared/utils/tools/agentTools/compensationCalculator.tool'
```

在 `toolModules` 对象末尾加：

```typescript
    calculate_compensation: compensationCalculatorTool.compensationCalculatorTool as any,
```

> 注：`compensationCalculatorTool` 是 ToolModule 对象，不是 namespace，需要 `as any` 适配现有 `toolModules: Record<string, ToolModule>` 的引用形态。如 typecheck 抱怨可调整 import 形式。

- [ ] **Step 2: 改 dev 库 `nodes.assistantMain.tools` 字段**

Run（dev 库）:
```bash
docker exec postgres psql -U daixin -d ls_new -c "
UPDATE nodes SET tools = tools || '[\"calculate_compensation\"]'::jsonb
WHERE name = 'assistantMain' AND NOT tools @> '[\"calculate_compensation\"]'::jsonb;
"
```
Expected: `UPDATE 1`

- [ ] **Step 3: 同步 `prisma/seeds/seedData.sql`**

Read seedData.sql 找到 `INSERT INTO ... nodes ... name='assistantMain'` 行，把 tools 字段的 JSON 数组追加 `"calculate_compensation"`：

之前类似：
```sql
'["search_law", "review_contract", ...]'
```
改成：
```sql
'["search_law", "review_contract", ..., "calculate_compensation"]'
```

- [ ] **Step 4: typecheck**

Run: `bun run typecheck 2>&1 | grep "agent-platform/tools" | head -3`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add server/services/agent-platform/tools/index.ts prisma/seeds/seedData.sql
git commit -m "feat(agent): toolModules 注册 calculate_compensation + nodes.assistantMain.tools 挂载"
```

---

## 任务 PR-A-T10：E2E 测试 3 条路径

**Files:**
- Create: `tests/server/agents/legal-assistant/calculator-tools.e2e.test.ts`

- [ ] **Step 1: 写 E2E 测试（mock LLM 决策 + 真 interrupt flow）**

```typescript
/**
 * Calculator Agent Tools E2E
 * 验证 3 条路径：A 直算 / B 弹卡片提交 / C 取消
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@langchain/langgraph', () => ({
    interrupt: vi.fn(),
}))

vi.mock('~~/server/services/memory/memory.service', () => ({
    writeMemoryService: vi.fn().mockResolvedValue({ id: 'fake' }),
    findLastCalculationByCase: vi.fn().mockResolvedValue(null),
}))

import { interrupt } from '@langchain/langgraph'
import { getToolInstancesService } from '~~/server/services/agent-platform/tools/index'

describe('calculator-tools E2E - 通过 agent-platform 工具注册表调用', () => {
    beforeEach(() => vi.clearAllMocks())

    it('路径 A：通过工具注册表调 calculate_compensation 信息充足直算', async () => {
        const [tool] = getToolInstancesService(
            ['calculate_compensation'],
            { userId: 1, caseId: 100, sessionId: 's1' },
        )

        const result = await tool!.invoke({
            type: 'workInjury',
            salary: 12000,
            disabilityLevel: 8,
        })

        expect(interrupt).not.toHaveBeenCalled()
        const parsed = JSON.parse(result as string)
        expect(parsed.totalCompensation).toBeGreaterThan(0)
    })

    it('路径 B：缺字段 → interrupt → resume 用户填值 → 算出结果', async () => {
        vi.mocked(interrupt).mockReturnValue({ salary: 12000, disabilityLevel: 8 })

        const [tool] = getToolInstancesService(
            ['calculate_compensation'],
            { userId: 1, caseId: 100, sessionId: 's1' },
        )

        const result = await tool!.invoke({ type: 'workInjury' })
        expect(interrupt).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'calculator_input' }),
        )
        const parsed = JSON.parse(result as string)
        expect(parsed.totalCompensation).toBeGreaterThan(0)
    })

    it('路径 C：用户取消 → 返回 cancelled', async () => {
        vi.mocked(interrupt).mockReturnValue({ cancelled: true, reason: '用户取消' })

        const [tool] = getToolInstancesService(
            ['calculate_compensation'],
            { userId: 1, caseId: 100, sessionId: 's1' },
        )

        const result = await tool!.invoke({ type: 'workInjury' })
        expect(JSON.parse(result as string).cancelled).toBe(true)
    })

    it('toolModules 注册表包含 calculate_compensation', async () => {
        const { getAllToolNamesService } = await import('~~/server/services/agent-platform/tools/index')
        expect(getAllToolNamesService()).toContain('calculate_compensation')
    })
})
```

- [ ] **Step 2: 跑测试**

Run: `npx vitest run tests/server/agents/legal-assistant/calculator-tools.e2e.test.ts`
Expected: 4 tests passed

- [ ] **Step 3: Commit**

```bash
git add tests/server/agents/legal-assistant/calculator-tools.e2e.test.ts
git commit -m "test(agent): calculator-tools E2E 验证 3 条路径 + 注册表"
```

---

## 任务 PR-A-T11：浏览器手动走查 + PR-A 收尾

- [ ] **Step 1: 跑全量回归**

Run:
```bash
npx vitest run tests/shared/utils/tools/ tests/server/services/memory/ tests/server/agents/legal-assistant/ 2>&1 | tail -5
```
Expected: Tests 全 PASS

- [ ] **Step 2: typecheck**

Run: `bun run typecheck 2>&1 | tail -10`
Expected: 无新错误

- [ ] **Step 3: 浏览器走查（人工）**

`bun dev` → 登录 → `/dashboard/assistant` 法律助手 → 选一个真实案件 → 问：

1. **路径 A**：「帮我算下我的工伤赔偿金，我月薪 12000，伤残 8 级」 → LLM 应该直接调工具返回结果，对话流出现绿色 ✓ 卡片
2. **路径 B**：「帮我算下我的工伤赔偿金」（不提工资和伤残）→ LLM 应该调工具触发 interrupt，对话流出现可编辑卡片，用户填值点「计算」→ 卡片切结果态
3. **路径 C**：路径 B 触发后点「取消」→ 卡片置灰显示「用户取消了本次计算输入」 + LLM 自然衔接回复

- [ ] **Step 4: PR-A 总结 commit**

```bash
git commit --allow-empty -m "chore(agent): PR-A 完成 - 基建 + calculate_compensation 跑通 3 条路径"
```

---

# PR-B · 剩余 9 个工具批量改造（3-4h）

## 任务 PR-B-T12：补全 _fieldMetadata.ts（其余 9 个工具）

**Files:**
- Modify: `shared/utils/tools/agentTools/_fieldMetadata.ts`

- [ ] **Step 1: 按 spec §7 分支策略补全 9 个工具的 meta**

每个工具的 fields / fieldsByBranch / branchUiType 严格对照对应 `*.tool.ts` 的现有 zod schema（PR3 已有），仅 UI 元数据扩展。

需补全的 toolName：
- `calculate_interest` · branchField='mode'，3 分支 Tab
- `calculate_delay_interest` · 无分支
- `calculate_court_fee` · branchField='feeTypeLevel1'，2 分支 Tab
- `calculate_lawyer_fee` · branchField='caseType'，6 分支 Select
- `calculate_overtime_pay` · 无分支
- `calculate_social_insurance` · 无分支
- `calculate_divorce_property` · 无分支（childCustody 是普通字段）
- `calculate_date` · branchField='mode'，6 分支 Select
- `bank_rate_query` · branchField='queryType'，4 分支 Tab

按 `calculate_compensation` 的模板格式批量加。每个工具的 fields 列表参考 `shared/utils/tools/agentTools/<tool>.tool.ts` 的 zod schema 字段名 + describe 中文。

- [ ] **Step 2: typecheck**

Run: `bun run typecheck 2>&1 | grep "_fieldMetadata" | head -3`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add shared/utils/tools/agentTools/_fieldMetadata.ts
git commit -m "feat(agent): _fieldMetadata 补全剩余 9 个工具的字段元数据"
```

---

## 任务 PR-B-T13 至 PR-B-T21：9 个工具改造

每个工具按 `compensation` 的同样模式改造：

| Task | 工具文件 | 分支字段 | 必填字段（按分支） |
|------|---------|---------|------------------|
| T13 | `interestCalculator.tool.ts` | mode | lpr: amount/startDate/endDate; pboc: 同; simple: amount/startDate/endDate/customRate |
| T14 | `delayInterestCalculator.tool.ts` | — | amount/startDate/endDate |
| T15 | `courtFeeCalculator.tool.ts` | feeTypeLevel1 | caseFee: amount(财产案件); applicationFee: amount |
| T16 | `lawyerFeeCalculator.tool.ts` | caseType | civil/commercial/administrative: disputeAmount; criminal: caseDuration; consultation: consultationHours; document: documentType |
| T17 | `overtimePayCalculator.tool.ts` | — | monthlySalary + 至少一个加班时长 |
| T18 | `socialInsuranceCalculator.tool.ts` | — | monthlySalary/months |
| T19 | `divorcePropertyCalculator.tool.ts` | — | 至少一个资产或债务 > 0 |
| T20 | `dateCalculator.tool.ts` | mode | addDays/addMonths/addYears: startDate+amount; workingDays: startDate+endDate; legalDeadline/limitation: startDate+limitationType |
| T21 | `bankRateQuery.tool.ts` | queryType | 无（全部可选，查询场景）|

每个 task 的 5 个 step：

- [ ] **Step 1：写测试 5 cases**（mock interrupt + 4 条路径 + 边界 case）参考 T8 测试模板
- [ ] **Step 2：跑测试 FAIL**
- [ ] **Step 3：改造 *.tool.ts**（按 T8 compensation 模式）
- [ ] **Step 4：跑测试 PASS**
- [ ] **Step 5：Commit** `feat(agent): X 工具改造（interrupt + writeMemory + 必填校验）`

> bank_rate_query 工具特殊：纯查询无"用户输入"语义，**不调 interrupt 也不写 memory**，仅做参数 type 分支。改造时跳过 step ③ ⑤。

---

## 任务 PR-B-T22：agent-platform + AiToolRenderer + DB 批量注册

**Files:**
- Modify: `server/services/agent-platform/tools/index.ts`
- Modify: `app/components/ai/AiToolRenderer.vue`
- Modify: `prisma/seeds/seedData.sql`

- [ ] **Step 1: agent-platform/tools/index.ts 加 9 个 import + 9 个 toolModules 注册**

```typescript
import * as interestCalculatorTool from '#shared/utils/tools/agentTools/interestCalculator.tool'
import * as delayInterestCalculatorTool from '#shared/utils/tools/agentTools/delayInterestCalculator.tool'
import * as courtFeeCalculatorTool from '#shared/utils/tools/agentTools/courtFeeCalculator.tool'
import * as lawyerFeeCalculatorTool from '#shared/utils/tools/agentTools/lawyerFeeCalculator.tool'
import * as overtimePayCalculatorTool from '#shared/utils/tools/agentTools/overtimePayCalculator.tool'
import * as socialInsuranceCalculatorTool from '#shared/utils/tools/agentTools/socialInsuranceCalculator.tool'
import * as divorcePropertyCalculatorTool from '#shared/utils/tools/agentTools/divorcePropertyCalculator.tool'
import * as dateCalculatorTool from '#shared/utils/tools/agentTools/dateCalculator.tool'
import * as bankRateQueryTool from '#shared/utils/tools/agentTools/bankRateQuery.tool'
```

toolModules 加 9 行：

```typescript
    calculate_interest: interestCalculatorTool.interestCalculatorTool as any,
    calculate_delay_interest: delayInterestCalculatorTool.delayInterestCalculatorTool as any,
    calculate_court_fee: courtFeeCalculatorTool.courtFeeCalculatorTool as any,
    calculate_lawyer_fee: lawyerFeeCalculatorTool.lawyerFeeCalculatorTool as any,
    calculate_overtime_pay: overtimePayCalculatorTool.overtimePayCalculatorTool as any,
    calculate_social_insurance: socialInsuranceCalculatorTool.socialInsuranceCalculatorTool as any,
    calculate_divorce_property: divorcePropertyCalculatorTool.divorcePropertyCalculatorTool as any,
    calculate_date: dateCalculatorTool.dateCalculatorTool as any,
    bank_rate_query: bankRateQueryTool.bankRateQueryTool as any,
```

- [ ] **Step 2: AiToolRenderer.vue 加 9 行 INTERNAL_TOOL_MAP**

```typescript
calculate_interest: AiToolsCalculatorTool,
calculate_delay_interest: AiToolsCalculatorTool,
calculate_court_fee: AiToolsCalculatorTool,
calculate_lawyer_fee: AiToolsCalculatorTool,
calculate_overtime_pay: AiToolsCalculatorTool,
calculate_social_insurance: AiToolsCalculatorTool,
calculate_divorce_property: AiToolsCalculatorTool,
calculate_date: AiToolsCalculatorTool,
bank_rate_query: AiToolsCalculatorTool,
```

- [ ] **Step 3: DB nodes.assistantMain.tools 追加 9 个**

```bash
docker exec postgres psql -U daixin -d ls_new -c "
UPDATE nodes SET tools = tools
  || '[\"calculate_interest\",\"calculate_delay_interest\",\"calculate_court_fee\",\"calculate_lawyer_fee\",\"calculate_overtime_pay\",\"calculate_social_insurance\",\"calculate_divorce_property\",\"calculate_date\",\"bank_rate_query\"]'::jsonb
WHERE name = 'assistantMain';
"
```

- [ ] **Step 4: seedData.sql 同步**

Read 找 `assistantMain` 行的 tools JSON 数组，把 9 个工具名追加。

- [ ] **Step 5: typecheck + commit**

```bash
bun run typecheck 2>&1 | tail -5
git add server/services/agent-platform/tools/index.ts app/components/ai/AiToolRenderer.vue prisma/seeds/seedData.sql
git commit -m "feat(agent): toolModules + AiToolRenderer + nodes.tools 批量注册剩余 9 个 calculator"
```

---

## 任务 PR-B-T23：补全 CalculatorResult.vue（其余 9 个工具结果展示）

**Files:**
- Modify: `app/components/ai/tools/CalculatorResult.vue`

- [ ] **Step 1: 按 spec §8.5 对照表补 9 个 v-if 分支**

每个工具的结果展示**直接复用对应 `app/pages/dashboard/tools/<tool>.vue` 的结果区结构**（PR4 已经把它们都接入了 `ToolsResultCard`）。在 CalculatorResult.vue 内可以：

- 简单复用 `ToolsResultCard` 组件 + 复制各页面的 `<template #summary>` 块进来
- 或者直接把页面里抽到的子组件 import 进 CalculatorResult（如果 PR4 抽过的话）

按 toolName 加 v-if 分支：

```vue
<div v-if="toolName === 'calculate_interest'" class="...">
    <!-- 复制 app/pages/dashboard/tools/interest.vue 结果区结构 -->
</div>

<div v-else-if="toolName === 'calculate_delay_interest'" ...>...</div>
<!-- ... 其余 7 个 -->

<div v-else-if="toolName === 'bank_rate_query'" class="...">
    <!-- 利率表 Tab + 表格 -->
</div>
```

- [ ] **Step 2: typecheck + 浏览器走查**

Run: `bun run typecheck 2>&1 | grep CalculatorResult | head -3`

- [ ] **Step 3: Commit**

```bash
git add app/components/ai/tools/CalculatorResult.vue
git commit -m "feat(agent-ui): CalculatorResult 补全剩余 9 个工具结果展示"
```

---

## 任务 PR-B-T24：全量回归 + PR-B 收尾

- [ ] **Step 1: 跑全量测试**

Run:
```bash
npx vitest run tests/shared/utils/tools/ tests/server/services/memory/ tests/server/agents/legal-assistant/ 2>&1 | tail -10
```
Expected: 全 PASS（含 10 个工具的单测 + 1 个 E2E 测试）

- [ ] **Step 2: typecheck**

Run: `bun run typecheck 2>&1 | tail -5`
Expected: 无新错误

- [ ] **Step 3: 浏览器人工走查 10 个工具**

在法律助手分别问 10 个场景：

| 工具 | 触发问题 | 期望路径 |
|------|--------|--------|
| compensation | "工伤赔偿，月薪 1.2 万伤残 8 级" | A 直算 |
| interest | "本金 100 万，2019-01-01 至 2024 末，按 LPR 算利息" | A 或 B（看 LLM 抽取）|
| delay-interest | "10 万本金，2020-2024 迟延履行利息" | A 或 B |
| court-fee | "争议金额 500 万的诉讼费" | A 直算 |
| lawyer-fee | "刑事案件律师费" | B 弹卡片（缺 caseDuration）|
| overtime | "加班费，月薪 1 万，工作日加班 20 小时" | A 直算 |
| social-insurance | "社保追缴 12 个月" | B 弹卡片（缺 monthlySalary）|
| divorce-property | "离婚财产分割" | B 弹卡片（缺资产）|
| date | "起算日 2024-01-01 后 60 天" | A 直算 |
| bank-rate | "查 2024 年 LPR" | A 直查 |

3 条路径每条至少触发 1 次。点取消验证 cancelled 衔接。

- [ ] **Step 4: PR-B 收尾 commit**

```bash
git commit --allow-empty -m "chore(agent): PR-B 完成 - 10 个 calculator 工具全接入法律助手"
```

---

## 收尾交付物清单

**新建：**
- `shared/utils/tools/agentTools/_fieldMetadata.ts`（含 10 工具元数据）
- `app/components/ai/tools/CalculatorTool.vue`
- `app/components/ai/tools/CalculatorFormFields.vue`
- `app/components/ai/tools/CalculatorResult.vue`
- `tests/server/agents/legal-assistant/calculator-tools.e2e.test.ts`

**修改：**
- `shared/types/case.ts`（InterruptType + TypedInterruptData）
- `shared/types/memory.ts`（MemoryKind + CaseMemoryMetadata）
- `server/services/memory/memory.service.ts`（writeMemoryService 加 extraMetadata + findLastCalculationByCase）
- `shared/utils/tools/agentTools/*.tool.ts`（10 个工具改造）
- `tests/shared/utils/tools/agentTools/*.tool.test.ts`（10 个工具测试改造）
- `server/services/agent-platform/tools/index.ts`（toolModules 注册 10 个）
- `app/components/ai/AiToolRenderer.vue`（INTERNAL_TOOL_MAP 注册 10 个）
- `app/components/case/interrupt/index.ts`（globalInterruptRegistry 注册 calculator_input）
- `prisma/seeds/seedData.sql`（nodes.assistantMain.tools 加 10 个）

**测试覆盖：**
- memory.service 3 cases（extraMetadata 透传 / findLastCalculationByCase 查最近 / 无记录返回 null）
- 10 个工具各 5 cases（路径 A / B / C + ctx.caseId 空 + resume 非法）
- E2E 3 cases（A / B / C 全链路）+ 1 case（注册表完整性）

**生效条件：**
- prisma migrate（本次无 schema 变更）
- 服务重启后 LLM 在法律助手对话中即可调 10 个 calculator
