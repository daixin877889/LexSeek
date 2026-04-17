# 通用法律助手 · 设计文档

| 项目 | 通用法律助手（对话 / 合同审查 / 文书生成） |
|---|---|
| 日期 | 2026-04-17 |
| 状态 | 设计中（待评审） |
| 交付范围 | **第一期**：基础设施（sessions 放宽 + assistantAgent）+ 对话页 + 积分/权益门控；**第二期**：合同审查、文书生成（本文档完整冻结其设计） |

---

## 1. 背景与问题陈述

### 1.1 现状

LexSeek 的全部 AI 能力——对话（`caseMainAgent`）、分析（`caseAnalysisV2`）、模块对话（`moduleAgent`）——**都强绑定 `caseId`**：

- `caseSessions.caseId` NOT NULL
- `agentRuns.caseId` NOT NULL
- `caseMaterialContext` / `caseProcessMaterial` / `moduleContext` 中间件都以 caseId 为输入

用户必须先**创建案件**才能使用任何 AI 能力，包括"问一句合同条款含义"这种零上下文问题。

### 1.2 痛点

| 场景 | 现状 | 问题 |
|---|---|---|
| 律师快速查一个法条含义 | 必须新建 case | 心智负担、数据污染（产生冗余 case） |
| 用户临时让 AI 改一段合同 | 必须新建 case + 上传材料 | 流程过重 |
| 非律师用户试用产品 | 必须创建 case | 学习成本高，产品漏斗收窄 |
| 文书生成功能 | 仅在 `caseDetail` 页面预留 tab，尚未实现 | 无法满足无 case 的轻量文书需求 |
| 合同审查功能 | **项目中完全缺失** | 核心法律场景空白 |

### 1.3 目标

1. 引入**无 case 会话**通道（`scope='assistant'`），用户无需创建案件即可使用 AI 能力
2. 在侧边栏提供 **3 个一级入口**：对话 / 合同审查 / 文书生成
3. 合同审查、文书生成**既可独立使用**，也可**在案件详情页中复用**（同组件 + caseId prop 注入）
4. 对话 / 合同审查 / 文书生成**各自独立的积分计费键**
5. 对用户：重型管理（case 全生命周期）和轻型任务（临时咨询/审查/起草）**两条产品线并存**
6. 对开发：最大限度复用现有 LangGraph 执行内核 / SSE / checkpointer / Redis 队列

### 1.4 与「小索子 Agent」的边界界定

最近 commit `21d56d9` 引入了「小索子 Agent」的持久化与上下文复用。**小索子 Agent 仍绑定 caseId**，服务于案件内的子代理委派；本文的「通用法律助手」是**无 case 会话**，面向零上下文场景。两者关系：

| 维度 | 小索子 Agent | 通用法律助手 |
|---|---|---|
| 上下文 | case 绑定 | 无 case |
| 入口 | 案件详情页内的 AI 面板 | 侧边栏一级菜单 |
| 节点 | 复用 caseMain / 分析节点 | 新增 assistantMain 节点 |
| 会话 scope | `case` | `assistant` |
| 持久化 | caseSessions（scope=case） | caseSessions（scope=assistant） |

两者共用 agentWorker、checkpointer、SSE 协议。演化上互不干扰。

### 1.5 非目标

- **不**改造 `caseAnalysisV2` 结构化工作流
- **不**重构 `caseMainAgent`
- **不**支持跨会话共享对话上下文（每个 sessionId 仍是独立 thread）
- **不**支持会话分享/协作（第一期）
- **不**自建富文本编辑器（文书预览使用 `docx-preview`，编辑仅通过表单）

---

## 2. 澄清决策摘要

本设计基于与用户的多轮澄清，所有结论已冻结：

| 决策维度 | 选定 | 理由摘要 |
|---|---|---|
| 会话归属模型 | 放宽 `caseSessions.caseId` 可空 + 新增 `scope` 字段 | 复用现有 workflow 执行内核；代码改动集中在数据层与鉴权边界 |
| UI 组织 | 3 个独立一级菜单 → 3 个独立一级页面 | 每个页面单一职责；URL 结构清晰 |
| 对话页路由 | `/dashboard/assistant/chat` | |
| 合同审查页路由 | `/dashboard/assistant/contract` | |
| 文书生成页路由 | `/dashboard/assistant/document` | |
| 案件详情页复用 | 同组件 + caseId prop 注入 | 避免两套 UI |
| 对话持久化 | 会话列表可见，支持新建/重命名/软删 | 类 ChatGPT 体验 |
| 合同审查输入源 | 粘贴文本 / 上传 .docx / 案件材料库（仅案件页） | |
| 合同审查输出 | 结构化风险点清单 + 全文高亮批注 + 改进 diff + 总结；**可下载带原生批注的 .docx** | 参考 `~/Desktop/contract-review-assistant` SKILL |
| 合同审查关键规则 | **先识别甲乙方 → 通过中断交互询问用户立场 → 按立场审查** | 来自 SKILL.md 的第一优先级规则 |
| 文书生成流程 | **先选模板 → 再传资料**（上方选文书，下方 AiPromptInput 输入） | 用户修正：目标优先设计 |
| 文书生成模板形态 | 保留 Word 模板 + 服务端回填导出；占位符名（`{{name}}`），表单自动推断 | 保真度最高；零手写 schema |
| 文书模板管理 | 全局模板库 + 用户私人模板双轨 | |
| 权益模型 | 每功能独立 benefit code + 独立积分规则 | 运营可精细化 |
| Agent 节点 | **nodes 表新增 `assistantMain` 节点**（不复用 `caseMain`） | 系统提示词、工具集、中间件差异显著 |
| 迁移策略 | **全部使用 Prisma CLI 自动生成**，`schema.prisma` 作为唯一 source of truth | 保证 migrations 删除后重新部署可完整复现 |
| 交付范围 | 第一期：基础设施+对话+积分；第二期：合同审查、文书生成 | 控制风险，但 spec 覆盖完整 |

---

## 3. 架构总览

### 3.1 分层视图

```
┌─────────────────────────────────────────────────────────────┐
│  Pages                                                        │
│  /dashboard/assistant/chat           ← 第一期                  │
│  /dashboard/assistant/contract       ← 第二期                  │
│  /dashboard/assistant/document       ← 第二期                  │
│  /dashboard/cases/[id] (复用 contract / document 组件)          │
└──────────────┬────────────────────────────────────────────────┘
               │ useAssistantChat / useContractReview / useDocumentDraft
               ▼
┌─────────────────────────────────────────────────────────────┐
│  API (server/api/v1/assistant/**)                             │
│    sessions/*、chat、contract/*、document/*                     │
└──────────────┬────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│  Services (server/services/assistant/**)                      │
│    assistantSession.service    ← 第一期                         │
│    contractReview.service      ← 第二期                         │
│    documentDraft.service       ← 第二期                         │
│    documentTemplate.service    ← 第二期                         │
└──────────────┬────────────────────────────────────────────────┘
               │ 复用
               ▼
┌─────────────────────────────────────────────────────────────┐
│  Workflow Core（内核零改动，仅新增一个 agent）                   │
│    workflow/agents/assistantAgent.ts   ← 新增                    │
│    workflow/agents/caseMainAgent.ts    ← 不动                    │
│    checkpointer / Redis Stream / agentWorker → 新增 scope 分支路由 │
└──────────────┬────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│  DB: nodes (+1 行 assistantMain)                               │
│      case_sessions (放宽 + 新字段)                             │
│      agent_runs (放宽 + 新字段)                                │
│      contract_reviews (第二期新表)                              │
│      document_templates (第二期新表)                            │
│      document_drafts (第二期新表)                               │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 为什么不复用 caseMain 节点（用户显式要求）

| 维度 | caseMain | assistantMain |
|---|---|---|
| 系统提示词 | 假设有 case 背景、materials、analysis | 显式声明"无案件上下文" |
| 工具集 | `searchCaseMaterials` / `processMaterials` / `saveAnalysisResult` 等需 caseId 的工具 | `searchLaw` 等普适工具（第二期追加 `reviewContract` / `draftDocument`） |
| 中间件 | `pointConsumption` / `caseProcessMaterial` / `moduleContext` / `summarization` / `safetyTrim` / `skills`（见 `caseMainAgent.ts`） | `pointConsumption`(itemKey 不同) / `summarization` / `safetyTrim`，**不注入**任何 case 相关中间件 |
| 模型 | 需要强推理（可配更大模型） | 可配更便宜模型（通过 nodes.modelId） |
| 积分计费键 | `case_analysis_token` | `assistant_token` |

两个节点**独立存在于 nodes 表**，各自独立维护提示词版本、工具列表、模型选择、会员门控（`levelNodeAccess`）。

---

## 4. 数据模型

### 4.1 总原则

- **所有 schema 变更通过修改 `prisma/models/*.prisma` 并执行 `bun run prisma:migrate dev --name <desc>`**
- `schema.prisma` / `prisma/models/*.prisma` 是 schema 的**唯一 source of truth**
- 删除 `prisma/migrations/` 目录后，重新 `prisma migrate dev` 能复现完全一致的数据库
- **不手写任何裸 SQL**（包括 CHECK 约束、VIEW、RENAME TABLE）
- 业务不变量（scope 与 caseId 的互斥关系）通过**应用层 Zod 校验**保证

### 4.2 第一期 · `caseSessions` 放宽

在 `prisma/models/case.prisma` 中修改 `caseSessions` 模型。

```prisma
model caseSessions {
    id        Int       @id @default(autoincrement())
    sessionId String    @unique @map("session_id") @db.VarChar(100)
    /// 会话归属域：case（案件内）/ assistant（通用法律助手）
    scope     String    @default("case") @db.VarChar(20)
    /// 会话所有者用户ID
    /// - scope=assistant：必须存在（应用层校验）
    /// - scope=case：冗余字段，便于列表按用户查询
    userId    Int?      @map("user_id")
    /// 关联的案件ID
    /// - scope=case：必须存在（应用层校验）
    /// - scope=assistant：必须为 NULL
    caseId    Int?      @map("case_id")
    /// 会话状态：1-进行中，2-已完成，3-已中断，4-已失败
    status    Int       @default(1)
    /// 会话类型：1-普通对话，2-初始化分析（仅 case 域使用）
    type      Int       @default(1)
    /// 会话标题（assistant 场景由首条消息自动生成，用户可重命名）
    title     String?   @db.VarChar(200)
    metadata  Json?     @db.JsonB
    createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    updatedAt DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
    deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

    case cases? @relation(fields: [caseId], references: [id], onDelete: NoAction, onUpdate: NoAction)
    user users? @relation(fields: [userId], references: [id], onDelete: NoAction, onUpdate: NoAction)
    caseAnalyses caseAnalyses[]

    @@index([userId, scope, deletedAt], map: "idx_case_sessions_user_scope")
    @@index([caseId], map: "idx_case_sessions_case_id")
    @@index([scope, status], map: "idx_case_sessions_scope_status")
    @@index([type], map: "idx_case_sessions_type")
    @@index([deletedAt], map: "idx_case_sessions_deleted_at")
    @@map("case_sessions")
}
```

**变更清单**：
- `caseId` 从 `Int` 改为 `Int?`
- 新增字段：`scope`（默认 `'case'`）、`userId`、`title`
- 新增索引：`idx_case_sessions_user_scope`、`idx_case_sessions_scope_status`
- 关系：`case` 关联改为可选；新增 `user` 关联

> **表名保留 `case_sessions`**。重命名会让 Prisma 生成 DROP+CREATE（数据丢失），而且需要手写 ALTER 迁移。保留表名是最低风险、可完整复现的选择。运行时"case_sessions 里也存 assistant scope 的行"是可以接受的轻微语义泄漏。

### 4.3 第一期 · `agentRuns` 放宽

```prisma
model agentRuns {
    id          String    @id @default(uuid())
    sessionId   String    @map("session_id")
    threadId    String    @map("thread_id")
    userId      Int       @map("user_id")
    /// 归属域：case / assistant
    scope       String    @default("case") @db.VarChar(20)
    /// 关联的案件ID（scope=assistant 时为空）
    caseId      Int?      @map("case_id")
    input       Json
    status      String    @default("pending")
    workerId    String?   @map("worker_id")
    heartbeatAt DateTime? @map("heartbeat_at") @db.Timestamptz(6)
    startedAt   DateTime? @map("started_at") @db.Timestamptz(6)
    completedAt DateTime? @map("completed_at") @db.Timestamptz(6)
    error       String?
    metadata    Json?     @map("metadata")
    createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    updatedAt   DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

    @@index([status, createdAt], map: "idx_agent_runs_status_created_at")
    @@index([sessionId, createdAt], map: "idx_agent_runs_session_id_created_at")
    @@index([userId], map: "idx_agent_runs_user_id")
    @@index([scope], map: "idx_agent_runs_scope")
    @@map("agent_runs")
}
```

**变更清单**：
- `caseId` 从 `Int` 改为 `Int?`
- 新增字段：`scope`
- 新增索引：`idx_agent_runs_scope`

### 4.4 第一期 · `nodes` 表数据扩展（不改 schema）

在 `prisma/seed` 或 admin 后台插入一行：

```sql
-- 由 seed 脚本或 admin UI 插入，不走 migration
INSERT INTO nodes (name, title, description, type, priority, model_id, tools, status)
VALUES (
  'assistantMain',
  '通用法律助手主Agent',
  '无案件上下文的法律问答与工具调用',
  'agent',
  10,
  <与 caseMain 同一个 modelId；后期可独立调整>,
  '["searchLaw"]'::jsonb,  -- 第一期工具；第二期追加 reviewContract / draftDocument
  1
);
```

并为该 node 插入一条初始 prompts（type='system', version='v1', status=1）。提示词内容见 §5.4。

### 4.5 第一期 · 积分计费键扩展

**不新增 `BenefitCode` 枚举值**。现有 `BenefitCode` 只有 `STORAGE_SPACE`，配套的 `BenefitUnitType`（BYTE / COUNT）+ `MembershipBenefits` 是**累加/额度型配额**模型（类似云盘空间），**没有按周期归零机制**，与"按次对话"不匹配。

第一期完全走积分扣减路径：
- `pointConsumptionMiddleware(userId, 'assistant_token', sessionId)` 按 token 扣减
- 在 `pointConsumptionRules` 表新增一条记录：`itemKey='assistant_token'`，单价由运营配置（开放问题 §11）
- 入口门控复用现有 `checkPointsService(userId, 'assistant_token', minUnits=1)`；积分不足 → `resError(402, '积分不足，请充值')`

**未来若需要"免费会员 N 次/月"类配额**，需先扩展 benefit 体系（新增 `PERIOD_RESET` 计算模式 + `usageCounters` 表 + 月末 cron），再在 chat 入口增加次数校验。本次 spec 不承诺此扩展。

**enum 保持现状**：`shared/types/benefit.ts` 不改。合同审查、文书生成同理走积分键（`contract_review_token`、`document_draft_token`），不新增 benefit code。

### 4.6 第二期 · `contractReviews` 新表

```prisma
model contractReviews {
    id              Int       @id @default(autoincrement())
    userId          Int       @map("user_id")
    /// 可选关联案件（assistant 独立使用时为空）
    caseId          Int?      @map("case_id")
    /// 关联 case_sessions.sessionId（所有审查都通过 assistantAgent 驱动）
    sessionId       String    @map("session_id") @db.VarChar(100)
    /// 原始合同 OSS 文件ID
    originalFileId  Int       @map("original_file_id")
    /// 批注后的 OSS 文件ID（审查完成前为空）
    reviewedFileId  Int?      @map("reviewed_file_id")
    /// 合同类型（AI 识别）：买卖/租赁/服务/劳动/借款/合作/保密...
    contractType    String?   @db.VarChar(50)
    /// 甲方名称
    partyA          String?   @db.VarChar(200)
    /// 乙方名称
    partyB          String?   @db.VarChar(200)
    /// 用户审查立场：partyA / partyB / neutral
    stance          String?   @db.VarChar(20)
    /// 审查状态：pending / awaiting_stance / reviewing / completed / failed
    status          String    @default("pending") @db.VarChar(30)
    /// 风险点列表（JSON 数组，schema 见 §6.3）
    risks           Json?     @db.JsonB
    /// 审查摘要文本（Markdown）
    summary         String?   @db.Text
    createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    updatedAt       DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
    deletedAt       DateTime? @map("deleted_at") @db.Timestamptz(6)

    user users  @relation(fields: [userId], references: [id], onDelete: NoAction, onUpdate: NoAction)
    case cases? @relation(fields: [caseId], references: [id], onDelete: NoAction, onUpdate: NoAction)

    @@index([userId, deletedAt], map: "idx_contract_reviews_user")
    @@index([sessionId], map: "idx_contract_reviews_session")
    @@index([caseId], map: "idx_contract_reviews_case")
    @@index([status], map: "idx_contract_reviews_status")
    @@map("contract_reviews")
}
```

### 4.7 第二期 · `documentTemplates` 新表

```prisma
model documentTemplates {
    id             Int       @id @default(autoincrement())
    /// 模板名称
    name           String    @db.VarChar(200)
    /// 分类（起诉状/答辩状/函件/合同/其它）
    category       String    @db.VarChar(100)
    /// 归属：global / user
    scope          String    @default("global") @db.VarChar(20)
    /// 归属用户（scope=user 必填；scope=global 为 NULL，应用层校验）
    userId         Int?      @map("user_id")
    /// OSS 文件ID（.docx 模板文件）
    ossFileId      Int       @map("oss_file_id")
    /// 扫描出的占位符列表：[{ name, firstContext }]
    /// - name：占位符标识
    /// - firstContext：首次出现所在段落文本（辅助 AI 推断语义）
    placeholders   Json      @default("[]") @db.JsonB
    /// 模板描述
    description    String?   @db.VarChar(500)
    /// 排序优先级
    priority       Int       @default(100)
    /// 状态：1-启用，0-禁用
    status         Int       @default(1)
    createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    updatedAt      DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
    deletedAt      DateTime? @map("deleted_at") @db.Timestamptz(6)

    user users? @relation(fields: [userId], references: [id], onDelete: NoAction, onUpdate: NoAction)

    @@index([scope, userId], map: "idx_doc_templates_scope_user")
    @@index([category], map: "idx_doc_templates_category")
    @@index([status, deletedAt], map: "idx_doc_templates_status")
    @@map("document_templates")
}
```

### 4.8 第二期 · `documentDrafts` 新表

```prisma
model documentDrafts {
    id            Int       @id @default(autoincrement())
    userId        Int       @map("user_id")
    caseId        Int?      @map("case_id")
    sessionId     String    @map("session_id") @db.VarChar(100)
    templateId    Int       @map("template_id")
    /// 占位符填充值：{ placeholderName: value }
    values        Json      @default("{}") @db.JsonB
    /// AI 分析用的原材料引用：
    /// { text?: string, fileIds?: number[], caseId?: number }
    sourceRef     Json?     @db.JsonB
    /// 最终导出的 OSS 文件ID
    outputFileId  Int?      @map("output_file_id")
    /// 状态：drafting / filling / ready / exported / failed
    status        String    @default("drafting") @db.VarChar(30)
    createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    updatedAt     DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
    deletedAt     DateTime? @map("deleted_at") @db.Timestamptz(6)

    user     users             @relation(fields: [userId], references: [id], onDelete: NoAction, onUpdate: NoAction)
    case     cases?            @relation(fields: [caseId], references: [id], onDelete: NoAction, onUpdate: NoAction)
    template documentTemplates @relation(fields: [templateId], references: [id], onDelete: NoAction, onUpdate: NoAction)

    @@index([userId, deletedAt], map: "idx_doc_drafts_user")
    @@index([sessionId], map: "idx_doc_drafts_session")
    @@index([caseId], map: "idx_doc_drafts_case")
    @@index([templateId], map: "idx_doc_drafts_template")
    @@map("document_drafts")
}
```

### 4.9 迁移命令

第一期：
```bash
bun run prisma:migrate dev --name add_assistant_scope_to_sessions_and_runs
```

第二期：
```bash
bun run prisma:migrate dev --name add_contract_reviews_and_document_templates_and_drafts
```

### 4.10 应用层校验（替代 DB CHECK）

所有写入路径在 DAO/Service 层使用 Zod 前置校验。

```typescript
// server/services/assistant/assistantSession.dao.ts
import { z } from 'zod'

const CreateSessionSchema = z.object({
  sessionId: z.string().min(1),
  scope: z.enum(['case', 'assistant']),
  userId: z.number().int().positive(),
  caseId: z.number().int().positive().optional(),
  title: z.string().max(200).optional(),
  type: z.number().int().default(1),
}).refine(
  v => (v.scope === 'case' && v.caseId !== undefined) ||
       (v.scope === 'assistant' && v.caseId === undefined),
  { message: 'scope 与 caseId 不一致：case 必须有 caseId；assistant 必须无 caseId' },
)

export async function createSessionDAO(input: z.infer<typeof CreateSessionSchema>) {
  const parsed = CreateSessionSchema.parse(input)
  return prisma.caseSessions.create({ data: parsed })
}
```

agentRuns 的 DAO 同理。

### 4.11 存量数据回填（独立 seed 脚本，不进 migration）

为遵守"所有 schema 变更由 Prisma CLI 自动生成、migration 文件无人工编辑"的原则，存量 `case_sessions.userId` 回填**不写入 migration 文件**。改由：

1. 独立 TypeScript 脚本 `scripts/backfillSessionUserId.ts`：
```typescript
// 运行：bun run scripts/backfillSessionUserId.ts
import { prisma } from '~~/server/utils/prisma'

async function main() {
    const result = await prisma.$executeRaw`
        UPDATE case_sessions cs
           SET user_id = c.user_id
          FROM cases c
         WHERE cs.case_id = c.id
           AND cs.user_id IS NULL
           AND cs.deleted_at IS NULL
    `
    console.log(`回填完成：${result} 行`)
}
main().finally(() => prisma.$disconnect())
```

2. 部署流程：migration 应用后，运维**执行一次**该脚本即可；删除 migrations 目录重建时（全新环境），无存量数据，脚本空跑无副作用，**不必执行**。

3. 代码兼容：**必须在同 PR**改写 `session.dao.ts` 的 `findSessionWithOwnershipCheck`，使其不依赖回填是否已执行：

```typescript
async function findSessionWithOwnershipCheck(sessionId: string, userId: number) {
    const session = await prisma.caseSessions.findFirst({
        where: { sessionId, deletedAt: null },
        include: { case: { select: { userId: true } } },
    })
    if (!session) return { session: null, error: 'Session 不存在' as const }

    // 优先使用 session.userId（回填后或新写入的都有）；
    // 回退到 session.case?.userId（case 域历史行在回填前的兼容）
    // scope='assistant' 时 session.case 为 null，只能走 session.userId
    const ownerId = session.userId ?? session.case?.userId
    if (ownerId == null || ownerId !== userId) {
        return { session: null, error: '无权操作该 Session' as const }
    }
    return { session, error: null }
}
```

**迁移验证步骤**：
1. `bun run prisma:migrate dev --name add_assistant_scope_to_sessions_and_runs`
2. 本地 `prisma migrate diff --from-url $DATABASE_URL --to-schema-datamodel prisma/schema.prisma --script` 预览 SQL，确认仅有期望的 ALTER
3. 部署到预发环境后执行 `bun run scripts/backfillSessionUserId.ts`
4. 验证：`SELECT COUNT(*) FROM case_sessions WHERE user_id IS NULL AND scope='case' AND deleted_at IS NULL` 应为 0

---

## 5. 后端执行链路（第一期）

### 5.1 新增文件清单

```
server/
├── services/
│   ├── assistant/
│   │   ├── assistantSession.service.ts   # 会话 CRUD / 列表 / 重命名
│   │   ├── assistantSession.dao.ts       # 仅操作 case_sessions(scope=assistant)
│   │   ├── types.ts
│   │   └── index.ts
│   └── workflow/
│       └── agents/
│           ├── assistantAgent.ts          # 对照 caseMainAgent 的 assistant 版
│           └── index.ts (导出 runAssistantChat / getAssistantThreadState)
├── api/v1/assistant/
│   ├── sessions.get.ts                    # 会话列表（分页）
│   ├── sessions.post.ts                   # 新建会话
│   ├── sessions/[id].get.ts               # 获取单个会话（含消息历史）
│   ├── sessions/[id].patch.ts             # 重命名 / 更新 metadata
│   ├── sessions/[id].delete.ts            # 软删
│   ├── chat.post.ts                       # 发消息（SSE）
│   └── runs/cancel/[runId].post.ts        # 取消运行
```

### 5.2 agentWorker 改造

现状：按 `session.type` 路由到 `caseMainAgent` / `caseAnalysisV2` / `moduleAgent`。

改造后：**先按 scope 分流，再按 type 分流**。

```typescript
// server/services/agent/agentWorker.ts  伪代码
const session = await getSessionDAO(sessionId)

if (session.scope === 'assistant') {
    // assistant 域：session.userId 必然已写入（scope=assistant 的创建路径强校验）
    // 存量 case 域未回填时，不会走入此分支，无需担心
    if (session.userId == null) {
        throw new Error(`assistant session ${sessionId} 缺失 userId（数据损坏）`)
    }
    return runAssistantChat(sessionId, message, {
        userId: session.userId,
        command,
        signal,
        thinking,
    })
}

// 原有 case 分支保留不变；case 域仍然通过 session.case.userId 取主（已有逻辑）
switch (session.type) {
    case 1: return runCaseChat(sessionId, message, { userId, caseId: session.caseId!, signal, command })
    case 2: return runCaseAnalysisV2(...)
    case 3: return runModuleChat(...)
}
```

### 5.3 `assistantAgent.ts` 核心实现

完全对照 `caseMainAgent.ts`，去掉 case 相关中间件与 caseId 上下文。

```typescript
import { createAgent, summarizationMiddleware, type ReactAgent } from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import { Command } from '@langchain/langgraph'
import { getCheckpointer, getStore } from '../checkpointer'
import { getValidNodeConfig } from '../../node/node.service'
import { createChatModel } from '../../node/chatModelFactory'
import { getToolInstancesService } from '../tools'
import { renderSystemPrompt } from '../utils/promptRenderer'
import {
    pointConsumptionMiddleware,
    safetyTrimMiddleware,
} from '../middleware'

const ASSISTANT_MAIN_NODE_NAME = 'assistantMain'

export interface AssistantAgentOptions {
    userId: number
    thinking?: boolean
    signal?: AbortSignal
    command?: unknown
}

export async function runAssistantChat(
    sessionId: string,
    message: string | undefined,
    options: AssistantAgentOptions,
): Promise<ReadableStream<Uint8Array>> {
    const { userId, thinking = true, signal, command } = options

    const [checkpointer, store, mainConfig] = await Promise.all([
        getCheckpointer(),
        getStore(),
        getValidNodeConfig(ASSISTANT_MAIN_NODE_NAME, '通用法律助手主Agent'),
    ])

    const activeApiKey = mainConfig.modelApiKeys.find(k => k.status === 1)
    if (!activeApiKey) {
        throw new Error(`${ASSISTANT_MAIN_NODE_NAME} 节点没有可用的 API 密钥`)
    }

    const model = createChatModel({
        sdkType: mainConfig.modelSdkType,
        modelName: mainConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: mainConfig.modelProviderBaseUrl,
        temperature: 0.7,
        streaming: true,
        thinking,
    })

    // 渲染系统提示词时不传 caseId
    const systemPrompt = renderSystemPrompt(mainConfig, {})

    const toolContext = { userId, sessionId }  // 无 caseId
    const tools = mainConfig.tools.length > 0
        ? getToolInstancesService(mainConfig.tools, toolContext)
        : []

    const contextWindow = mainConfig.modelContextWindow || 128000
    const triggerTokens = Math.max(Math.floor(contextWindow * 0.6), 30000)

    const agent: ReactAgent = createAgent({
        model,
        systemPrompt,
        checkpointer,
        store,
        tools,
        middleware: [
            // 计费键为 assistant_token（与 case_analysis_token 规则独立）
            pointConsumptionMiddleware(userId, 'assistant_token', sessionId),
            // 不注入 caseMaterialContext / caseProcessMaterial / moduleContext
            summarizationMiddleware({
                model,
                trigger: [{ tokens: triggerTokens }],
            }),
            safetyTrimMiddleware({
                model,
                maxTokens: Math.floor(contextWindow * 0.8),
            }),
        ],
    })

    const input = command
        ? new Command({ resume: command })
        : { messages: [new HumanMessage(message!)] }

    return agent.stream(input, {
        configurable: { thread_id: sessionId },
        streamMode: ['values', 'messages', 'updates'],
        subgraphs: true,
        encoding: 'text/event-stream',
        recursionLimit: 1000,
        signal,
    })
}

export async function getAssistantThreadState(sessionId: string) {
    // 与 getChatThreadState 结构一致，此处省略
}
```

### 5.4 `assistantMain` 节点 · 系统提示词（v1）

插入 `prompts` 表：`name='assistantMain_system'`, `type='system'`, `version='v1'`, `status=1`。

```text
你是 LexSeek 的通用法律助手，服务于中国大陆法律场景下的律师、法务与普通用户。

# 能力边界
- 你可以回答法律知识问题、提供文书起草思路、做合同基础分析。
- 你可以调用 searchLaw 工具检索最新法条。
- 你【不】拥有任何案件上下文；如果用户提到"我的案件"但没有贴出详情，主动请用户提供关键信息。
- 对于需要严谨尽职调查的任务（完整合同审查、正式文书生成），提示用户切换到
  「合同审查」「文书生成」专用入口，那里有专用工具与流程。

# 输出要求
- 准确、中立、使用法律术语，避免情绪化用语与感叹号。
- 引用法条时标注名称与条号（如《民法典》第 509 条）。
- 涉及不确定事实时主动说明前提假设。
- 默认使用简体中文。
- 所有涉及日期、金额、主体名称的内容，必须明确来源（来自用户输入 / 法条 / 工具返回）。

# 不做的事
- 不替用户做最终法律决定，只提供分析与建议。
- 不编造案例编号、当事人姓名、未经检索的法条内容。
- 不讨论与法律无关的话题（礼貌拒绝并引导回法律咨询）。
```

### 5.5 积分扣减门控

**前置门控**（`chat.post.ts` 入口，复用现有 `checkPointsService`）：

```typescript
import { checkPointsService } from '~~/server/services/point/pointConsumption.service'

const check = await checkPointsService(userId, 'assistant_token', 1)
if (!check.allowed) {
    return resError(event, 402, `积分不足：${check.reason}`)
}
```

**运行时计费**：通过 `pointConsumptionMiddleware(userId, 'assistant_token', sessionId)` 在 `afterModel` 钩子按 token 扣减，与 `case_analysis_token` 走同一套扣减代码路径，只是 `itemKey` 不同。无需新建中间件。

**先决条件**：需在 `pointConsumptionRules` 表（或当前积分单价配置表）新增一条 `itemKey='assistant_token'` 的单价记录，数值由运营提供（见 §11 开放问题）。

### 5.6 API 契约

#### 5.6.1 新建会话

```
POST /api/v1/assistant/sessions
Body: { firstMessage?: string }
Response: { sessionId: string, title?: string }
```

实现：生成 UUID → 插入 `case_sessions(scope='assistant', userId=<current>, title=null)` → 返回。

首条消息发送后，异步请求模型生成 ≤ 20 字标题，UPDATE 回 `title`。

#### 5.6.2 会话列表

```
GET /api/v1/assistant/sessions?page=1&pageSize=20
Response: {
  list: [{ sessionId, title, updatedAt, messageCount }],
  total: number,
  page: number,
  pageSize: number,
}
```

实现：`SELECT * FROM case_sessions WHERE scope='assistant' AND userId=<current> AND deletedAt IS NULL ORDER BY updatedAt DESC`。

`messageCount` 从 checkpointer 读，若成本高则第一期省略，展示 updatedAt 即可。

#### 5.6.3 更新/删除会话

```
PATCH /api/v1/assistant/sessions/:id
Body: { title?: string }
Response: { session }

DELETE /api/v1/assistant/sessions/:id
Response: { success: true }
```

删除：软删（`deletedAt = now()`）。

#### 5.6.4 发送消息（SSE）

```
POST /api/v1/assistant/chat
Body: { sessionId: string, message?: string, command?: unknown, thinking?: boolean }
Response: text/event-stream（复用现有 SSE 协议）
```

实现：
1. 鉴权 + scope 校验（`sessionId` 必须 scope=assistant 且归属当前用户）
2. 积分门控（`checkPointsService`）
3. 入队 `agent_runs`，`scope='assistant'`；`caseId` 默认为 null（独立对话场景），但合同审查/文书生成在案件页复用时**允许**传入 caseId 以便后续关联查询（此时 session 仍为 assistant scope）
4. 返回 SSE stream（与 case 域完全一致的协议）

#### 5.6.5 取消运行

```
POST /api/v1/assistant/runs/cancel/:runId
Response: { cancelled: true }
```

直接复用 case 域的取消逻辑（通过 runId 找 AbortController）。

---

## 6. 合同审查设计（第二期完整冻结）

### 6.1 功能目标

律师上传/粘贴合同（.docx 或纯文本），系统：
1. 自动识别合同类型与甲乙方
2. 通过中断交互询问用户审查立场（甲方/乙方/中立）
3. 按立场进行逐条审查，产出：
   - 结构化风险点清单（JSON）
   - 带 Word 原生批注的 .docx 下载文件
   - 改进建议 diff（可选输出）
   - 审查摘要文本
4. 页面同屏预览合同 + 批注

### 6.2 技术栈

| 能力 | Node 库 | 版本/备注 |
|---|---|---|
| .docx 读取（段落/样式） | `mammoth` | 转 HTML 用于前端渲染 |
| .docx 批注注入 | `jszip` + `fast-xml-parser` | 手动操作 zip 内 XML，对齐 `word/comments.xml` 三要素协议 |
| 前端 Word 渲染 | `docx-preview` | 社区方案，支持 comments |
| diff 比对 | `diff-match-patch` | 段落级 |

> **不选择 `docx4js`**：维护不活跃。
> **不选择 `pizzip + docxtemplater` 做批注**：docxtemplater 专攻占位符替换，不擅长 comments。
> 参考 `~/Desktop/contract-review-assistant/SKILL.md`（python-docx 实现），XML 结构完全通用。

### 6.3 数据结构（`contractReviews.risks` JSON Schema）

```typescript
type Risk = {
  id: string              // UUID
  clauseIndex: number     // docx 段落索引（0-based）
  clauseText: string      // 原文段落
  level: 'high' | 'medium' | 'low'
  category: string        // 付款/交付/违约/保密/知识产权/争议解决/...
  problem: string         // 问题描述
  legalBasis?: string     // 《民法典》第 XXX 条（可选）
  analysis: string        // 条款分析
  risk: string            // 法律风险
  suggestion: string      // 修改建议
  strategy?: string       // 谈判策略（可选）
}

type ContractReviewRisks = Risk[]
```

### 6.4 核心流程（Agent 化 · 2 轮交互）

```
用户在 /dashboard/assistant/contract 提交合同
    ↓
POST /api/v1/assistant/contract/reviews
  body: { sourceType: 'upload'|'paste'|'case_material',
          ossFileId?, text?, caseMaterialId?, caseId? }
    ↓
contractReview.service.createAndStart()
  1. 若 sourceType=paste：将文本转为最小 .docx 存 OSS
     若 sourceType=case_material：从 case_materials 拉取 ossFileId
  2. 新建 case_sessions(scope='assistant', title='合同审查 · 文件名')
  3. 新建 contract_reviews(status='pending', originalFileId)
  4. 入队 agent_runs，触发 worker
    ↓
agentWorker → runAssistantChat（系统提示词 + reviewContract 工具）
    ↓
[AI 调用 reviewContract 工具]
  ├─ Step A: 解包 .docx → 提取段落文本 → 识别合同类型 + 甲乙方
  │          partyDetector 用正则（"甲方：XXX" / "乙方：XXX"）兜底，
  │          正则未命中则用模型推断
  ├─ Step B: 工具返回 interrupt() 暂停：
  │          { type: 'awaiting_stance',
  │            partyA: 'XX公司', partyB: 'YY个人',
  │            contractType: '劳动合同' }
  │          UI 弹出立场选择对话框
  ├─ Step C: 用户选择后前端调
  │          POST /api/v1/assistant/contract/reviews/:id/stance
  │          body: { stance: 'partyA'|'partyB'|'neutral' }
  │          → 通过 Command({ resume: { stance } }) 恢复 agent
  ├─ Step D: agent 按 stance 调用审查提示词 → 产出 Risk[] + summary
  │          同时更新 contract_reviews.stance / risks / summary
  ├─ Step E: commentInjector.writeBack() 注入批注到原 .docx
  │          → 上传新文件到 OSS → 更新 reviewedFileId
  └─ Step F: 更新 contract_reviews.status='completed'，
             SSE 推送 completed 事件
    ↓
前端收到 completed 事件 → 调 GET /reviews/:id → 渲染全文+批注+清单
    ↓
用户点击「下载 Word」→ GET /reviews/:id/download → 302 → OSS 签名 URL
```

### 6.5 `reviewContract` 工具契约

```typescript
// server/services/workflow/tools/reviewContract.tool.ts
import { tool } from '@langchain/core/tools'
import { interrupt } from '@langchain/langgraph'  // 模块级 import，与 pointConsumption.middleware.ts 一致
import { z } from 'zod'

const reviewContractTool = tool(
    async ({ reviewId }) => {
        // Step A: 解析合同
        const review = await getContractReviewDAO(reviewId)
        const docx = await downloadFromOSS(review.originalFileId)
        const { paragraphs, partyA, partyB, contractType } = await parseContract(docx)
        await updateContractReviewDAO(reviewId, {
            contractType, partyA, partyB, status: 'awaiting_stance',
        })

        // Step B: 请求立场（模块级 interrupt，抛出后 langgraph 持久化 checkpoint 暂停）
        const { stance } = interrupt({
            type: 'awaiting_stance',
            reviewId,
            partyA,
            partyB,
            contractType,
        }) as { stance: 'partyA' | 'partyB' | 'neutral' }

        // Step C: 按立场审查
        await updateContractReviewDAO(reviewId, { stance, status: 'reviewing' })
        const { risks, summary } = await runReviewPrompt({
            paragraphs, stance, contractType, partyA, partyB,
        })

        // Step D: 批注注入
        const reviewedBuffer = await injectComments(docx, risks)
        const reviewedFileId = await uploadToOSS(reviewedBuffer, `reviewed-${reviewId}.docx`)

        // Step E: 更新结果
        await updateContractReviewDAO(reviewId, {
            risks, summary, reviewedFileId, status: 'completed',
        })

        return { risks, summary, reviewedFileId }
    },
    {
        name: 'reviewContract',
        description: '对已上传的合同执行法律审查：识别甲乙方、请求用户立场、按立场输出风险点与批注',
        schema: z.object({
            reviewId: z.number(),
        }),
    },
)
```

### 6.5.1 立场提交 → interrupt resume 的端到端机制

由于 HTTP 请求不能直接操作 LangGraph 的 interrupt state，`/stance` 端点必须**通过 agentWorker 现有的队列机制**将 Command 注入到暂停的会话：

```typescript
// server/api/v1/assistant/contract/reviews/[id]/stance.post.ts
export default defineEventHandler(async (event) => {
    const reviewId = Number(getRouterParam(event, 'id'))
    const { stance } = await readBody(event)
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const review = await getContractReviewDAO(reviewId)
    if (review.userId !== user.id) return resError(event, 403, '无权操作')
    if (review.status !== 'awaiting_stance') {
        return resError(event, 400, `当前状态 ${review.status} 不允许提交立场`)
    }

    // 复用 agentRuns + agentWorker 的入队机制：
    // 以 command 字段携带 stance，worker 在 executeRun 中检测到
    // scope=assistant 且 input.command 存在时，走 Command({ resume }) 路径
    await enqueueAgentRunService({
        sessionId: review.sessionId,
        userId: user.id,
        scope: 'assistant',
        caseId: review.caseId,
        input: {
            message: undefined,
            command: { stance },  // 会被 runAssistantChat 的 Command({ resume }) 消费
        },
    })

    return resSuccess(event, '立场已提交，审查继续', { reviewId })
})
```

**关键点**：`runAssistantChat` 已在第 5.3 节实现 `const input = command ? new Command({ resume: command }) : ...`，此处复用该路径。

### 6.6 审查提示词模板（`contractReview_system` v1）

```text
你是一名严谨的中国律师，站在【{{stanceLabel}}】立场审查以下合同。

合同类型：{{contractType}}
立场重点：{{stanceFocus}}
（stanceFocus 由代码按立场查表填充，内容来自 SKILL.md 的「立场审查原则」表）

# 审查要求
- 逐段审查，标注所有对 {{stanceLabel}} 不利的条款
- 每处问题输出一条结构化 Risk，字段见下方 JSON schema
- 使用专业法律术语，禁用感叹号
- 引用具体法条（《合同法》《民法典》《劳动合同法》等及条号）
- 宁可多标，不可漏标

# 输出格式（严格 JSON，不含多余文字）
{
  "risks": [
    {
      "clauseIndex": 3,
      "clauseText": "原文段落全文",
      "level": "high",
      "category": "付款",
      "problem": "...",
      "legalBasis": "《民法典》第 XXX 条",
      "analysis": "...",
      "risk": "...",
      "suggestion": "...",
      "strategy": "..."
    }
  ],
  "summary": "审查摘要 Markdown..."
}

# 合同段落（已编号）
{{clauses}}
```

立场重点表（代码内置常量，不进 DB）：

| stance | stanceLabel | stanceFocus |
|---|---|---|
| partyA | 甲方 | 延长付款期限、缩短交付、减少己方违约责任、增加对方违约成本、选择己方管辖地 |
| partyB | 乙方 | 缩短付款周期、增加预付款、明确逾期违约金、放宽己方交付期限、减少己方违约责任 |
| neutral | 中立 | 识别所有可能产生歧义或权利义务不对等的条款，不偏向任何一方 |

### 6.7 批注注入实现要点

对齐 SKILL.md 第 262-402 行的 XML 协议，Node.js 版实现要点：

**1. 三个 XML 元素（`word/document.xml`）**
```xml
<w:p>
  <w:commentRangeStart w:id="0"/>
  ...（原段落 runs 不变）
  <w:commentRangeEnd w:id="0"/>
  <w:r><w:commentReference w:id="0"/></w:r>
</w:p>
```

**2. 新建 `word/comments.xml`**
- 命名空间：`xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`
- 每条批注：`<w:comment w:id="N" w:author="LexSeek 审查助手" w:date="2026-04-17T...">...内容段落...</w:comment>`
- 批注内容必须是完整的段落结构（`<w:p><w:r><w:t>...</w:t></w:r></w:p>`）
- `<w:t>` 保留空格：`xml:space="preserve"`

**3. 更新 `[Content_Types].xml`**
```xml
<Override PartName="/word/comments.xml"
          ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
```

**4. 更新 `word/_rels/document.xml.rels`**
```xml
<Relationship Id="rIdComments"
              Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments"
              Target="comments.xml"/>
```

**5. 批注内容文本（格式与 SKILL.md 对齐）**
```
[高风险] 付款条件

【法律依据】《民法典》第 509 条：当事人应当按照约定全面履行自己的义务。

【条款分析】
条款约定"甲方收到发票后 60 日内付款"，对乙方不利：
1. 60 天回款周期可能导致现金流紧张
2. 未约定逾期付款违约金

【法律风险】
1. 甲方可能恶意拖延付款
2. 乙方维权成本增加

【修改建议】
建议改为："甲方收到发票后 30 日内付款，逾期按日万分之五支付违约金"

【谈判策略】
1. 强调行业标准付款周期为 30 天
2. 可接受 45 天作为折中
3. 坚持加入逾期违约金条款
```

**6. 单元测试必含**
- Microsoft Word 打开可见完整批注
- WPS 打开不崩溃且批注可见
- 同一 reviewId 重复执行两次，批注 id 不冲突
- 批注内容包含中文正常显示
- 批注数量 ≥ 20 时仍正确

### 6.8 API 契约

```
POST /api/v1/assistant/contract/reviews
  body: {
    sourceType: 'upload' | 'paste' | 'case_material',
    ossFileId?: number,        // sourceType='upload'
    text?: string,             // sourceType='paste'
    caseMaterialId?: number,   // sourceType='case_material'
    caseId?: number,           // 案件页复用时传入
  }
  resp: { reviewId: number, sessionId: string }

GET /api/v1/assistant/contract/reviews/:id
  resp: {
    review: {
      id, status, contractType, partyA, partyB, stance,
      risks, summary, originalFileId, reviewedFileId,
      createdAt, updatedAt,
    }
  }

POST /api/v1/assistant/contract/reviews/:id/stance
  body: { stance: 'partyA' | 'partyB' | 'neutral' }
  resp: { success: true }
  // 内部：通过 assistantAgent 的 Command({ resume: { stance } }) 恢复执行

GET /api/v1/assistant/contract/reviews/:id/download
  resp: 302 → OSS 签名 URL（reviewedFileId 的下载链接）

GET /api/v1/assistant/contract/reviews?page=&pageSize=&caseId=
  resp: { list, total }
```

### 6.9 UI 布局（合同审查页）

```
/dashboard/assistant/contract

┌───────────────────────────────────────────────────────────┐
│  Step 1: 提交合同（首屏）                                    │
│  ┌─────────────────────────────────────┐                  │
│  │ [粘贴文本] [上传 .docx] [从案件材料] │  ← 案件页复用时   │
│  │                                     │    默认"从案件    │
│  │   请粘贴合同内容，或拖拽 .docx 文件  │    材料"          │
│  │                                     │                  │
│  │  [开始审查]                          │                  │
│  └─────────────────────────────────────┘                  │
├───────────────────────────────────────────────────────────┤
│  Step 2: 立场选择对话框（审查中途弹出）                       │
│  ┌─────────────────────────────────────┐                  │
│  │  已识别合同类型：劳动合同              │                  │
│  │  甲方：某某科技有限公司                │                  │
│  │  乙方：张三（个人）                    │                  │
│  │                                     │                  │
│  │  请问您代表哪一方进行审查？            │                  │
│  │  [○ 甲方]  [○ 乙方]  [○ 中立]         │                  │
│  │           [确认]                    │                  │
│  └─────────────────────────────────────┘                  │
├───────────────────────────────────────────────────────────┤
│  Step 3: 审查结果（左右双栏）                                │
│  ┌────────────────┐  ┌────────────────┐                   │
│  │ 合同全文         │  │ 风险点清单       │                   │
│  │ (docx-preview   │  │ [高] 付款条件    │                   │
│  │  渲染)          │  │ [高] 争议解决    │                   │
│  │ 批注浮层        │  │ [中] 保密条款    │                   │
│  │ (高亮段落点击    │  │ [低] 竞业限制    │                   │
│  │  展开批注)      │  │                 │                   │
│  │                │  │ [下载 Word]      │                   │
│  │                │  │ [查看 diff]      │                   │
│  │                │  │ [导出报告]       │                   │
│  └────────────────┘  └────────────────┘                   │
└───────────────────────────────────────────────────────────┘
```

### 6.10 在案件详情页的复用

- 打开 `caseDetail` → 切换到文档/合同 tab → 点击"审查此合同"
- 实际调用同一组件 `<ContractReviewPanel :case-id="caseId" :source="selectedMaterial"/>`
- 组件根据 caseId 自动隐藏"从案件材料"之外的上传方式；完成后结果自动挂到当前 case 下

---

## 7. 文书生成设计（第二期完整冻结）

### 7.1 功能目标

律师选择预设/私人文书模板，提交案情材料，AI 自动填充 Word 模板中的 `{{占位符}}`，用户可通过表单调整每个字段后导出带格式的 .docx。

### 7.2 流程（先选模板 → 再传资料）

```
页面打开 /dashboard/assistant/document
    ↓
Step 1: 选择文书模板（页面上方）
  ┌──────────────────────────────────────┐
  │ [起诉状] [答辩状] [函件] [合同] [其它]│  ← 分类 Tab
  │ ┌────┐┌────┐┌────┐┌────┐            │
  │ │民间││劳动││离婚││... │← 模板卡片   │
  │ │借贷││仲裁││纠纷││    │              │
  │ └────┘└────┘└────┘└────┘            │
  │ 已选：民间借贷起诉状 ✓ [更换]          │
  └──────────────────────────────────────┘
    ↓
Step 2: 提交材料（下方 AiPromptInput）
  ┌──────────────────────────────────────┐
  │  AiPromptInput                       │
  │  [粘贴材料文本 / 上传文件]              │
  │  [📎 附件]         [✨ 开始生成]       │
  └──────────────────────────────────────┘
    ↓
POST /api/v1/assistant/document/drafts
  body: { templateId, sourceText?, sourceFileIds?, caseId? }
  → 创建 case_sessions(scope='assistant') + document_drafts(status='drafting')
    ↓
agentWorker → runAssistantChat（带 draftDocument 工具）
    ↓
[AI 调用 draftDocument 工具]
  ├─ 读取 template.placeholders 列表
  ├─ 读取材料文本（文件已由 material 模块预处理）
  ├─ 调用填充 prompt → 返回 { placeholderName: value }
  └─ 流式写回 document_drafts.values（每填完一个就推 SSE）
    ↓
Step 3: 表单 + 预览（左右双栏）
  ┌─────────────────┐  ┌─────────────────┐
  │ 字段表单          │  │ 文档实时预览     │
  │ 原告姓名 [___]    │  │ (docx-preview    │
  │ 被告姓名 [___]    │  │  动态替换占位符)  │
  │ 借款金额 [___]    │  │                  │
  │ 借款日期 [日期]   │  │                  │
  │ ...              │  │                  │
  └─────────────────┘  └─────────────────┘
    ↓ 用户编辑任一字段 → debounce 500ms → PATCH /drafts/:id
    ↓
Step 4: 导出 .docx
  POST /api/v1/assistant/document/drafts/:id/export
  → 后端读模板 .docx → docxtemplater 占位符替换 → 上传 OSS
  → 返回 downloadUrl
```

**未选模板时**：下方"开始生成"按钮 disabled，占位提示"请先选择文书类型"。

### 7.3 占位符协议

**语法**：统一使用 `{{name}}`（双花括号）。选此语法而非 `${name}` 因为 `${}` 与 Word 字段码冲突。

**命名规则**（影响表单自动推断）：

| 占位符名模式 | 控件类型 | 示例 |
|---|---|---|
| 包含 `date` / `_at` / `_time` 结尾 | Date picker | `contract_date` |
| 包含 `amount` / `money` / `fee` / `price` | Number + 千分位 | `loan_amount` |
| 包含 `phone` / `mobile` | Input + 11 位校验 | `plaintiff_phone` |
| 包含 `id_number` / `_id_card` | Input + 18 位校验 | `plaintiff_id_number` |
| `sex` / `gender` | Select: 男/女 | `plaintiff_sex` |
| `_type` 结尾 | Select（选项由 AI 填充时附带建议值） | `contract_type` |
| 其它 | Input（值 > 50 字符自动升级为 textarea） | `plaintiff_name` |

### 7.4 模板管理

#### 7.4.1 全局模板（管理员后台）

- 路由：`/admin/document-templates`
- 功能：上传 / 编辑元信息（name、category、description、priority）/ 上架下架 / 删除
- 上传流程：
  1. 校验文件为 `.docx` 且可正常解析
  2. 扫描占位符 → 写入 `placeholders` JSON 字段
  3. 上传到 OSS → 写入 `ossFileId`
  4. 扫描不到占位符则拒绝上传并提示
- 初始导入脚本：`scripts/importDocumentTemplates.ts`
  - 接受一份 CSV：`file_path, name, category, description, priority`
  - 批量上传文件 + 扫描占位符 + 写表

#### 7.4.2 用户私人模板

- 用户在 `/dashboard/assistant/document/templates` 上传
- **配额限制**：按当前用户已存在的 `documentTemplates` 行数（`scope='user' AND userId=X AND deletedAt IS NULL`）做 COUNT 查询，超过阈值拒绝上传
- 阈值具体数值与是否区分会员等级为开放问题（见 §11 #4）；第三期实施前再确定
- 本 spec **不新增** benefit 体系配额字段（遵守 §4.5 原则）
- scope='user', userId=当前用户

#### 7.4.3 模板查询

```typescript
// 用户可见 = 自己的模板 + 所有全局模板
WHERE (scope='user' AND userId=<current>)
   OR (scope='global' AND status=1)
  AND deletedAt IS NULL
```

### 7.5 占位符扫描实现

```typescript
// server/services/assistant/document/templateScanner.ts
import mammoth from 'mammoth'

const PLACEHOLDER_RE = /\{\{([a-zA-Z_][\w]*)\}\}/g

export async function scanPlaceholders(docxBuffer: Buffer): Promise<Placeholder[]> {
    const { value: rawText } = await mammoth.extractRawText({ buffer: docxBuffer })
    const map = new Map<string, string>()
    let match
    while ((match = PLACEHOLDER_RE.exec(rawText)) !== null) {
        const name = match[1]
        if (!map.has(name)) {
            // 记录首次出现段落的上下文，辅助 AI 推断语义
            const lineStart = rawText.lastIndexOf('\n', match.index) + 1
            const lineEnd = rawText.indexOf('\n', match.index + match[0].length)
            const firstContext = rawText.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
            map.set(name, firstContext)
        }
    }
    return [...map.entries()].map(([name, firstContext]) => ({ name, firstContext }))
}
```

### 7.6 AI 填充提示词（`documentDraft_system` v1）

```text
你要从用户提供的案情材料中提取信息，为以下文书模板的占位符生成内容。

# 模板信息
模板名称：{{templateName}}
模板类别：{{templateCategory}}

# 占位符列表（每个占位符附带首次出现的段落上下文）
{{placeholdersWithContext}}

# 用户材料
{{sourceText}}

# 要求
- 对每一个占位符输出一个值
- 值必须能直接填入对应位置语法通顺
- 日期使用 "YYYY年MM月DD日" 格式（除非占位符名明确是日期控件）
- 金额保留原币种，数字使用阿拉伯数字
- 对无法从材料中确定的占位符：若可根据法律模板常识推断（如"起诉请求"常见表述），给出建议值并标注 "推断"；若完全无法推断，输出 null
- 不编造当事人姓名、身份证号、具体日期

# 输出格式（严格 JSON）
{
  "values": {
    "plaintiff_name": "张三",
    "loan_amount": "100000",
    "contract_date": "2025年3月1日",
    "jurisdiction": null,
    ...
  },
  "suggestions": {
    "jurisdiction": "建议填写「被告住所地人民法院」"
  }
}
```

### 7.7 `draftDocument` 工具契约

```typescript
const draftDocumentTool = tool({
  name: 'draftDocument',
  description: '根据已选模板和用户材料，填充文书占位符',
  schema: z.object({
    draftId: z.number(),
  }),
  async execute({ draftId }) {
    const draft = await getDocumentDraftDAO(draftId)
    const template = await getDocumentTemplateDAO(draft.templateId)
    const sourceText = await gatherSourceText(draft.sourceRef)

    const { values, suggestions } = await runDraftPrompt({
      templateName: template.name,
      templateCategory: template.category,
      placeholdersWithContext: template.placeholders,
      sourceText,
    })

    await updateDocumentDraftDAO(draftId, {
      values,
      status: 'ready',
      metadata: { suggestions },
    })

    return { values, suggestions }
  },
})
```

### 7.8 导出实现

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
        // 缺失占位符用 nullGetter 统一兜底为空字符串，避免
        // docxtemplater 对"未定义变量"抛错（尤其 loop/条件场景下 ?? '' 会失效）
        nullGetter: () => '',
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

> **docxtemplater 自带 run-joining 能力**：能正确处理 Word 把 `{{name}}` 切分到多个 `<w:r>` 的情况，保持原样式。MIT 协议，可商用。
> `nullGetter` 是官方推荐的缺失值兜底机制（见 docxtemplater 官方文档），覆盖 `{{ key }}`、`{#loop}...{/loop}`、`{?key}...{/key}` 等各种语法。

### 7.9 API 契约

```
GET /api/v1/assistant/document/templates?scope=global|user|all&category=X&q=搜索词&page=1&pageSize=20
  resp: { list: [{ id, name, category, description, placeholderCount }], total }

POST /api/v1/assistant/document/templates
  body: multipart/form-data { file, name, category, description? }
  resp: { templateId }
  // 用户私人模板上传；admin 用同一接口但 scope 自动判为 global

POST /api/v1/assistant/document/drafts
  body: { templateId, sourceText?, sourceFileIds?, caseId? }
  resp: { draftId, sessionId }

GET /api/v1/assistant/document/drafts/:id
  resp: { draft: { id, templateId, values, suggestions, status, outputFileId } }

PATCH /api/v1/assistant/document/drafts/:id
  body: { values: { placeholderName: value } }
  resp: { draft }

POST /api/v1/assistant/document/drafts/:id/export
  resp: { ossFileId, downloadUrl }

GET /api/v1/assistant/document/drafts?page=&pageSize=&caseId=
  resp: { list, total }
```

### 7.10 UI 布局（文书生成页）

已在 §7.2 流程图中展示，此处补充几个关键细节：

- 模板卡片右上角小标："全局"（蓝）/ "我的"（绿）
- 已选模板区显示"已选：XXX ✓ [更换]"，点击更换回到选择界面
- 资料输入区的 `AiPromptInput` 与对话页完全一致的视觉与交互
- 表单字段按 `template.placeholders` 顺序渲染，每个字段右上角小问号显示 AI suggestion

**实时预览的技术实现**（关键）：
- `docx-preview` 直接渲染**原始模板 .docx**（HTML 输出到隐藏容器）
- `docx-preview` 本身**不支持** `{{placeholder}}` 模板语法，需要前端对渲染结果做文本节点替换：
  ```typescript
  function replacePlaceholders(root: HTMLElement, values: Record<string, string>) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      const tasks: Array<() => void> = []
      while (walker.nextNode()) {
          const node = walker.currentNode as Text
          const original = node.nodeValue ?? ''
          const replaced = original.replace(/\{\{(\w+)\}\}/g, (_, name) => values[name] ?? '')
          if (replaced !== original) tasks.push(() => { node.nodeValue = replaced })
      }
      tasks.forEach(fn => fn())
  }
  ```
- 用户改表单 → debounce 500ms → 克隆原 DOM 树 → 调 `replacePlaceholders` → 替换到预览容器
- **注意**：占位符跨 `<w:r>` 切分后 docx-preview 渲染出来的文本节点可能被拆分。若检测到拆分，降级为"后端用 docxtemplater 渲染 → 返回 HTML/base64 预览"；此为降级路径，第三期实施时若发现 UI 不稳定再启用

### 7.11 在案件详情页的复用

- `caseDetail` → `documents` tab → 打开相同组件 `<DocumentDraftPanel :case-id="caseId"/>`
- 模板选择区默认收起不常用分类
- 资料输入区预填案件材料选项（从 `caseMaterials` 列表多选）
- `caseId` 自动注入 `documentDrafts.caseId`
- 导出后的 .docx 可选"保存到案件材料库"

### 7.12 模板导入计划（首批 100+ 模板）

**前置工作**（运营 & 产品协同）：
1. 把 100+ Word 文件的占位符统一用 `{{name}}` 重写
2. 为每个文件准备元信息 CSV：`file_path, name, category, description, priority`

**执行脚本** `scripts/importDocumentTemplates.ts`：
- 逐行读 CSV
- 对每行：校验 .docx 可解析 → 扫描占位符 → 上传 OSS → 写 `documentTemplates(scope='global')`
- 扫描不到占位符的文件报错中止
- 输出成功/失败清单

---

## 8. 前端实现（第一期）

### 8.1 路由与布局

```typescript
// app/pages/dashboard/assistant/chat.vue
definePageMeta({
  layout: 'dashboard-layout',
  title: '法律助手 · 对话',
  icon: 'MessageSquare',
})
```

侧边栏 `navMain.vue` 通过 RBAC 路由系统注册三个菜单项：
- `/dashboard/assistant/chat` - 法律助手 · 对话（第一期）
- `/dashboard/assistant/contract` - 法律助手 · 合同审查（第二期，先占位 WIP 页）
- `/dashboard/assistant/document` - 法律助手 · 文书生成（第二期，先占位 WIP 页）

### 8.2 对话页结构

```
┌─────────────────────────────────────────────────────┐
│  <AssistantSessionList>  │  <AiChat>                 │
│  ┌──────────────────┐    │  ┌────────────────────┐  │
│  │ + 新对话           │    │  │ 消息列表             │  │
│  │ ─────────────────│    │  │ (AiMessageList)    │  │
│  │ 我的劳动合同风险   │    │  │                    │  │
│  │ 房屋租赁条款     ① │    │  │                    │  │
│  │ 咨询商标注册   …   │    │  │                    │  │
│  │ ...              │    │  ├────────────────────┤  │
│  └──────────────────┘    │  │ <AiPromptInput>    │  │
│                          │  └────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

① 当前选中会话有高亮样式。

### 8.3 Composable 与组件

#### 8.3.1 `useAssistantChat(sessionId)`

```typescript
// app/composables/useAssistantChat.ts
export function useAssistantChat(sessionId: Ref<string>) {
    const messages = ref<Message[]>([])
    const loading = ref(false)
    const isInterrupted = ref(false)

    const { send, stop } = useStreamChat({
        url: '/api/v1/assistant/chat',
        sessionId,
        onMessage(msg) { /* 追加到 messages */ },
        onInterrupt() { isInterrupted.value = true },
        onDone() { loading.value = false },
    })

    async function sendMessage(input: AiPromptSubmitData) {
        loading.value = true
        await send({ message: input.text, thinking: input.thinking })
    }

    return { messages, loading, isInterrupted, sendMessage, stop }
}
```

基于现有 `useStreamChat`，接口与 `useXiaosuoChat` 对齐。

#### 8.3.2 `<AssistantSessionList>`

```vue
<!-- app/components/assistant/AssistantSessionList.vue -->
<script setup lang="ts">
const sessions = ref<AssistantSession[]>([])
const selectedId = defineModel<string | null>()

async function loadSessions() {
    const result = await useApiFetch<{ list: AssistantSession[] }>('/api/v1/assistant/sessions')
    if (result) sessions.value = result.list
}

async function createSession() {
    const result = await useApiFetch<{ sessionId: string }>('/api/v1/assistant/sessions', {
        method: 'POST',
        body: {},
    })
    if (result) {
        selectedId.value = result.sessionId
        await loadSessions()
    }
}

async function renameSession(id: string, title: string) {
    await useApiFetch(`/api/v1/assistant/sessions/${id}`, {
        method: 'PATCH',
        body: { title },
    })
    await loadSessions()
}

async function deleteSession(id: string) {
    await useApiFetch(`/api/v1/assistant/sessions/${id}`, { method: 'DELETE' })
    if (selectedId.value === id) selectedId.value = null
    await loadSessions()
}
</script>
```

#### 8.3.3 `<AiChat>` 组件复用

直接复用 `app/components/ai/AiChat.vue`，传入 `messages` / `loading` / `isInterrupted` / 事件回调，无需新增组件。

### 8.4 会话生命周期

1. 打开对话页 → 加载会话列表
2. 用户点"新对话" → `POST /sessions` → 拿到 sessionId → 选中
3. 发送首条消息 → `POST /chat` SSE → 流式渲染
4. 首条完整 AI 回复返回后，后端异步生成 ≤ 20 字标题写回 `title`，前端轮询或下次刷新列表时看到
5. 会话列表右键支持"重命名 / 删除"
6. 刷新页面时恢复 URL 中 sessionId，从 checkpointer 拉消息历史渲染

### 8.5 URL 状态

`?sid=<sessionId>` 作为当前会话的 URL 参数，支持分享、回溯。

---

## 9. 实施计划与分期

### 9.1 第一期（基础设施 + 对话 + 积分）

**目标**：让无 case 对话能用，建立后续扩展的基础。

**前置依赖检查**：本期**无需**安装新 npm 包，全部使用现有依赖。

**交付清单**：
1. 数据模型
   - [ ] `caseSessions` 放宽 + 新增字段（Prisma migrate）
   - [ ] `agentRuns` 放宽 + 新增字段（Prisma migrate）
   - [ ] `nodes` 表插入 `assistantMain` + 对应 `prompts` v1（seed 脚本或 admin 后台）
   - [ ] `pointConsumptionRules` 新增 `assistant_token` 计费键配置（不改 benefit enum）
2. 存量数据
   - [ ] `scripts/backfillSessionUserId.ts` 回填脚本
   - [ ] 部署文档更新：指示运维执行回填脚本
3. 后端
   - [ ] `assistantSession.service/dao`
   - [ ] `workflow/agents/assistantAgent.ts`
   - [ ] `agentWorker` 按 scope 分流
   - [ ] 改写 `session.dao.ts` 的 `findSessionWithOwnershipCheck`（兼容 assistant scope）
   - [ ] `/api/v1/assistant/sessions.*`
   - [ ] `/api/v1/assistant/chat`
   - [ ] `/api/v1/assistant/runs/cancel/[runId]`
4. 前端
   - [ ] `/dashboard/assistant/chat` 页
   - [ ] `AssistantSessionList` 组件
   - [ ] `useAssistantChat` composable
   - [ ] 侧边栏三个菜单项注册（后两个先链到 WIP 占位页）
   - [ ] 首条消息后异步生成会话标题
5. 测试
   - [ ] `assistantSession` DAO 单测（scope/caseId 互斥校验、userId 校验）
   - [ ] `findSessionWithOwnershipCheck` 单测（case 域 + assistant 域两种 session 都能正确鉴权）
   - [ ] `assistantAgent` 集成测试（SSE 流、工具调用、积分扣减）
   - [ ] 端到端：新建会话 → 发消息 → 收流 → 标题生成 → 列表显示

### 9.2 第二期（合同审查）

**前置**：第一期完成。

**前置依赖安装**：
```bash
bun add fast-xml-parser diff-match-patch docx-preview
# mammoth、jszip 已存在
```

**交付清单**：
1. 数据模型
   - [ ] `contractReviews` 新表（Prisma migrate）
   - [ ] `nodes.assistantMain.tools` 追加 `reviewContract`
2. 后端
   - [ ] `contractReview.service/dao`
   - [ ] `docx` 子模块：parser、commentInjector、partyDetector、zipRewriter
   - [ ] `reviewContract` 工具（含 interrupt 立场询问）
   - [ ] `contractReview_system` 提示词 v1
   - [ ] `/api/v1/assistant/contract/reviews/*`
3. 前端
   - [ ] `/dashboard/assistant/contract` 页
   - [ ] `<ContractReviewPanel>` 组件（支持 caseId prop）
   - [ ] 立场选择对话框
   - [ ] `docx-preview` 集成
   - [ ] 风险点清单侧栏
   - [ ] 案件页 `documents` tab 接入
4. 测试
   - [ ] 批注注入单测：Word/WPS 打开可见、id 不冲突、中文正常
   - [ ] partyDetector 单测：常见合同格式、缺字段容错
   - [ ] E2E：上传 → 立场选择 → 审查完成 → 下载

### 9.3 第三期（文书生成）

**前置**：第一期完成。第二期可并行。

**前置依赖安装**：
```bash
bun add pizzip docxtemplater
# docx-preview 与第二期共用（若第二期已装则免）
# mammoth 已存在，用于占位符扫描
```

**交付清单**：
1. 数据模型
   - [ ] `documentTemplates` + `documentDrafts` 新表（Prisma migrate）
   - [ ] `nodes.assistantMain.tools` 追加 `draftDocument`
2. 后端
   - [ ] `documentTemplate.service/dao` + `documentDraft.service/dao`
   - [ ] 占位符扫描：`templateScanner.ts`
   - [ ] 导出：`documentExport.service`（pizzip + docxtemplater）
   - [ ] `draftDocument` 工具
   - [ ] `documentDraft_system` 提示词 v1
   - [ ] `/api/v1/assistant/document/*`
   - [ ] `scripts/importDocumentTemplates.ts`
3. 前端
   - [ ] `/dashboard/assistant/document` 页
   - [ ] `<DocumentDraftPanel>` 组件
   - [ ] 模板选择区（分类 Tab + 卡片）
   - [ ] 表单自动推断控件（Input/Date/Number/Select）
   - [ ] 实时预览（docx-preview 渲染模板 + 占位符替换）
   - [ ] 案件页 `documents` tab 接入
4. 管理后台
   - [ ] `/admin/document-templates` 模板管理
5. 测试
   - [ ] 占位符扫描单测（多 run 切分、空白、边界）
   - [ ] 导出保真单测（样式保留、中文正常、特殊字符）
   - [ ] E2E：选模板 → 填资料 → 生成 → 改表单 → 导出

---

## 10. 风险与权衡

### 10.1 表名不重命名导致的语义泄漏

- `case_sessions` 表里混有 `scope='assistant'` 的行，表名暗示性误导
- **权衡**：保留表名换取迁移简单、数据零丢失、可完整复现
- **缓解**：所有新代码引用 DAO（`assistantSession.dao` / `caseSession.dao`）屏蔽表名；只有 Prisma schema 文件直接暴露表名
- 若未来要统一，可单独立项做表重命名，届时通过视图过渡

### 10.2 应用层校验 vs DB CHECK 约束

- 丢失 DB 层保护后，如果有绕过 DAO 的裸 SQL 写入，可能产生 scope 与 caseId 不一致的脏数据
- **缓解**：
  - 所有写入必须走 `*.dao.ts` + Zod 校验
  - ESLint 规则：禁止 `prisma.caseSessions.create/update` 直接调用（必须通过 DAO）
  - CI 添加数据一致性检查 SQL：每周跑一次巡检（`SELECT * FROM case_sessions WHERE (scope='case' AND case_id IS NULL) OR (scope='assistant' AND case_id IS NOT NULL)`）

### 10.3 assistantAgent 与 caseMainAgent 代码重复

- 两个 agent 结构相似，约 70% 重复
- **权衡**：重复可接受，因为两者的中间件/工具/提示词在演化路径上必然发散；强行抽象共同层会增加耦合
- 若未来中间件确实稳定收敛，再考虑提取 `createWorkflowAgent(config)` 工厂

### 10.4 Word 批注注入的格式兼容性

- Word 在不同版本、WPS、Google Docs 下批注表现可能不同
- **缓解**：
  - 单测覆盖 Microsoft Word 最新稳定版与 WPS 最新版
  - 批注 author 固定为 "LexSeek 审查助手"
  - 批注日期使用 UTC ISO 8601
  - 提供"简化视图"降级：若检测到 Word 不支持，可导出为纯文本报告

### 10.5 文书模板数量与索引成本

- 100+ 全局模板 + 每用户最多 20 个私人模板，总量可能到 10k 级
- **缓解**：
  - `documentTemplates` 已加复合索引 `(scope, userId)`
  - 模板列表查询分页（默认 20/页）
  - 模板搜索走全文索引（若必要，后期加 pg_trgm）

### 10.6 积分模型而非 benefit 配额模型

- 本 spec 未引入"次数/月"的配额型权益，原因是现有 `BenefitCode` 体系（`BYTE` / `COUNT` + `SUM` / `MAX` 模式）没有周期归零机制，运营用的 `membershipBenefits` 行为是累加型额度
- **权衡**：本期只做"积分 token 扣减"这一种门控方式，简单、可靠、与现有代码对齐；放弃按次限额的产品能力
- 若后期运营需要"免费用户 20 次/月"类限制，需单独立项扩展 benefit 体系（新增 `PERIOD_RESET` 模式 + `usageCounters` 表 + 月末 cron），此改造不在本 spec 范围

### 10.7 中断恢复的一致性

- 合同审查在立场询问处 `interrupt()`，如果用户关闭页面后再进来，应能看到"等待立场"状态
- **实现**：`contractReviews.status='awaiting_stance'`，前端查询时检测此状态，直接弹立场选择框，提交后通过 `/stance` 端点 → `enqueueAgentRunService` → `runAssistantChat({ command: { stance } })` → `Command({ resume })` 恢复
- 恢复路径已在 §6.5.1 端到端说明

---

## 11. 开放问题

以下问题不阻塞 spec 定稿，但实施前需要回答：

| # | 问题 | 预期阶段 |
|---|---|---|
| 1 | `assistantMain` 节点的模型选择（是否用更便宜的 Haiku？） | 第一期实施前 |
| 2 | `assistant_token` / `contract_review_token` / `document_draft_token` 三个计费键在 `pointConsumptionRules` 的具体单价 | 第一期实施前（运营决策） |
| 3 | 首批 100+ 文书模板的分类体系与命名规范（CSV 准备） | 第三期前（运营准备） |
| 4 | 用户私人模板配额的免费/付费分档（需要时再扩展 benefit 体系） | 第三期前 |
| 5 | 是否在第一期侧边栏就展示合同审查/文书生成的入口（WIP 占位）| 第一期前（产品决策） |
| 6 | 合同审查 / 文书生成是否需要历史记录列表页（类似会话列表）| 第二/三期前 |
| 7 | 是否需要对"按次配额"做产品承诺（决定是否立项扩展 benefit 周期归零能力）| 后续独立立项 |

---

## 12. 附录

### 12.1 术语表

| 术语 | 定义 |
|---|---|
| scope | 会话/运行的归属域，值为 `case` 或 `assistant` |
| sessionId | LangGraph thread_id，所有 checkpoint 的关联键 |
| node | `nodes` 表一行，定义一个 AI 任务的模型/工具/提示词配置 |
| stance | 合同审查中的用户立场：甲方 / 乙方 / 中立 |
| placeholder | 文书模板中的 `{{name}}` 占位符 |
| benefit | 会员权益单元，按 `BenefitCode` 标识 |

### 12.2 参考资料

- `~/Desktop/contract-review-assistant/SKILL.md` - 合同审查业务流程与 .docx 批注 XML 协议
- `docs/tech-docs/backend/workflow.md` - LangGraph 工作流架构
- `docs/tech-docs/backend/agent.md` - Agent 任务调度
- `docs/tech-docs/patterns/service-dao.md` - Service + DAO 模式
- `docs/tech-docs/patterns/sse-event-bridge.md` - SSE 事件桥接
- 现有实现参考：
  - `server/services/workflow/agents/caseMainAgent.ts`
  - `server/services/workflow/middleware/pointConsumption.middleware.ts`
  - `app/components/ai/AiChat.vue`
  - `app/composables/useXiaosuoChat.ts`

### 12.3 Prisma 迁移命令清单

```bash
# 第一期
bun run prisma:migrate dev --name add_assistant_scope_to_sessions_and_runs

# 第二期
bun run prisma:migrate dev --name add_contract_reviews

# 第三期
bun run prisma:migrate dev --name add_document_templates_and_drafts
```

每条命令执行后：
1. 生成的 migration 文件进入 `prisma/migrations/<timestamp>_<name>/`
2. 可通过 `bun run prisma:generate` 更新客户端
3. 删除 `prisma/migrations/` 后重新 `prisma migrate dev` 能从 `schema.prisma` 重新生成一致数据库

---

*设计文档结束。*
