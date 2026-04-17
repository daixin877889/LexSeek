# 文书生成 · 实施 Spec（Phase 3）

> **父 spec**: [`2026-04-17-legal-assistant-design.md`](./2026-04-17-legal-assistant-design.md) §7
>
> **关系**：本文档对父 spec §7 做实施细化。**与 §7 的任何冲突以本文档为准**；未被本文档覆盖的部分（表字段定义、API 路径、导出实现细节等）沿用 §7。
>
> **受众**：实施文书生成功能的工程师与 AI 协作代理。

---

## 1. 目标与范围

### 1.1 功能目标

律师选择预设 / 私人文书模板，提交案情材料（粘贴文本 / 文件上传 / 案件材料），AI 通过 Agent 架构调用检索工具整合上下文并输出结构化占位符填充结果；用户通过表单调整字段后导出带格式的 .docx。

### 1.2 本次交付范围（Phase 3 全量）

与父 spec §9.3 对齐，**全部**纳入本次迭代：

- `documentTemplates` + `documentDrafts` 两张新表，以及 `caseMaterials` 加 `draftId` 字段的 schema 变更
- `documentMain` agent 节点 + `documentMain_system` 提示词 v1
- 两个工具：`search_case_materials`（扩展加 `draftId` 参数，不新建工具）+ `search_law`（完全复用）；**不再**实现 `draftDocument` / `searchDraftMaterials` 这样的重复工具
- 服务层：模板扫描、模板 CRUD、draft CRUD、材料聚合、schema 动态构造、导出
- 6 个 API 端点（见 §9）
- 用户侧页：`/dashboard/assistant/document` + `DocumentDraftPanel` 组件 + docx-preview 实时预览
- 管理员侧页：`/admin/document-templates`
- 案件详情 `documents` tab 复用
- 积分键 `document_draft_token` 与计费接入
- 批量导入脚本 `scripts/importDocumentTemplates.ts`

### 1.3 不在本次范围

- 首批 100+ 模板的实际内容准备（运营依赖，见 §15 O1）
- 移动端适配（PC 优先，移动端后续迭代）
- 文书内容协作编辑（仅表单式编辑，不做富文本）

---

## 2. 与父 spec §7 的差异摘要

| 父 spec §7 设计 | 本文档新方案 | 理由 |
|---|---|---|
| `draftDocument` 工具 + Agent 调工具写库 | **删除 `draftDocument` 工具**；用 LangChain v1 `createAgent` 的 `responseFormat` 原生结构化输出；写库放 `draftResultPersistenceMiddleware`（仿现有 `analysisResultPersistenceMiddleware`）的 `afterAgent` 钩子 | 减少工具数量与 tool_choice 强制机制；responseFormat 是 v1 发布重点能力；项目里已经有 `beforeAgent + afterAgent` 持久化中间件的成熟范本可仿 |
| 通用 responseFormat（`z.record(string, string)`） | **每个模板动态构造专属 Zod schema**：`z.object({ 占位符1: ..., 占位符2: ... })` | 占位符在扫描阶段已完全已知；专属 schema 精确约束输出 keys，降低幻觉 |
| 材料聚合器三路径拼接塞 prompt | 材料聚合器**只处理用户粘贴文本**；文件与案件材料统一通过**扩展后的 `search_case_materials` 工具**按需检索 | 避免大材料爆上下文；独立/案件两场景无分支 |
| 新建 `searchDraftMaterials` 工具 | **扩展现有 `search_case_materials` 工具**（`server/services/workflow/tools/searchCaseMaterials.tool.ts`）：参数 schema 加可选 `draftId`；service 函数 `searchMaterialsService` 增加 `draftId` 参数 | 两个工具 99% 重复；现有工具已注册到 `toolModules` registry，直接改最小开销 |
| 新建 `deductAgentTokens` helper | 用现有 **`pointConsumptionMiddleware(userId, 'document_draft_token', sessionId)`**（`server/services/workflow/middleware/pointConsumption.middleware.ts`），与 caseMain / assistantMain 同路径 | 积分扣减中间件已通用，只需换 `itemKey` 参数 |
| 手写 `renderContent` 替换变量 | 用现有 **`renderSystemPrompt(nodeConfig, context)`**（`server/services/workflow/utils/promptRenderer.ts`） | 已通用，不必重写 |
| 占位符正则 `[a-zA-Z_][\w]*` | **扩展支持中文**：`[\u4e00-\u9fa5\w]+`（如 `{{原告}}`） | 律师日常用中文模板；与实际使用场景匹配 |
| 分类枚举：起诉状 / 答辩状 / 函件 / 合同 / 其它（文书类型粒度） | **9 类，按律师实务场景**：律师通用工具 / 起诉·应诉·上诉 / 流程变更·程序操作 / 证据·鉴定·调查取证 / 保全·冻结·先予执行 / 执行·追偿·强制措施 / 仲裁·调解·担保物权 / 人身安全保护令 / 身份·监护·失踪 | 与律师真实业务场景对齐；保证 UI 简洁 |
| 提示词含"最多 2 次 `searchCaseMaterials`" | **删除次数限制**，效果优先；按需检索直至获取足够信息 | 成本优先让位于质量 |
| draftDocument 工具名义上挂 `assistantMain.tools` | **新建独立 `documentMain` agent 节点**（type=agent），**其实现文件 `documentMainAgent.ts` 仿照 `server/services/workflow/agents/caseMainAgent.ts` 骨架** | 职责隔离：caseMain 范本已完备（节点配置加载 + 模型构造 + 工具注入 + 中间件堆栈），documentMain 只需参数化节点名 |
| 未明确"重填" UX | **重填 = 创建新 draft**，旧 draft 归档 | 最简心智模型；历史可查 |
| 未说明 session scope | 用现有 `caseSessions.scope='assistant'`（已在父 spec Phase 1 落地） + `caseId` 可空 | 不新增 scope 维度 |
| 未说明 SSE / run / worker 基建 | **原样复用** `createAgentSseStream` / `enqueueRunService` / `AgentWorker` | 已通用于 caseMain 和 assistantMain |

---

## 3. 本次迭代决策一览

| 决策项 | 结论 |
|---|---|
| 交付范围 | §9.3 全量，含 admin 页 + 案件 tab + 实时预览 + 批量导入 |
| 首批样本模板 | 3-5 个手工准备的 .docx，置于 `prisma/seeds/document-templates/` |
| 私人模板配额 | 统一 20 个 / 用户，不区分会员等级；service 层常量 |
| 计费单价 | 复用 `assistant_token` 默认（单价 1、discount 1、unit=千tokens）；新键 `document_draft_token` |
| 材料输入渠道 | 粘贴文本 + 文件上传 + 案件材料（仅案件 tab 场景） |
| 实施策略 | 自底向上垂直切片，7 个里程碑（见 §12） |
| AI 输出机制 | Agent + `responseFormat`（动态构造），无 draftDocument 工具 |
| 重填策略 | 新建 draft，旧归档可查 |

---

## 4. 架构总览

### 4.1 端到端流程

```
用户 POST /api/v1/assistant/document/drafts
  body: { templateId, sourceText?, sourceFileIds?, caseId? }
    ↓
[创建阶段] documentDraft.service
  ├─ 校验 templateId 存在且可见（global 或属于当前用户）
  ├─ 校验 caseId 归属（若存在）
  ├─ 创建 caseSession (scope='assistant', caseId?)
  ├─ 创建 documentDrafts 行（status='drafting', sourceRef={text,fileIds,caseId}）
  ├─ 若 sourceFileIds：调 material 模块预处理（OCR + chunk + embedding）
  │   - 文件以 caseMaterials 记录：caseId=null, draftId=<本 draft>
  │   - 等待所有文件 status='processed' 再入队（同步等待或轮询）
  └─ enqueueRunService → agentWorker
    ↓
[Agent 阶段] agentWorker → runDocumentMainAgent(draftId, sessionId)
  ├─ 读 draft + template（拿 placeholders 清单）
  ├─ 更新 status='filling'
  ├─ buildDraftSchema(template.placeholders)  → 专属 Zod schema
  ├─ buildInitialMessages(draft.sourceRef.text)  → 初始 user message
  ├─ createAgent({
  │    model, tools: [search_case_materials (扩展后), search_law],
  │    systemPrompt: renderPrompt(documentMainPromptV1, { templateName, templateCategory }),
  │    responseFormat: draftSchema,
  │  })
  ├─ agent.invoke({ messages: [initialMessages] })  // AI 按需调检索工具
  ├─ 读 result.structuredResponse = { values, suggestions? }
  ├─ 更新 draft: values, metadata={suggestions}, status='ready'
  ├─ 按 run 累计 token 扣积分（key='document_draft_token'）
  └─ SSE 推送 runStatus='completed'
    ↓
[前端阶段] DocumentDraftPanel 监听 runStatus
  ├─ completed → GET /drafts/:id 拉最新 values
  ├─ 渲染表单字段（按 placeholder 命名推断控件类型）+ docx-preview 实时预览
  ├─ 用户编辑字段 → debounce 500ms → PATCH /drafts/:id
  ├─ 用户点击"导出" → POST /drafts/:id/export
  │    → docxtemplater 渲染（nullGetter 兜底）→ 上传 OSS → 返回 downloadUrl
  └─ 用户下载 .docx；可选"保存到案件材料库"（仅案件场景）
```

### 4.2 Agent 架构要点

**单一 Agent 路径，无场景分支**。独立生成和案件内生成走完全相同的：

- 同一个 `documentMain` 节点
- 同一套工具 `[search_case_materials (扩展), search_law]`
- 同一个 responseFormat 构造函数（输入不同的 placeholders）

场景差异**仅**体现在 `search_case_materials` 工具内部：按调用参数 `draftId`（文书生成场景） / 上下文中的 `caseId`（案件场景）分流查询。

### 4.3 为什么选 responseFormat 而非 draftDocument 工具

| 维度 | draftDocument 工具方案 | responseFormat 方案（本文档） |
|---|---|---|
| 输出结构化保证 | 工具 schema 严格 | responseFormat 原生强制 |
| 完成判定 | AI 调工具 → 工具 execute 写库 | agent 循环结束 → caller 读 structuredResponse 写库 |
| AI 不调工具风险 | 需 tool_choice middleware 兜底 | 不存在（responseFormat 强制输出） |
| 提示词复杂度 | "最后必须调 draftDocument" 硬约束 | "按 schema 输出填充结果" |
| 代码面 | 工具 + middleware + 写库逻辑分散 | 写库集中在 agentWorker 一处 |

---

## 5. 数据模型增量

### 5.1 新表：`documentTemplates`

定义沿用父 spec §4.7，此处仅强调关键字段：

- `placeholders`: `Json`，扫描得到的 `[{ name, firstContext }]` 数组
- `scope`: `"global"` | `"user"`，应用层保证 `scope='user'` 必有 `userId`
- `category`: 必须是 `DOCUMENT_CATEGORY_KEYS` 之一（见 §8.2）
- `status`: 1 启用 / 0 禁用

### 5.2 新表：`documentDrafts`

定义沿用父 spec §4.8，本文档强化**状态机**：

```
drafting   ← POST /drafts 刚创建
  ↓ (agentWorker 启动)
filling    ← agent.invoke() 执行中
  ↓ (成功)              ↓ (异常)
ready      ← 可编辑/导出  failed  ← 终态，用户可基于同模板新建 draft
  ↓ (POST /drafts/:id/export)
exported   ← outputFileId 写入；用户仍可编辑再次导出（状态不回退）
```

用户编辑字段不改 status（`ready` 或 `exported` 均可编辑）。`failed` 是终态，**没有原地重试**；重填按 §3 创建新 draft。

**`caseMaterials.(caseId, draftId)` XOR 约束**：仅在应用层 DAO 前置校验，不在 DB 层建 CHECK。迁移时既有行全部 `caseId NOT NULL, draftId=null`，新字段 default null，无需回填。

### 5.3 改表：`caseMaterials` 新增 `draftId`

```prisma
model caseMaterials {
    // ... 原字段 ...
    caseId    Int?      @map("case_id")     // 改为 optional
    draftId   Int?      @map("draft_id")    // 新增
    // ...

    draft documentDrafts? @relation(fields: [draftId], references: [id], onDelete: NoAction, onUpdate: NoAction)

    @@index([draftId], map: "idx_case_materials_draft")
}
```

**应用层 XOR 校验**：`caseId` 和 `draftId` 至多一个非空（DAO 创建函数前置校验）。

**用途**：
- 案件材料：`caseId=X, draftId=null`（现状）
- 文书 draft 上传的文件：`caseId=null, draftId=Y`（新增）
- 复用现有 OCR、chunk、embedding、向量检索栈

### 5.4 Nodes / Prompts / PointRules

| 表 | 新增行 |
|---|---|
| `nodes` | `name='documentMain', type='agent', tools=['search_case_materials','search_law'], priority=30` |
| `prompts` | `documentMain_system` v1，挂 `documentMain` 节点，含变量 `{{templateName}}` / `{{templateCategory}}` |
| `point_consumption_items` | `key='document_draft_token', group='agentToken', unit='千tokens', pointAmount=1, discount=1` |

所有 seed 同步写入：
- `prisma/seed.ts` 的 `seedDocumentMainNode` / `seedDocumentDraftTokenRule` 函数（供 `bun prisma db seed` 使用）
- `prisma/seeds/seedData.sql`（供新环境初始化）

### 5.5 迁移命令

```bash
bun run prisma:migrate dev --name add_document_templates_and_drafts_and_case_materials_draft_id
```

---

## 6. Agent 实现（核心）

**总原则：骨架与中间件尽量复用，Schema 构造、持久化中间件为新增。**

### 6.1 `documentMain` 节点配置

| 字段 | 值 |
|---|---|
| `name` | `documentMain` |
| `type` | `agent` |
| `priority` | 30 |
| `modelId` | 复用 `assistantMain.modelId`；缺失回退首个启用 model |
| `tools` | `['search_case_materials', 'search_law']`（注意：**工具名沿用现有注册名**，不新建 `searchDraftMaterials`） |
| `status` | 1 |

### 6.2 Agent 骨架：仿 `caseMainAgent.ts`

`server/services/workflow/agents/documentMainAgent.ts` 严格仿 `caseMainAgent.ts`（L65-180）的节点加载与装配顺序，差异处**仅限**：

| 维度 | caseMainAgent | documentMainAgent |
|---|---|---|
| 节点名 | `caseMain` | `documentMain` |
| 工具集 | 配置 + skills + subAgents | 配置中的 `[search_case_materials, search_law]`，**不加 skills、不装子 agent** |
| 中间件堆栈 | pointConsumption + caseProcessMaterial + moduleContext + summarization + safetyTrim + skillsMiddleware | pointConsumption + **draftResultPersistence（新增）** + summarization + safetyTrim |
| `systemPrompt` | `renderSystemPrompt(mainConfig, { caseId })` | `renderSystemPrompt(mainConfig, { caseId, templateName, templateCategory, placeholdersWithContext })` |
| `responseFormat` | 无 | `buildDraftSchema(template.placeholders)` |
| `createAgent` 其他参数 | 原样 | 原样 |
| 计费键 | `'case_analysis_token'` | `'document_draft_token'` |

**关键：** 工具工厂 (`getToolInstancesService`) / 模型工厂 (`createChatModel`) / 提示词渲染 (`renderSystemPrompt`) / checkpointer / store / 中间件 **全部复用**，不新建任何工厂函数。

### 6.3 responseFormat 动态构造（新增模块）

```typescript
// server/services/assistant/document/draftSchema.builder.ts
import { z } from 'zod'
import type { Placeholder } from './types'

/**
 * 为每个模板动态构造 Zod schema，限定 LLM 结构化输出的 keys。
 *
 * 设计决策：值类型统一用 `string | null` 保留灵活性。
 * 格式约束（日期 regex、金额 number）交给**前端表单**做，schema 层不强校验。
 */
export function buildDraftSchema(placeholders: Placeholder[]) {
    const valueShape: Record<string, z.ZodType> = {}
    for (const ph of placeholders) {
        const ctx = ph.firstContext.slice(0, 200).replace(/\n/g, ' ')
        valueShape[ph.name] = z
            .string()
            .nullable()
            .describe(`占位符「${ph.name}」出现于："${ctx}"`)
    }
    return z.object({
        values: z.object(valueShape),
        suggestions: z
            .record(z.string(), z.string())
            .optional()
            .describe('对无法从材料推断的占位符给出建议值'),
    })
}
```

### 6.4 工具：扩展现有 `search_case_materials`（不新建）

对现有 `server/services/workflow/tools/searchCaseMaterials.tool.ts` 做**最小增强**：

```typescript
// schema 新增可选 draftId
const schema = z.object({
    query: z.string().optional().describe('语义查询内容'),
    sourceId: z.number().optional().describe('材料 sourceId，精确检索'),
    draftId: z.number().optional().describe('文书 draft ID（文书生成场景传入）'),
    k: z.number().max(20).optional().default(5),
}).refine(
    data => data.query || data.sourceId,
    { message: '至少需要提供 query 或 sourceId' }
)

// createTool 内分支：
if (caseId == null && !input.draftId) {
    throw new Error('search_case_materials 工具需要 caseId 或 draftId，当前上下文均缺失')
}
// 分支调用 searchMaterialsService（service 签名加 draftId 可选参数）：
const results = await searchMaterialsService(userId, caseId, {
    query, sourceId, k, draftId: input.draftId,
})
```

`searchMaterialsService` 内部：`draftId` 存在时查 `caseMaterials WHERE draftId=X`；否则查 `caseId=Y`；两者都有走合并。

**不改工具名** `search_case_materials`，避免影响已上线的 caseMain / assistantMain 节点 `tools` 数组。description 更新为"检索当前案件或文书 draft 的材料内容"。

### 6.5 工具：`search_law`

完全复用，零改动。

### 6.6 持久化中间件：`draftResultPersistenceMiddleware`（新增，仿 analysis 中间件）

**仿照 `server/services/workflow/middleware/analysisResultPersistence.middleware.ts` 的结构**，实现：

```typescript
// server/services/workflow/middleware/draftResultPersistence.middleware.ts
import { createMiddleware } from 'langchain'
import { updateDocumentDraftDAO } from '../../assistant/document/documentDraft.dao'

interface DraftResultPersistenceOptions {
    draftId: number
    sessionId: string
}

export const draftResultPersistenceMiddleware = (options: DraftResultPersistenceOptions) =>
    createMiddleware({
        name: 'DraftResultPersistence',
        beforeAgent: async () => {
            await updateDocumentDraftDAO(options.draftId, { status: 'filling' })
        },
        afterAgent: async ({ state }) => {
            // LangChain v1 createAgent 把 responseFormat 结果放到 state.structuredResponse
            const structured = state.structuredResponse as
                | { values: Record<string, string | null>; suggestions?: Record<string, string> }
                | undefined
            if (!structured) {
                await updateDocumentDraftDAO(options.draftId, { status: 'failed' })
                return
            }
            await updateDocumentDraftDAO(options.draftId, {
                values: structured.values,
                metadata: structured.suggestions ? { suggestions: structured.suggestions } : undefined,
                status: 'ready',
            })
        },
    })
```

中间件位置：放在 middleware 数组**末位**，保证 `afterAgent` 在 summarization / safetyTrim 之后执行（与现有 analysis 中间件同规则）。

### 6.7 运行入口（service 层，精简版）

```typescript
// server/services/workflow/agents/documentMainAgent.ts
export async function runDocumentChat(
    sessionId: string,
    draftId: number,
    options: { userId: number; caseId?: number; signal?: AbortSignal },
): Promise<ReadableStream<Uint8Array>> {
    // 仿 runCaseChat：并发加载 checkpointer/store/nodeConfig
    // 加载 draft + template → buildDraftSchema
    // 组装 tools（getToolInstancesService） + middleware（含 draftResultPersistence）
    // createAgent({ model, tools, systemPrompt, responseFormat: schema, middleware })
    // 返回 agent.stream(...)，SSE 格式 encoding 与 caseMain 一致
}
```

**调用入口**：`enqueueRunService({ sessionId, handler: 'document' })` → `AgentWorker.executeRun` 选择 `runDocumentChat`。Worker 现有派发逻辑通过 handler 字段调相应 runner，本期给 worker 的 handler map 加一项 `document: runDocumentChat`，不改 worker 主体。

### 6.8 提示词 `documentMain_system` v1

```text
你是 LexSeek 的文书生成助手。用户已选定文书模板并提供部分初始材料。

# 任务
调用检索工具获取足够上下文，按响应格式（response schema）精准填充占位符。
schema 中每个字段的 description 已说明占位符的首次出现上下文。

# 工具
- search_case_materials：检索用户上传的文件（文书 draft 场景会自动限定到当前 draft）或案件材料（案件场景自动限定到当前 caseId）
- search_law：查询法条原文与司法解释

# 检索策略
- 按占位符语义主动检索（如"借款金额" → 搜"金额 / 借款 / 本金"）
- 不限制检索次数，直至获取足够信息
- 避免重复检索同一内容

# 当前模板
名称：{{templateName}}
类别：{{templateCategory}}

# 填充要求
- 日期格式优先"YYYY年MM月DD日"（除非上下文明显是公历）
- 金额保留币种前缀与原数字
- 无法从材料推断的占位符：values 中对应键填 null，suggestions 中给建议值
- 严禁编造姓名 / 身份证号 / 具体日期 / 案号
```

### 6.9 复用清单（实施必读）

实施 M3 时**禁止**新建以下组件的替代实现，全部复用现有路径：

| 要做的事 | 现有文件 / 函数 |
|---|---|
| 构造 agent 骨架 | 仿 `server/services/workflow/agents/caseMainAgent.ts` |
| 加载节点配置 | `getValidNodeConfig` / `getNodeConfigsByTypes`（`server/services/node/node.service.ts`） |
| 构造模型实例 | `createChatModel`（`server/services/node/chatModelFactory.ts`） |
| 渲染系统提示词 | `renderSystemPrompt`（`server/services/workflow/utils/promptRenderer.ts`） |
| 工具按名加载 | `getToolInstancesService`（`server/services/workflow/tools/index.ts`） |
| 工具注册 | `toolModules` 字典，不加新 key；扩展现有 `search_case_materials` |
| checkpointer / store | `getCheckpointer / getStore`（`server/services/workflow/checkpointer.ts`） |
| 积分扣减 | `pointConsumptionMiddleware(userId, 'document_draft_token', sessionId)`（`server/services/workflow/middleware/pointConsumption.middleware.ts`） |
| 结果持久化 | 仿 `analysisResultPersistence.middleware.ts` 实现 `draftResultPersistence.middleware.ts` |
| SSE 推送 | `createAgentSseStream`（`server/services/sse/agentSseStream.ts`） |
| Run 入队与执行 | `enqueueRunService` + `AgentWorker`（`server/services/agent/`）；在 handler 分发上加 `document` 路由 |
| 材料 OCR/embedding 栈 | `materialPipeline.service.ts` + `materialEmbedding.service.ts`（不改，仅在 DAO 层把 caseMaterials 查询 WHERE 增加 draftId 分支） |
| 会话表 | `caseSessions` with `scope='assistant'`（父 spec Phase 1 已上线） |
| 前端流管理 | `useStreamChat`（`app/composables/useStreamChat.ts`）；`useDocumentDraft` 仿 `useAssistantChat` 组装 |
| 前端消息/工具展示组件 | 复用 `AssistantChatPanel` 内部的 `AiChat` / `ToolUseExplainer` / `AiMessageList` 组件 |

**未来扩展点**（不在本期）：通过 `subAgentToolFactory`（`server/services/workflow/agents/subAgentToolFactory.ts`）把 `documentMain` 作为 caseMain 的子代理注入，实现"在小索子对话里直接触发文书生成"——本期不做，节点 type=`agent` 使其天然具备这个能力。

---

## 7. 材料处理

### 7.1 初始 user message 构造

只用 `draft.sourceRef.text`（用户粘贴文本）作为初始 user message。用户粘贴的文本天然量小（通常几千字以内），直接塞进上下文没问题。

不拼接文件解析文本、不拼接 caseMaterials 内容——这些由 AI 通过扩展后的 `search_case_materials` 按需检索（文书 draft 场景自动限定到 draftId；案件场景限定到 caseId）。

### 7.2 sourceFileIds 预处理

`POST /drafts` 阶段：

```typescript
for (const fileId of sourceFileIds ?? []) {
    await ensureCaseMaterialForDraft(fileId, draftId)  // 如未预处理，入队列 + 同步等待完成
}
```

`ensureCaseMaterialForDraft` 逻辑：

1. 看是否已有 `caseMaterials WHERE ossFileId=fileId AND draftId=<draftId>`
2. 无则创建 + 入 material 处理队列（OCR → chunk → embedding）
3. 轮询 / 监听直到 `status='processed'`；超时则 API 返回 "材料处理超时，请稍后重试"

### 7.3 caseId 关联

案件场景下，`draft.sourceRef.caseId` 指向 `cases.id`。agent 运行时 caseId 注入 `ToolContext`，`search_case_materials` 工具未传 `draftId` 参数时默认走 `caseId` 分支查该 case 的 `caseMaterials`（`caseId=X, draftId=null` 的原案件材料）。

---

## 8. 占位符与模板

### 8.1 中文占位符扫描

```typescript
// server/services/assistant/document/templateScanner.ts
import mammoth from 'mammoth'

const PLACEHOLDER_RE = /\{\{([\u4e00-\u9fa5\w]+)\}\}/g

export async function scanPlaceholders(docxBuffer: Buffer): Promise<Placeholder[]> {
    const { value: rawText } = await mammoth.extractRawText({ buffer: docxBuffer })
    const map = new Map<string, string>()
    let match
    while ((match = PLACEHOLDER_RE.exec(rawText)) !== null) {
        const name = match[1]
        if (!map.has(name)) {
            const lineStart = rawText.lastIndexOf('\n', match.index) + 1
            const lineEnd = rawText.indexOf('\n', match.index + match[0].length)
            const firstContext = rawText.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
            map.set(name, firstContext)
        }
    }
    return [...map.entries()].map(([name, firstContext]) => ({ name, firstContext }))
}
```

支持中英混合占位符：`{{原告}}` / `{{plaintiff_name}}` / `{{loan_amount}}` / `{{借款金额}}` 均合法。

### 8.2 分类枚举（9 类）

```typescript
// shared/types/document.ts
export const DOCUMENT_CATEGORIES = [
    { key: 'general',          label: '律师通用工具' },
    { key: 'litigation',       label: '起诉·应诉·上诉' },
    { key: 'procedure',        label: '流程变更·程序操作' },
    { key: 'evidence',         label: '证据·鉴定·调查取证' },
    { key: 'preservation',     label: '保全·冻结·先予执行' },
    { key: 'enforcement',      label: '执行·追偿·强制措施' },
    { key: 'arbitration',      label: '仲裁·调解·担保物权' },
    { key: 'protection_order', label: '人身安全保护令' },
    { key: 'identity',         label: '身份·监护·失踪' },
] as const

export type DocumentCategoryKey = typeof DOCUMENT_CATEGORIES[number]['key']
export const DOCUMENT_CATEGORY_KEYS = DOCUMENT_CATEGORIES.map(c => c.key) as readonly DocumentCategoryKey[]
```

模板 CRUD 校验 `category ∈ DOCUMENT_CATEGORY_KEYS`。

### 8.3 控件类型推断（中英双轨）

前端 `DocumentFieldForm` 组件渲染字段时按下表推断控件：

| 控件类型 | 英文关键字 | 中文关键字 | 示例 |
|---|---|---|---|
| DatePicker | `date`, `_at`, `_time` | 含"日期"、"时间" | `contract_date` / `{{签订日期}}` |
| Number + 千分位 | `amount`, `money`, `fee`, `price` | 含"金额"、"费用"、"价格"、"款" | `loan_amount` / `{{借款金额}}` |
| Input + 11 位 | `phone`, `mobile` | 含"电话"、"手机" | `{{手机号}}` |
| Input + 18 位 | `id_number`, `_id_card` | 含"身份证" | `{{身份证号}}` |
| Select 男/女 | `sex`, `gender` | 含"性别" | `{{性别}}` |
| Select（AI 建议） | `_type` 结尾 | 含"类型"、"类别" | `{{合同类型}}` |
| Input / textarea | 默认 | 默认 | `{{原告}}` |

值 > 50 字符自动升级为 textarea。

---

## 9. API 契约

沿用父 spec §7.9，此处仅列出要点与本文档强化的部分。

### 9.1 模板 CRUD

```
GET    /api/v1/assistant/document/templates?scope=global|user|all&category=X&q=&page=1&pageSize=20
POST   /api/v1/assistant/document/templates         multipart/form-data
GET    /api/v1/assistant/document/templates/:id
PATCH  /api/v1/assistant/document/templates/:id
DELETE /api/v1/assistant/document/templates/:id
```

**关键约束**：
- 用户上传 scope=user 时，service 层强制校验 `count(userId=X, scope=user, deletedAt=null) < 20`
- admin 上传自动判为 scope=global
- 文件大小 ≤ 20MB、格式必须 `.docx`
- 扫描不到占位符 → 400 拒绝

### 9.2 Draft 生命周期

```
POST  /api/v1/assistant/document/drafts                body: { templateId, sourceText?, sourceFileIds?, caseId? }
GET   /api/v1/assistant/document/drafts/:id
PATCH /api/v1/assistant/document/drafts/:id            body: { values: Record<string, string | null> }
POST  /api/v1/assistant/document/drafts/:id/export
GET   /api/v1/assistant/document/drafts?page=&pageSize=&caseId=
```

**PATCH 校验**：后端按 `buildDraftSchema(template.placeholders)` 的 keys 校验；多余 key 忽略，缺失 key 保持旧值。

**POST /drafts 同步性**：接口**立即返回** `{ draftId, sessionId }`，不等 agent 结果；`draft.status` 随后由 agentWorker 异步推进（drafting → filling → ready）。前端通过 SSE `runStatus` 事件感知 agent 完成。若 `sourceFileIds` 需预处理，`POST` 同步等待材料 OCR 就绪（≤ 30s）再返回；超时返回 503。

**POST /drafts/:id/export 响应**：统一 `{ ossFileId: number, downloadUrl: string }`（downloadUrl 为 OSS 预签名 URL，有效期 1 小时）。

**PATCH 并发保护**：若 draft.status 处于 `drafting` / `filling`（agent 仍在运行），PATCH 返回 409；仅 `ready` / `exported` 允许用户编辑。

---

## 10. UI 实现

### 10.1 路由与页面

| 路径 | 页面 | 权限 |
|---|---|---|
| `/dashboard/assistant/document` | 文书生成主页 | 登录用户 |
| `/dashboard/assistant/document/templates` | 私人模板管理 | 登录用户 |
| `/admin/document-templates` | 全局模板管理 | super_admin |
| `/dashboard/cases/[id]` → `documents` tab | 案件内文书生成 | 案件所有者 / 协作者 |

### 10.2 组件划分

```
DocumentDraftPanel (主组件)
├── DocumentTemplatePicker   （分类 Tab + 模板卡片 + 已选态）
├── DocumentSourceInput       （AiPromptInput：文本 + 文件 + caseMaterials 多选）
├── DocumentFieldForm         （字段表单，按 §8.3 推断控件）
└── DocumentPreview           （docx-preview + TreeWalker 替换）
```

**组件只负责渲染**，数据流集中在 `useDocumentDraft` composable（**仿 `useAssistantChat.ts`** 结构，底层复用 `useStreamChat` 泛型：SSE 订阅 / runStatus / interruptData / resumeInterrupt 等逻辑全部沿用，不重写流管理）：

```typescript
// app/composables/useDocumentDraft.ts（骨架）
export function useDocumentDraft(draftId: Ref<number | null>) {
    const stream = useStreamChat({ apiUrl: '/api/v1/assistant/document/chat', threadId: /* from draft.sessionId */ })
    const draft = ref<DocumentDraft | null>(null)
    const template = computed(() => /* 从 draft.templateId 查模板缓存 */)
    return {
        draft,
        template,
        runStatus: stream.runStatus,            // 直接透传
        messages: stream.messages,
        onStart: (prompt: string) => stream.submit({ messages: [{ type: 'human', content: prompt }] }),
        onFieldChange: debounce(patchValues, 500),
        onExport,
        onRegenerate,
    }
}
```

### 10.3 实时预览技术实现

```typescript
// 主流程
async function updatePreview(values: Record<string, string | null>) {
    if (!previewRoot.value || !templateDocxBuffer.value) return
    // 1. docx-preview 渲染原模板到隐藏容器（首次）
    if (!renderedOnce.value) {
        await renderAsync(templateDocxBuffer.value, previewRoot.value)
        renderedOnce.value = true
    }
    // 2. 遍历所有文本节点做占位符替换（原地）
    replacePlaceholders(previewRoot.value, values)
}

const debouncedUpdate = useDebounceFn(updatePreview, 500)
watch(() => formValues, (v) => debouncedUpdate(v), { deep: true })
```

**降级策略**（M5 验收时若 TreeWalker 替换因占位符跨 `<w:r>` 切分而不稳）：
- **降级触发门槛**：M5 验收用 3-5 个样本模板 × 5 个典型填充场景 = 15-25 次渲染；**失败率 > 10%** 即触发降级
- 降级方案 A：保留 docx-preview 渲染，但去掉自动 debounce；改为手动"刷新预览"按钮触发
- 降级方案 B：完全去掉实时预览，改为"下载预览 PDF"按钮调后端渲染
- 优先选方案 A（保留视觉反馈，降低交互压力）；A 仍不稳再降到 B

---

## 11. 导出实现

沿用父 spec §7.8：

```typescript
// server/services/assistant/document/documentExport.service.ts
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'

export async function exportDraft(draftId: number): Promise<{ ossFileId: number }> {
    const draft = await getDocumentDraftDAO(draftId)
    const template = await getDocumentTemplateDAO(draft.templateId)
    const templateBuffer = await downloadFromOSS(template.ossFileId)

    const zip = new PizZip(templateBuffer)
    const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: '{{', end: '}}' },
        nullGetter: () => '',   // 缺失占位符统一兜底空字符串
    })

    doc.render(draft.values as Record<string, string>)

    const outputBuffer = doc.getZip().generate({ type: 'nodebuffer' })
    const ossFileId = await uploadToOSS(outputBuffer, `draft-${draftId}.docx`)

    await updateDocumentDraftDAO(draftId, {
        outputFileId: ossFileId,
        status: 'exported',
    })

    return { ossFileId }
}
```

导出后状态机进入 `exported`，用户仍可编辑字段再次导出（后次导出覆盖 outputFileId）。

---

## 12. 实施里程碑

| # | 里程碑 | 核心产出 | 可 demo 场面 | 依赖 |
|---|---|---|---|---|
| M1 | 数据层 | 两张新表 + caseMaterials.draftId 迁移；`templateScanner.ts`；3-5 样本 .docx 入仓；seed 脚本扫描 + 上传 OSS + 写表 | `bun run prisma:migrate` + `bun prisma db seed` 后样本模板就绪 | — |
| M2 | 模板 API + admin 页 | `documentTemplate.service/dao`；6 个模板端点；配额 20 校验；`/admin/document-templates` 页 | admin 上传 .docx → 用户列表可见；私人模板上传第 21 个被拒 | M1 |
| M3 | AI 填充闭环 | `documentMain` 节点 + 提示词 seed；`buildDraftSchema`；**扩展 `search_case_materials` 工具**加 draftId 参数（含 service 层）；`documentDraft.service/dao`；`draftResultPersistence` 中间件（仿 analysis）；`documentMainAgent.ts` 仿 `caseMainAgent.ts`；`POST/GET/PATCH /drafts`；`document_draft_token` seed + 接入 `pointConsumptionMiddleware` | curl POST `/drafts` → 看 SSE → AI 最终写回 `values` | M1, M2 |
| M4 | 用户页 + 导出 | `/dashboard/assistant/document` 路由；`DocumentDraftPanel` 组件；`useDocumentDraft` composable；`POST /drafts/:id/export` + docxtemplater | 浏览器打开页 → 选模板 → 输入材料 → AI 填完 → 编辑字段 → 导出带格式 .docx | M3 |
| M5 | 实时预览 | docx-preview + TreeWalker 替换 + debounce 500ms；降级方案 A/B 代码预留 | 改任一字段，右侧 Word 样式预览实时同步 | M4 |
| M6 | 案件 tab 复用 | caseDetail 新增 `documents` tab；`<DocumentDraftPanel :case-id>`；caseMaterials 预填多选 | 案件详情 → 文书 tab → 基于案件材料生成 → 导出 | M4 |
| M7 | 批量导入 + E2E | `scripts/importDocumentTemplates.ts`（CSV 驱动、`--dry-run`）；完整 E2E；覆盖率 ≥ 80% | 脚本 import → 生产模板库就绪；E2E CI 全绿 | M4，运营准备首批模板 |

---

## 13. 测试策略

### 13.1 单元 / 集成覆盖

| 里程碑 | 测试类型 | 必须覆盖 |
|---|---|---|
| M1 | 单元 | `templateScanner` 对正常 / 边界 / 无占位符 / 中文占位符 / 混合语言的 .docx 行为；seed 幂等性 |
| M2 | 单元 + 集成 | `documentTemplate.dao/service`；`POST /templates` 配额=20 边界（并发两请求只有一个成功）；扫描失败回 400；admin 与 user scope 区分 |
| M3 | 单元 + 集成 | `buildDraftSchema` 对空 / 单占位符 / 多占位符 / 中文占位符 / 重复占位符的行为；`documentDraft.dao/service` CRUD；**扩展后的 `search_case_materials`** 三路径（仅 draftId / 仅 caseId / 缺失报错）；`draftResultPersistence` 中间件 before/after 写回 |
| M4 | 集成 | `POST /drafts/:id/export` 正常 / 缺字段（nullGetter 生效）/ 模板已删（404）/ draft 不属于当前用户（403） |
| M5 | E2E（chrome-devtools 手测） | "选模板 → 输入 → 生成 → 改字段 → 预览同步" 完整路径；降级方案各自跑一遍 |
| M6 | 集成 | 案件 tab 场景 `caseId` 注入 + caseMaterials 预填 + draft 关联到 case |
| M7 | 集成 + CLI | 导入脚本 `--dry-run` / 正常 / 重复 import 幂等 / CSV 格式错误 |

### 13.2 覆盖率门槛

`server/services/assistant/document/` 目录下的 service/dao 文件**必须 ≥ 80% 行覆盖**，API 层每端点至少一例 happy path + 一例 4xx。

### 13.3 E2E 必跑场景

- 独立生成：选"民间借贷起诉状"→ 粘贴材料 → 生成 → 改字段 → 导出 → 文件可在 Word 打开且占位符已替换
- 案件场景：进入案件详情 → documents tab → 选模板 → 多选 2 个案件材料 → 生成 → 导出 → 可选"保存到案件材料库"

---

## 14. 风险清单与缓释

| # | 风险 | 缓释 |
|---|---|---|
| R1 | docx-preview 占位符跨 `<w:r>` 切分，TreeWalker 替换不准 | 样本模板在 Word 里连续输入占位符避免切分；不稳时降级方案 A/B |
| R2 | 模板占位符命名不规范（含空格 / 特殊字符） | `templateScanner` 正则仅接受 `[\u4e00-\u9fa5\w]+`；不匹配拒绝上传并返回可读错误 |
| R3 | AI 输出不符合 schema | `responseFormat` 原生强制，agent 循环内自动重试；仍失败则 status='failed' |
| R4 | 材料超长爆上下文 | 统一走扩展后的 `search_case_materials` 工具按 topK 检索，不整体塞 prompt |
| R5 | 样本模板质量差导致 M3/M4 跑不通 | M1 仓库级 review 样本模板；入仓前人工过一遍占位符命名与排版 |
| R6 | 导出时占位符值缺失致渲染抛错 | `docxtemplater.nullGetter = () => ''` 全局兜底 |
| R7 | 私人模板配额并发绕过 | Prisma `$transaction` 内 count + create，串行化 |
| R8 | 材料预处理超时（OCR 慢） | `ensureCaseMaterialForDraft` 设超时（30s）；超时 API 返回 503 + 前端提示稍后重试 |
| R9 | AI 检索无结果导致填 null 过多 | 提示词要求"无法推断则 null + suggestions 给建议值"；前端表单对 null 字段高亮提示人工填写 |
| R10 | 动态 schema 包含中文 key 在某些模型下解析异常 | M3 里程碑专门测 Claude / GPT 两边的中文 key 支持；不稳则给占位符加 `en_name` 做英文别名 |

---

## 15. 开放问题（不阻塞 M1 启动，但各里程碑前需定）

| # | 问题 | 责任方 | 截止 |
|---|---|---|---|
| O1 | 3-5 个样本模板的具体类型 | 产品 | M1 启动前 |
| O2 | 首批 100+ 生产模板的分类归属与 CSV 元信息 | 运营 / 产品 | M7 前 |
| O3 | admin 页权限角色细化（super_admin 以外是否允许）| 产品 / 工程 | M2 启动前 |
| O4 | draft 历史列表 UI 交互（是否需要专门页面 vs 侧栏入口） | 产品 | M4 启动前 |
| O5 | 导出文件的 OSS 路径约定（是否按用户 / 按日期归档） | 工程 | M4 启动前 |

**O1 建议**：起诉状 / 答辩状 / 委托代理合同 / 律师函 / 民事协议 各一个，覆盖 3 个分类（litigation + general + arbitration）。

---

## 16. Seed 与运维

### 16.1 开发环境 seed

`prisma/seed.ts` 新增三个函数：

```typescript
async function seedDocumentMainNode(prisma: PrismaClient): Promise<void>
async function seedDocumentDraftTokenRule(prisma: PrismaClient): Promise<void>
async function seedDocumentTemplates(prisma: PrismaClient): Promise<void>  // 扫描仓库样本 + 上传 OSS + 写表
```

均为幂等：
- 节点 / 提示词 / 计费键 upsert
- 样本模板按 `(name, scope='global')` 去重

### 16.2 新环境初始化

`prisma/seeds/seedData.sql` 同步补入 nodes + prompts + point_consumption_items 的新行。样本模板因需要 OSS 不在 SQL 里处理，通过 `bun prisma db seed` 补齐。

### 16.3 批量导入脚本（M7）

`scripts/importDocumentTemplates.ts`：

- 读 CSV：`file_path, name, category, description, priority`
- 每行：校验 .docx → 扫描占位符 → 上传 OSS → 写 `documentTemplates(scope='global')`
- 扫描不到占位符的行中止脚本并输出错误（避免脏数据）
- `--dry-run` 模式：只校验不写库
- 支持断点续跑：按 `name` 去重已写入的行

### 16.4 占位符改写规范（运营 runbook 必读）

- 命名：小写+下划线 / 中文名；同模板内保持风格一致
- 日期：含"日期"/"时间" 或 `date`/`_at`/`_time`
- 金额：含"金额"/"费用"/"款" 或 `amount`/`money`/`fee`/`price`
- 枚举：`_type` 结尾 或 含"类型"/"类别"
- 严禁：空格 / 特殊字符 / 大小写混用的英文命名

---

## 17. 术语

| 术语 | 含义 |
|---|---|
| draft | 一次文书生成操作的持久化记录（`documentDrafts` 行） |
| template | 用户选择的 .docx 模板（`documentTemplates` 行） |
| placeholder | 模板中的 `{{name}}` 占位符 |
| values | draft 中已填充的占位符值：`{ placeholderName: value }` |
| sourceRef | draft 的材料引用：`{ text?, fileIds?, caseId? }` |
| documentMain | 文书生成专用 agent 节点（本文档新增） |
| responseFormat | LangChain v1 `createAgent` 的结构化输出参数 |

---

## 18. 参考

- 父 spec：[`2026-04-17-legal-assistant-design.md`](./2026-04-17-legal-assistant-design.md) §4.7, §4.8, §7, §9.3
- LangChain v1 `createAgent` + `responseFormat`：https://docs.langchain.com/oss/javascript/langchain/agents
- LangChain middleware / state-based tools：https://docs.langchain.com/oss/javascript/langchain/context-engineering
- docxtemplater nullGetter：https://docxtemplater.com/docs/configuration/#null-getter

---

**本 spec 冻结本次迭代范围。与父 spec §7 的任何冲突以本文档为准。实施前确认 §15 开放问题 O1 / O3。**
