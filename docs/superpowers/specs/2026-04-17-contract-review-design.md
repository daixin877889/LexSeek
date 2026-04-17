# 合同审查 · 实施 Spec（Phase 2）

> **父 spec**: [`2026-04-17-legal-assistant-design.md`](./2026-04-17-legal-assistant-design.md) §6
>
> **关系**：本文档对父 spec §6 做实施细化。**与 §6 的任何冲突以本文档为准**；未被本文档覆盖的部分（如 `contractReviews` 字段定义、API 路径、批注 XML 协议细节）沿用 §6。
>
> **受众**：实施合同审查功能的工程师与 AI 协作代理。
>
> **与文书生成 spec 的关系**：本 spec 与 [`2026-04-17-document-generation-design.md`](./2026-04-17-document-generation-design.md) 是并行的 Phase spec。两者复用相同的 agent 架构模式（独立 agent + responseFormat + 持久化中间件），差异点在于合同审查多一次中断交互（立场选择）与批注注入流程。

---

## 1. 目标与范围

### 1.1 功能目标

律师上传 / 粘贴合同（.docx 或纯文本），AI 通过独立 `contractReviewMain` agent：

1. 自动解析段落，识别合同类型与甲乙方
2. 通过中断交互请求用户审查立场（甲方 / 乙方 / 中立）
3. 按立场产出结构化风险点清单（`Risk[]`）+ 审查摘要
4. 将风险点以原生 Word 批注注入原 .docx，生成可下载的带批注文件

**用户核心闭环（5 步）**：

```
1. 进入 `/dashboard/assistant/contract`（MVP 唯一入口；案件详情页复用延后，见 §1.2 "不在本次范围"）
2. 提交合同（粘贴文本 / 上传 .docx）
3. AI 识别甲乙方 → 弹出立场选择 Dialog（可编辑甲乙方名称）
4. 用户选立场 → AI 按立场逐段审查 → 返回风险清单 + 批注 .docx
5. 用户在结果页浏览 / 编辑风险点 → 下载批注 Word（必要时点击"重新生成批注 Word"）
```

> 原始需求出处：父 spec §1 / §3 "合同审查/文书生成在案件详情页复用"；父 spec §6 全章。

### 1.2 本次交付范围（Phase 2 · MVP）

与父 spec §9.2 对齐，但 MVP 只交付以下能力：

**含**（P0 闭环 + 两项增强）：

- `contractReviews` 新表 + `InterruptType.AWAITING_STANCE` 枚举扩展
- `contractReviewMain` agent 节点（独立节点，type=agent）+ `contractReview_system` 提示词 v1
- 两个新增构件：`parseAndAskStance` 工具 + `reviewResultPersistenceMiddleware`；**不沿用** 父 spec §6.5 的单一 `reviewContract` 大工具
- docx 子模块：`parser` / `partyDetector` / `commentInjector` / `zipRewriter`
- 5 个核心 API 端点：POST/GET `/reviews`、POST `/reviews/:id/stance`、PATCH `/reviews/:id`（用户编辑 risks，**只接受 risks 字段**）、POST `/reviews/:id/rebuild-docx`（手动重生批注）、GET `/reviews/:id/download`（返回 `data.downloadUrl`，非 302）
- 用户侧页：`/dashboard/assistant/contract` + `ContractReviewPanel` + `StanceSelectionDialog` + `useContractReview` composable + docx-preview 合同渲染
- 风险清单侧栏 + **条款级 diff 对比**（high/medium 级展开原文 vs `suggestedClauseText` 差异）
- **用户手动编辑 risks + 手动重生批注 .docx** 按钮
- 积分键 `contract_review_token` 与计费接入
- 5 份工程 AI 生成的占位样本合同（`prisma/seeds/contract-samples/`）
- 共享类型文件 `shared/types/contract.ts`（枚举 + API 请求响应接口；Prisma row 类型通过 `#shared/types/prisma` 间接导入，不在本文件镜像）

**不在本次范围**（延后迭代）：

- 案件详情页复用（`<ContractReviewPanel :case-id>` + caseMaterial 作为输入源）
- `GET /reviews?page=&pageSize=[&caseId=]` 列表接口（父 spec §6.8 定义，当前 MVP UI 无列表页；延后至 M6+ 与案件页复用一并交付）
- 24h 超时 cron（awaiting_stance 过期清理）
- 导出 PDF / Markdown 审查报告（父 spec §6.9 UI 里的"导出报告"按钮）
- 多合同对比 / 合并审查
- 合同专用审查清单 / 经验库（如"劳动合同必审 25 条"）
- `contractReviews.caseId` 字段与 `idx_contract_reviews_case` 索引（父 spec §4.6 定义，MVP 不新增列，M6+ 案件页复用时通过 ALTER TABLE 补列）

### 1.3 里程碑价值优先级

| 优先级 | 里程碑 | 业务价值 |
|---|---|---|
| P0（核心 MVP） | M1 + M2 + M3 + M4 | 用户完整走通：提交 → 立场 → 风险清单 → 下载批注 .docx |
| P0（增强） | M5 | 条款级 diff 对比 + 用户编辑 risks + 手动重生 |

**M6+**（不在本次）：案件页复用、超时 cron、导出报告 —— 下一轮迭代按需启动。

---

## 2. 与父 spec §6 的差异摘要

| 父 spec §6 设计 | 本文档新方案 | 理由 |
|---|---|---|
| 复用 `assistantMain` agent，追加单一 `reviewContract` 工具内部包办 parse + interrupt + 审查 + 批注 + 写库 | **新建独立 `contractReviewMain` agent 节点**（type=agent，仿 `caseMainAgent.ts` 骨架；若文书生成 M3 已产出 `documentMainAgent.ts` 亦可作参考，不是硬依赖）；工具拆分为轻量 `parseAndAskStance` 只负责 parse + partyDetector + interrupt；审查由 agent 主循环按 `responseFormat` 产出；批注注入 + 写库集中在 `reviewResultPersistenceMiddleware.afterAgent` | 与文书生成架构对齐；职责隔离；避免单工具 500+ 行；未来扩展审查清单 / 多轮 QA 更方便 |
| 审查提示词约束"严格 JSON 输出"，由工具解析字符串 | **LangChain v1 `createAgent` + `responseFormat`** 动态构造 `z.object({ risks: z.array(RiskSchema), summary: z.string() })`；每条 Risk 的 `suggestedClauseText` 在 high/medium 级别时强制（`.refine`） | 原生结构化输出，无 JSON 解析失败风险；与文书生成同路径，共用 PoC 结论 |
| 中间件数组手动排列 | **使用 `buildMiddlewareStack([...])` 声明式优先级排序**（`server/services/workflow/middleware/types.ts` 的 `MIDDLEWARE_PRIORITY` / `MIDDLEWARE_NAMES`）；`reviewResultPersistence` 用 `MIDDLEWARE_PRIORITY.RESULT_PERSISTENCE=90` 保证末位执行。**注意**：`buildMiddlewareStack` 已定义但仓库当前尚无 agent 消费，contractReviewMain 是**首个消费方**，实施时没有现成前例可抄，参考函数 JSDoc + analysisResultPersistence 中间件既有手写数组写法的字段命名风格组装 | 项目已有 buildMiddlewareStack 机制且带互斥校验；禁止 spec 里自行硬编码数组 |
| `MIDDLEWARE_NAMES.RESULT_PERSISTENCE = 'analysisResultPersistence'`（单一持久化中间件） | **新增常量** `MIDDLEWARE_NAMES.REVIEW_RESULT_PERSISTENCE = 'reviewResultPersistence'`；原 `RESULT_PERSISTENCE` 常量保留向后兼容，现有 caseMain 代码零侵入 | 复数持久化中间件并存（analysis / review / 未来 draft）；名称常量避免散落硬编码 |
| `contractReviews.sessionId` `@@index`（允许复用） | **改为 `@@unique([sessionId])`** | MVP 约束"重审 = 新建 review"（旧 review 归档），1:1 映射让 `runContractReviewChat` 可以 `findUniqueBySessionId` |
| `contractReviews.caseId` + `idx_contract_reviews_case` 索引 | **MVP 不新增该列与索引**；Prisma schema 里 model 定义也先不含 caseId；M6+ 案件页复用时通过独立 migration `ALTER TABLE contract_reviews ADD COLUMN case_id INT` 补列 | MVP 无案件页复用需求；YAGNI |
| Session scope='assistant'，worker 走 `runAssistantChat` | **新增 scope='contract'**；`agentWorker.executeRun` 加 `if (scope==='contract')` 分支调 `runContractReviewChat` | 与文书生成 `scope='document'` 对齐；独立 scope 语义与 assistantMain 会话不混淆 |
| 工具内 `interrupt()`，resume payload 仅 `{ stance }` | `parseAndAskStance` 工具 `interrupt({ type: AWAITING_STANCE, partyA, partyB, contractType })`；**resume payload 扩展为 `{ stance, partyA, partyB }`**，允许用户在 Dialog 中补充/修正甲乙方名称 | AI 识别甲乙方可能失败或失真；允许用户编辑兜底，体验更好 |
| 批注注入 + 写库散布在工具内部 | **`reviewResultPersistenceMiddleware.afterAgent` 合一同步执行**：写 risks/summary → commentInjector → `uploadFileService` + `createOssFileDao` 两步写回 → update reviewedFileId → status='completed' | 与 `analysisResultPersistenceMiddleware` 同规则；原子性好，SSE completed 事件发出时所有产物已就绪 |
| OSS 调用使用 `uploadToOSS` / `downloadFromOSS` 等非实际函数名 | **修正为实际 API**：上传 `uploadFileService(path, buffer, opts)` + `createOssFileDao({..., status, encrypted: false})`；下载先 `findOssFileByIdDao(id)` 拿 path → `downloadFileService(path, opts)`；参考范例 `server/services/workflow/tools/uploadWorkspaceFile.tool.ts` | 仓库实际 API 与父 spec 草案不一致；复用现有 storage/files 服务 |
| 用户编辑结果没明确提及 | **新增 PATCH `/reviews/:id` + POST `/reviews/:id/rebuild-docx`**：用户可修改 risks JSON，手动触发批注 .docx 重生。PATCH **只接受 `{ risks }`**，不含 summary（UI 无 summary 编辑入口） | MVP 含此增强能力，律师实际使用价值高；砍 summary 编辑对齐 UI 实际 |
| 父 spec §6.4 Step E "改进建议 diff（可选输出）" | **MVP 将 diff 提升为 P0 交付**（§1.2），high/medium 风险强制产出 `suggestedClauseText`；前端 `RiskClauseDiff` 组件用 `diff-match-patch` 渲染段落级对照 | 律师实际工作高频需求；MVP 不算超额 |
| 父 spec §6.9 UI 右侧面板含 `[下载 Word]` + `[导出报告]` | **MVP 仅保留"下载 Word"按钮**；"导出报告"（PDF / Markdown）延后迭代 | 报告模板未定义；独立工作量大；核心闭环不需要 |
| 父 spec §6.8 `GET /reviews?page=&pageSize=&caseId=` 列表接口 | **MVP 不交付此端点**；合同审查 MVP 无列表页 UI（§9.1 只有单入口 `/dashboard/assistant/contract`）；延后至 M6+ 与案件页复用一并实现（届时 `caseId` 参数同步启用） | YAGNI；无列表 UI 需求的 API 不提前交付 |
| 合同文件加密存储未明确 | **不加密**（`encrypted=false`）；下载走 OSS 签名 URL + 业务权限校验 | 与 case 材料行为一致；加密需求可后续迭代按文件敏感度升级 |
| 依赖安装清单：`fast-xml-parser` `diff-match-patch` `docx-preview` | **M1 `bun add fast-xml-parser diff-match-patch`**；`docx-preview` 若文书生成 M1 已装则跳过，否则合装；`mammoth` / `jszip` 已在 package.json | `fast-xml-parser` + `diff-match-patch` 均未安装，`mammoth` / `jszip` 已有（参考 package.json） |

---

## 3. 本次迭代决策一览

| 决策项 | 结论 |
|---|---|
| 交付范围 | §1.2 MVP 范围（P0 闭环 + diff 对比 + 用户编辑 risks） |
| 首批样本合同 | 5 份工程 AI 生成的占位样本（劳动 / 租赁 / 买卖 / 服务 / 借款），置于 `prisma/seeds/contract-samples/` |
| 加密 | 不加密，`encrypted=false` |
| 实施策略 | 自底向上垂直切片，5 个里程碑（见 §12） |
| AI 输出机制 | Agent + `responseFormat`（动态构造 Risk[] schema） |
| 中断机制 | 独立 `parseAndAskStance` 工具 `interrupt()` + 前端 `<StanceSelectionDialog>` |
| 重审策略 | 新建 review（独立 sessionId），旧归档可查（MVP 不提供 UI 入口） |
| 批注重生 | 手动按钮触发 `/rebuild-docx`，后端从当前 risks 重跑 commentInjector 覆盖 reviewedFileId |

---

## 4. 架构总览

### 4.1 端到端流程

```
用户 POST /api/v1/assistant/contract/reviews
  body: { sourceType: 'upload' | 'paste', ossFileId?, text? }
    ↓
[创建阶段] contractReview.service.createAndStart
  ├─ 若 sourceType='paste'：调 textToDocxService 把文本转最小 .docx 存 OSS（同步，<1s）
  ├─ 若 sourceType='upload'：校验 ossFileId 归属当前用户 + MIME=.docx + 大小 ≤ 20MB
  ├─ 创建 caseSessions(scope='contract', title='合同审查 · <filename>')
  ├─ 创建 contractReviews 行（status='pending', originalFileId, sessionId）
  └─ enqueueRunService → agentWorker（worker 按 scope='contract' 分支调 runContractReviewChat）
    ↓
[Agent 阶段] agentWorker → runContractReviewChat(sessionId, options)
  ├─ 从 sessionId 反查 review（contractReviews.sessionId unique index）
  ├─ 并发加载：checkpointer / store / nodeConfig(contractReviewMain) / model
  ├─ 初始 user message = '请对上传的合同执行审查'（占位；实际材料由工具调用拉取）
  ├─ buildRiskSchema() → 专属 Zod schema（risks/summary + suggestedClauseText 条件必填）
  ├─ createAgent({
  │    model, tools: [parseAndAskStance],
  │    systemPrompt: renderSystemPrompt(mainConfig, { reviewId, stanceLabel?, contractType? }),
  │    responseFormat: riskSchema,
  │    middleware: [
  │      pointConsumptionMiddleware(userId, 'contract_review_token', sessionId),
  │      summarization, safetyTrim,
  │      reviewResultPersistenceMiddleware({ reviewId, sessionId }),  // 末位
  │    ],
  │  })
  ├─ agent.stream() — 第一轮：AI 调 parseAndAskStance 工具
  │   工具内：mammoth 提段落 → partyDetector (正则 + LLM 兜底)
  │        → interrupt({ type: AWAITING_STANCE, partyA, partyB, contractType })
  │   agent 挂起，前端 SSE 收到 interrupt 事件 → 拉起 <StanceSelectionDialog>
  │     ↓
  │   用户选立场 + 编辑甲乙方 → POST /reviews/:id/stance
  │     body: { stance, partyA, partyB }
  │     → enqueueRunService 注入 Command({ resume: { stance, partyA, partyB } })
  │     ↓
  │   工具恢复，返回 { stance, partyA, partyB, paragraphs, contractType } 给 agent
  │   agent 按 responseFormat 输出 structuredResponse（risks + summary）
  │
  │  以下由中间件自动完成（agentWorker 只 pipe SSE）：
  │  • beforeAgent: reviewResultPersistence 置 status='reviewing'
  │  • afterModel × N: pointConsumption 按 token 增量扣减
  │  • afterAgent: reviewResultPersistence 读 state.structuredResponse →
  │                 写 risks/summary → commentInjector 注批注 →
  │                 uploadFileService + createOssFileDao 两步写 OSS →
  │                 update reviewedFileId → status='completed'
  │
  └─ SSE 推送 runStatus='completed' 至前端
    ↓
[前端阶段] ContractReviewPanel 监听 runStatus
  ├─ completed → GET /reviews/:id 拉最新 risks + summary + reviewedFileId
  ├─ 渲染双栏：docx-preview 原文 + 风险清单侧栏
  ├─ 用户点击某风险 [查看改写] → diff-match-patch 对 clauseText vs suggestedClauseText 段落级比对
  ├─ 用户编辑 risks（修改级别/问题描述/建议）→ PATCH /reviews/:id
  ├─ 用户点击"重新生成批注 Word" → POST /reviews/:id/rebuild-docx
  │    → commentInjector 基于当前 risks 重跑 → uploadFileService + createOssFileDao → 覆盖 reviewedFileId
  └─ 用户点击"下载 Word" → GET /reviews/:id/download → 响应 data.downloadUrl →
       前端 window.open(downloadUrl) 下载（项目 API 规约恒返回 200，不使用 302 重定向）
```

### 4.2 Agent 架构要点

- 单一 agent 节点 `contractReviewMain`，无场景分支（MVP 不做案件页复用）
- 工具集只有一个：`parseAndAskStance`。审查内容由 agent 按 `responseFormat` 直接生成，不走工具
- 中间件堆栈与文书生成一致，末位加 `reviewResultPersistenceMiddleware`（替代文书生成的 `draftResultPersistenceMiddleware`）

### 4.3 为什么选 responseFormat 而非继续"AI 按提示词返回 JSON 字符串"

| 维度 | 父 spec §6 的 JSON 字符串方案 | 本文档 responseFormat 方案 |
|---|---|---|
| 输出结构化保证 | 提示词约束 + 代码 parse 兜底 | responseFormat 原生强制 |
| JSON 解析失败风险 | 存在（AI 可能漏逗号/多 markdown）| 不存在 |
| Zod 条件约束（如 level=high 必含 suggestedClauseText） | 只能用提示词软约束 | `.refine()` 硬约束 |
| 与文书生成 spec 对齐 | 否 | 是 |

---

## 5. 数据模型增量

### 5.1 新表：`contractReviews`

定义沿用父 spec §4.6，此处强化约束并裁剪 MVP 字段：

**MVP 裁剪**：`caseId` 列与 `idx_contract_reviews_case` 索引**不纳入本期 migration**；Prisma model 定义同步省略这两项。M6+ 案件页复用时通过独立 migration `ALTER TABLE contract_reviews ADD COLUMN case_id INT NULL; CREATE INDEX idx_contract_reviews_case ON contract_reviews(case_id)` 补齐。

**`sessionId` 改为 unique**（override 父 spec §4.6 的 `@@index`）：

- 父 spec 为 `@@index([sessionId])`
- 本实施按"重审 = 新建 review = 新 sessionId" 约束为 1:1
- 改为 `@@unique([sessionId], map: "idx_contract_reviews_session")`
- 让 `runContractReviewChat` 可直接 `findUniqueBySessionId`

**状态机**（状态位仅在下表列出的代码位置写入，不得重复写）：

```
pending          ← POST /reviews 刚创建
  ↓ (agent 开始执行，beforeAgent 钩子触发)
reviewing        ← reviewResultPersistenceMiddleware.beforeAgent 置
  ↓ (agent 调 parseAndAskStance → 工具内 interrupt 前写库)
awaiting_stance  ← parseAndAskStance.tool 内 updateContractReviewDAO
  ↓ (用户 POST /stance 提交)
reviewing        ← /stance.post.ts 内 updateContractReviewDAO
  ↓ (agent 结束，afterAgent 钩子)
completed        ← reviewResultPersistence.afterAgent 写回全部产物
  ↓ (用户编辑 / 重生)
completed        ← PATCH /reviews/:id 或 POST /rebuild-docx 不改 status
               ← 失败场景 → failed（终态，MVP 不支持原地重试）
```

**状态转换的代码归属**（避免 spec/实施冲突；上表流程与下表一一对应）：

| 状态变更 | 触发者 | 唯一代码位置 |
|---|---|---|
| `null → pending` | API POST `/reviews` | `contractReview.service.createAndStart` |
| `pending → reviewing` | agent 首次启动 | `reviewResultPersistenceMiddleware.beforeAgent`（不在 agentWorker 里重复写） |
| `reviewing → awaiting_stance` | 工具即将 interrupt | `parseAndAskStance.tool` 内 `updateContractReviewDAO` |
| `awaiting_stance → reviewing` | 用户提交立场 | `/stance.post.ts` 内 `updateContractReviewDAO({ stance, partyA, partyB, status: 'reviewing' })` |
| `reviewing → completed` | agent 结束且产物就绪 | `reviewResultPersistenceMiddleware.afterAgent` |
| `* → failed` | 任一异常 | 中间件 catch 或 service 顶层 catch |

**`failed` 状态的两种语义区分**（用 `risks` 字段区分，无需新增列）：

- `status='failed' && risks IS NULL`：结构化输出失败（AI 未产出 structuredResponse），**不可通过 rebuild-docx 恢复**，前端显示"AI 输出异常，请重新发起审查"
- `status='failed' && risks IS NOT NULL`：批注注入或 OSS 上传失败但 risks/summary 已落库，**可通过 POST `/rebuild-docx` 恢复**，前端显示"批注生成失败，点击重试"

### 5.2 共享类型：`shared/types/contract.ts`

按项目规范 `.claude/rules/types.md`，双端共用类型必须放在 `shared/types/`。本期新建 `shared/types/contract.ts`，内容：

```typescript
// shared/types/contract.ts
export type RiskLevel = 'high' | 'medium' | 'low'
export type Stance = 'partyA' | 'partyB' | 'neutral'
export type ContractReviewStatus =
    | 'pending' | 'reviewing' | 'awaiting_stance' | 'completed' | 'failed'

// 业务值对象（存 contractReviews.risks JSON 字段）
export interface Risk {
    id: string
    clauseIndex: number
    clauseText: string
    level: RiskLevel
    category: string
    problem: string
    legalBasis?: string
    analysis: string
    risk: string
    suggestion: string
    suggestedClauseText?: string  // high/medium 必填（schema 层 refine 强制）
}

// API 请求/响应
export interface CreateReviewRequest {
    sourceType: 'upload' | 'paste'
    ossFileId?: number
    text?: string
}
export interface CreateReviewResponse { reviewId: number, sessionId: string }
export interface StanceRequest { stance: Stance, partyA?: string, partyB?: string }
export interface PatchReviewRequest { risks: Risk[] }  // 只接受 risks，不含 summary
export interface RebuildDocxResponse { reviewedFileId: number, downloadUrl: string }
export interface DownloadResponse { downloadUrl: string }
```

**InterruptType 枚举扩展**（`shared/types/case.ts`）：在现有 `InterruptType` 枚举里新增 `AWAITING_STANCE = 'awaiting_stance'`；不在 `shared/types/contract.ts` 里定义（跟随已有 InterruptType 的位置约定）。

**Prisma 行类型直接复用**：`contractReviews` row 类型从 `#shared/types/prisma` 或 `~~/generated/prisma/client` 直接 import，不在 `contract.ts` 内镜像定义（对齐 `shared/types/prisma.ts` 的"只重新导出"约定）。

### 5.3 Nodes / Prompts / PointRules

| 表 | 新增行 |
|---|---|
| `nodes` | `name='contractReviewMain', type='agent', tools=['parseAndAskStance'], priority=40, status=1`（priority 在 documentMain(30) 之后） |
| `prompts` | `contractReview_system` v1，挂 `contractReviewMain` 节点，含变量 `{{contractType}}` / `{{stanceLabel}}` / `{{stanceFocus}}`（均英文标识符，兼容 `renderContent` 正则） |
| `point_consumption_items` | `key='contract_review_token', group='agentToken', unit='千tokens', pointAmount=1, discount=1`（单价待运营定，默认与 `assistant_token` / `document_draft_token` 一致） |

所有 seed 同步写入：

- `prisma/seed.ts` 新增 `seedContractReviewMainNode` / `seedContractReviewTokenRule` 函数
- `prisma/seeds/seedData.sql` 同步补入 nodes + prompts + point_consumption_items

**`MIDDLEWARE_NAMES` 扩展**（`server/services/workflow/middleware/types.ts`）：新增常量 `REVIEW_RESULT_PERSISTENCE = 'reviewResultPersistence'`。原 `RESULT_PERSISTENCE = 'analysisResultPersistence'` 保留（caseMain / module 代码继续使用），零破坏改动。同时需在 `server/services/workflow/middleware/index.ts` 追加 `export * from './reviewResultPersistence.middleware'`。

### 5.4 迁移命令

```bash
bun run prisma:migrate dev --name add_contract_reviews
```

迁移包含：

- 新建 `contract_reviews` 表（**不含 caseId 列**）
- `idx_contract_reviews_session` UNIQUE 索引（非普通 @@index）
- `idx_contract_reviews_user` / `idx_contract_reviews_status`（同父 spec §4.6，**不含 `idx_contract_reviews_case`**）

无数据回填需求（纯新表）。

---

## 6. Agent 实现（核心）

**总原则**：骨架与中间件尽量复用 `caseMainAgent.ts`（本期主要参考）；若文书生成 M3 已产出 `documentMainAgent.ts` 可辅助参考，**但不是硬依赖**。Schema 构造、持久化中间件、新工具为新增。

### 6.1 `contractReviewMain` 节点配置

| 字段 | 值 |
|---|---|
| `name` | `contractReviewMain` |
| `type` | `agent` |
| `priority` | 40 |
| `modelId` | 复用 `assistantMain.modelId`；缺失回退首个启用 model |
| `tools` | `['parseAndAskStance']`（仅一个工具） |
| `status` | 1 |

### 6.2 Agent 骨架：仿 `caseMainAgent.ts`

`server/services/workflow/agents/contractReviewMainAgent.ts` 仿 `caseMainAgent.ts` 的 `runCaseChat` 骨架（节点加载 + 模型构造 + 工具注入 + 中间件堆栈），差异处**仅限**：

| 维度 | caseMainAgent | contractReviewMainAgent |
|---|---|---|
| 节点名 | `caseMain` | `contractReviewMain` |
| 工具集 | 配置 + skills + subAgents | 配置中的 `[parseAndAskStance]`，**不加 skills、不装子 agent** |
| 中间件堆栈 | pointConsumption + caseProcessMaterial + moduleContext + summarization + safetyTrim + skillsMiddleware + analysisResultPersistence | pointConsumption + summarization + safetyTrim + **reviewResultPersistence（新增，末位）** |
| `systemPrompt` 变量 | `{ caseId, ... }` | `{ reviewId, contractType? }`（**仅**这两个；stance 相关从工具返回值承接） |
| `responseFormat` | 无 | `buildRiskSchema()`（无动态参数，schema 形状固定） |
| 计费键 | `'case_analysis_token'` | `'contract_review_token'` |

**中间件堆栈构造**：严禁手动硬编码数组排列，必须走项目内置的 `buildMiddlewareStack` 声明式优先级（`server/services/workflow/middleware/types.ts` 的 `MIDDLEWARE_PRIORITY` / `MIDDLEWARE_NAMES`）：

```typescript
import {
    buildMiddlewareStack,
    MIDDLEWARE_PRIORITY,
    MIDDLEWARE_NAMES,
} from '~~/server/services/workflow/middleware/types'

const middleware = buildMiddlewareStack([
    {
        middleware: pointConsumptionMiddleware(userId, 'contract_review_token', sessionId),
        priority: MIDDLEWARE_PRIORITY.POINT_CONSUMPTION,
        name: MIDDLEWARE_NAMES.POINT_CONSUMPTION,
    },
    {
        middleware: summarizationMiddleware({ model, trigger: [{ tokens: triggerTokens }] }),
        priority: MIDDLEWARE_PRIORITY.SUMMARIZATION,
        name: MIDDLEWARE_NAMES.SUMMARIZATION,
    },
    {
        middleware: safetyTrimMiddleware({ model, maxTokens: Math.floor(contextWindow * 0.8) }),
        priority: MIDDLEWARE_PRIORITY.SAFETY_TRIM,
        name: MIDDLEWARE_NAMES.SAFETY_TRIM,
    },
    {
        middleware: reviewResultPersistenceMiddleware({ reviewId, sessionId }),
        priority: MIDDLEWARE_PRIORITY.RESULT_PERSISTENCE,  // 90，末位
        name: MIDDLEWARE_NAMES.REVIEW_RESULT_PERSISTENCE,  // 本 spec §5.3 新增常量
    },
])

// 直接传给 createAgent
createAgent({ model, tools: [parseAndAskStance], systemPrompt, responseFormat: riskSchema, middleware })
```

**前置接口扩展**（合同审查 M3 自行完成；不依赖文书生成 M3）：

1. `server/services/workflow/utils/promptRenderer.ts` 的 `PromptRenderContext` 接口加 optional 字段（`reviewId` / `contractType`），并在 `renderSystemPrompt` body 里写入 `variables` 字典。变量名全英文标识符兼容 `renderContent` 的 `\w+` 正则
2. `server/services/workflow/tools/types.ts` 的 `ToolContext` 接口加 optional `reviewId` 字段（用于 parseAndAskStance 工具内部按需查 DB）
3. `server/services/workflow/middleware/types.ts` 的 `MIDDLEWARE_NAMES` 追加 `REVIEW_RESULT_PERSISTENCE = 'reviewResultPersistence'` 常量（不改既有 `RESULT_PERSISTENCE` 常量）
4. `server/services/workflow/middleware/index.ts` 追加 `export * from './reviewResultPersistence.middleware'`

**复用不新建**：`getToolInstancesService` / `createChatModel` / `renderSystemPrompt` / `getCheckpointer` / `getStore` / `summarizationMiddleware` / `safetyTrimMiddleware` / `pointConsumptionMiddleware` / `buildMiddlewareStack` 全部沿用，不新建任何工厂函数。

### 6.3 responseFormat 动态构造（新增模块）

```typescript
// server/services/assistant/contract/riskSchema.builder.ts
import { z } from 'zod'

const RISK_LEVEL = ['high', 'medium', 'low'] as const

/**
 * 合同审查专属 Zod schema。
 *
 * - high/medium 级别 Risk 强制 suggestedClauseText（通过 refine）
 * - low 级别可省略（减少 token 消耗）
 * - schema 形状固定（不依赖模板）；导出常量复用给 API PATCH 校验
 */
const RiskShape = z.object({
    id: z.string().describe('UUID，前端渲染 key'),
    clauseIndex: z.number().int().nonnegative().describe('段落索引（0-based）'),
    clauseText: z.string().describe('原文段落全文'),
    level: z.enum(RISK_LEVEL).describe('风险级别'),
    category: z.string().describe('付款 / 交付 / 违约 / 保密 / 知识产权 / 争议解决 / 其他'),
    problem: z.string().describe('问题简述'),
    legalBasis: z.string().optional().describe('《民法典》第 XXX 条等'),
    analysis: z.string().describe('条款分析'),
    risk: z.string().describe('对当前立场方的法律风险'),
    suggestion: z.string().describe('修改建议（文字描述）'),
    suggestedClauseText: z.string().optional().describe('AI 重写后的完整条款（high/medium 必填）'),
}).refine(
    r => r.level === 'low' || !!r.suggestedClauseText,
    { message: 'high/medium 级别必须提供 suggestedClauseText', path: ['suggestedClauseText'] },
)

export function buildRiskSchema() {
    return z.object({
        risks: z.array(RiskShape).describe('风险点清单，按 clauseIndex 升序'),
        summary: z.string().describe('审查摘要 Markdown'),
    })
}

export const RISK_SHAPE = RiskShape  // 供 API PATCH 校验复用
```

**批注文本首行格式规则**：`commentInjector` 在组装批注内容时，第一行固定格式 `[<level 中文>] <category>`（level 中文映射：high→高风险 / medium→中风险 / low→低风险）。该规则与 §10.2 五模块批注格式对齐；避免实现时首行遗漏。

### 6.4 新增工具：`parseAndAskStance`

```typescript
// server/services/workflow/tools/parseAndAskStance.tool.ts
import { tool } from '@langchain/core/tools'
import { interrupt } from '@langchain/langgraph'
import { z } from 'zod'
import { InterruptType } from '#shared/types/case'

const schema = z.object({
    // 无入参，agent 按 systemPrompt 指示调用
})

export const parseAndAskStanceTool = (context: ToolContext) => tool(
    async () => {
        const { reviewId } = context
        if (!reviewId) throw new Error('parseAndAskStance: reviewId 缺失')

        // Step A: 下载原合同 + 解析
        const review = await getContractReviewDAO(reviewId)
        const ossFile = await findOssFileByIdDao(review.originalFileId)
        if (!ossFile) throw new Error(`OSS file ${review.originalFileId} not found`)
        // 参考 server/services/material/docxRecognition.service.ts:119
        const docxBuffer = await downloadFileService(ossFile.filePath)
        const { paragraphs, contractType, partyA, partyB } = await parseContract(docxBuffer)
        //   parseContract = mammoth 提取段落 + partyDetector（正则 + LLM 兜底）

        // Step B: 更新 DB，置 awaiting_stance
        await updateContractReviewDAO(reviewId, {
            contractType,
            partyA,
            partyB,
            status: 'awaiting_stance',
        })

        // Step C: interrupt 请求立场 + 允许用户编辑甲乙方
        const resumed = interrupt({
            type: InterruptType.AWAITING_STANCE,
            reviewId,
            partyA, partyB, contractType,
        }) as { stance: 'partyA' | 'partyB' | 'neutral', partyA?: string, partyB?: string }

        // Step D: 用户可能编辑过甲乙方名称，回写 DB
        const finalPartyA = resumed.partyA ?? partyA
        const finalPartyB = resumed.partyB ?? partyB
        await updateContractReviewDAO(reviewId, {
            stance: resumed.stance,
            partyA: finalPartyA,
            partyB: finalPartyB,
            status: 'reviewing',
        })

        // Step E: 返回给 agent，供后续 model 调用生成 risks
        return {
            stance: resumed.stance,
            stanceLabel: STANCE_LABELS[resumed.stance],
            stanceFocus: STANCE_FOCUS_TABLE[resumed.stance],
            partyA: finalPartyA,
            partyB: finalPartyB,
            contractType,
            paragraphs,  // 完整段落数组（带 index）
        }
    },
    {
        name: 'parseAndAskStance',
        description: '解析合同段落、识别甲乙方与合同类型、通过 interrupt 请求用户立场。返回立场相关的审查上下文。**此工具无需任何参数，直接调用即可**。一次会话只应调用一次。',
        schema,
    },
)
```

**工具注册**：在 `server/services/workflow/tools/index.ts` 的 `toolModules` 字典新增 `parseAndAskStance` 入口（参考现有 `searchCaseMaterials` 注册方式）。

**STANCE 常量表**（代码内置，不进 DB，对齐父 spec §6.6）：

```typescript
const STANCE_LABELS = { partyA: '甲方', partyB: '乙方', neutral: '中立' } as const
const STANCE_FOCUS_TABLE = {
    partyA: '延长付款期限、缩短交付、减少己方违约责任、增加对方违约成本、选择己方管辖地',
    partyB: '缩短付款周期、增加预付款、明确逾期违约金、放宽己方交付期限、减少己方违约责任',
    neutral: '识别所有可能产生歧义或权利义务不对等的条款，不偏向任何一方',
} as const
```

### 6.5 持久化中间件：`reviewResultPersistenceMiddleware`（新增）

**⚠️ PoC 前置**：与文书生成 spec §6.6 共用同一 PoC 结论 —— `state.structuredResponse` 在 `afterAgent` 钩子的可见性。M3 启动前：
- 若文书生成 M3 已做 PoC 且通过，本模块直接使用
- 若未做，合同审查 M3 自己做一个最小验证（mock 一个 responseFormat=`z.object({ x: z.string() })` 的 agent + afterAgent 中间件打印 state.structuredResponse）

**回退方案**：若 `state.structuredResponse` 不可见，改为从 `state.messages.at(-1).additional_kwargs.parsed` 或消息 content 里 parse JSON；失败则置 `status='failed'` 并记告警日志。

仿 `analysisResultPersistence.middleware.ts` 的 `{ hook: async (state) => {...} }` API 形状：

```typescript
// server/services/workflow/middleware/reviewResultPersistence.middleware.ts
import { createMiddleware } from 'langchain'
import { z } from 'zod'
import {
    updateContractReviewDAO,
    getContractReviewDAO,
} from '../../assistant/contract/contractReview.dao'
import { injectCommentsIntoDocx } from '../../assistant/contract/docx/commentInjector'
import { uploadFileService, downloadFileService } from '../../storage/storage.service'
import { getDefaultStorageConfigDao } from '../../storage/storageConfig.dao'
import { createOssFileDao, findOssFileByIdDao } from '../../files/ossFiles.dao'
import { FileSource, OssFileStatus } from '#shared/types/file'
import { StorageProviderType } from '~~/server/lib/storage/types'

interface ReviewResultPersistenceOptions {
    reviewId: number
    sessionId: string
}

export const reviewResultPersistenceMiddleware = (
    options: ReviewResultPersistenceOptions,
) => createMiddleware({
    name: 'ReviewResultPersistenceMiddleware',
    beforeAgent: {
        hook: async (_state: any) => {
            await updateContractReviewDAO(options.reviewId, { status: 'reviewing' })
        },
    },
    afterAgent: {
        hook: async (state: any) => {
            const structured = state.structuredResponse as
                | { risks: any[]; summary: string }
                | undefined
            if (!structured) {
                // risks 保留为 null，前端可据此显示"AI 输出异常，请重新发起审查"
                await updateContractReviewDAO(options.reviewId, { status: 'failed' })
                logger.warn('reviewResultPersistence: structuredResponse 缺失', {
                    reviewId: options.reviewId,
                })
                return
            }

            // Step 1: 写 risks/summary（失败态可 rebuild 恢复的前提）
            await updateContractReviewDAO(options.reviewId, {
                risks: structured.risks,
                summary: structured.summary,
            })

            // Step 2: 注入批注 + 两步写 OSS（严格对齐 uploadWorkspaceFile.tool.ts L196-212）
            try {
                const review = await getContractReviewDAO(options.reviewId)
                const originalOssFile = await findOssFileByIdDao(review.originalFileId)
                if (!originalOssFile) throw new Error(`original oss file ${review.originalFileId} not found`)

                const originalBuffer = await downloadFileService(originalOssFile.filePath)
                const reviewedBuffer = await injectCommentsIntoDocx(originalBuffer, structured.risks)

                // 上传新 .docx
                const ossPath = `users/${review.userId}/contract-review/reviewed-${options.reviewId}-${Date.now()}.docx`
                const uploadResult = await uploadFileService(ossPath, reviewedBuffer, {
                    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    userId: review.userId,
                })

                // 查默认存储配置拿 bucket name（与 uploadWorkspaceFile 一致）
                const storageConfig = await getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS, review.userId)
                const bucketName = storageConfig?.bucket ?? ''

                // 写 ossFiles 记录拿 id（plain 字段，无 Prisma nested connect）
                const ossFileRow = await createOssFileDao({
                    userId: review.userId,
                    bucketName,
                    fileName: `reviewed-${options.reviewId}.docx`,
                    filePath: uploadResult.name,  // storage 返回的 path
                    fileSize: reviewedBuffer.length,
                    fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    source: FileSource.CASE_ANALYSIS,  // 暂复用此 source；若 FileSource 枚举需新增值由 M3 决定
                    status: OssFileStatus.UPLOADED,
                    encrypted: false,
                })
                await updateContractReviewDAO(options.reviewId, {
                    reviewedFileId: ossFileRow.id,
                    status: 'completed',
                })
            } catch (err) {
                logger.error('reviewResultPersistence: 批注注入失败', { reviewId: options.reviewId, err })
                // risks/summary 已写库，但批注未生成：置 failed 且保留 risks，用户可通过 rebuild-docx 重试
                await updateContractReviewDAO(options.reviewId, { status: 'failed' })
            }
        },
    },
})
```

> **实施对照**：上述代码严格对齐 `server/services/workflow/tools/uploadWorkspaceFile.tool.ts` L196-212 的实际写法。关键字段：`createOssFileDao` 入参是 plain 字段（**非 Prisma nested `{ user: { connect } }` 写法**），包含 `userId / bucketName / fileName / filePath / fileSize / fileType / source / status / encrypted`。`downloadFileService(ossFile.filePath)` 只传 path 一个参数即可（详见 `server/services/material/docxRecognition.service.ts:119`）。`FileSource` 枚举若需新增 `CONTRACT_REVIEW` 值作为独立 source，由 M3 启动时决定；本期可先复用 `CASE_ANALYSIS`。

**关键点**：

- `beforeAgent` / `afterAgent` 都是 `{ hook: async (state) => {...} }` 对象形式（与 `analysisResultPersistenceMiddleware` 一致）
- `state` 是 positional arg，类型 `any`
- 批注注入失败不阻塞 risks/summary 写库；用户可通过"重新生成批注 Word"按钮手动重试
- 中间件**位置**必须末位（summarization / safetyTrim 之后）

### 6.6 运行入口

```typescript
// server/services/workflow/agents/contractReviewMainAgent.ts
export async function runContractReviewChat(
    sessionId: string,
    options: { userId: number; signal?: AbortSignal; command?: unknown },
): Promise<ReadableStream<Uint8Array>> {
    // 1. 反查 review（contractReviews.sessionId unique index）
    const review = await findContractReviewBySessionIdDao(sessionId)
    if (!review) throw new Error(`No contract review found for session ${sessionId}`)

    // 2. 仿 runDocumentChat：并发加载 checkpointer/store/nodeConfig(contractReviewMain)/model
    // 3. 组装工具：toolContext = { userId: options.userId, reviewId: review.id, sessionId }
    // 4. 构造 middleware 数组（见 §6.2）
    // 5. riskSchema = buildRiskSchema()
    // 6. createAgent({ model, tools: [parseAndAskStance], systemPrompt, responseFormat: riskSchema, middleware })
    // 7. 若 options.command 存在：input = new Command({ resume: options.command }) ；否则 input = { messages: [...] }
    // 8. 返回 agent.stream(input, { configurable: { thread_id: sessionId, checkpointer, store }, signal: options.signal })
}
```

**Worker 分流**：`server/services/agent/agentWorker.ts` L164+ 有现有的 scope 分流 if-else 链（当前首支是 `if (scope === 'assistant')` + 末支 `else { /* case 域 */ }`）。**在现有链中加一个 `else if` 分支**（不要改动既有分支顺序）：

```typescript
// 在 `if (session.scope === 'assistant') { ... }` 之后、`else { /* case 域 */ }` 之前插入：
else if (session.scope === 'contract') {
    const { runContractReviewChat } = await import('../workflow/agents/contractReviewMainAgent')
    stream = await runContractReviewChat(run.sessionId, {
        userId: session.userId!,
        signal: abortController.signal,
        command: run.input?.command,  // resume payload 透传
    })
}
// 若文书生成 M3 已完成同样加入 `else if (session.scope === 'document')` 分支
```

**非 handler map 注入**；`AgentRunInput` 类型零改动（已支持 `command` 字段透传）。

### 6.7 提示词 `contractReview_system` v1

**设计原则**：立场（stance / stanceLabel / stanceFocus）从 `parseAndAskStance` 工具返回值承接（message 历史里自然可见），**不在 systemPrompt 里做变量注入**。systemPrompt 只含恒定元信息。

```text
你是 LexSeek 的合同审查助手。用户上传了一份合同，你按下面的流程审查：

# 任务流程
1. 调用 parseAndAskStance 工具：工具会解析合同、识别甲乙方、请求用户审查立场。该工具会 interrupt 暂停等待用户输入。
2. 工具返回后，你会得到以下字段（在 ToolMessage 里）：
   - stance / stanceLabel：用户选定的立场
   - stanceFocus：立场审查重点（按 SKILL.md 原始协议；neutral 立场是官方扩展，标准为"识别所有可能产生歧义或权利义务不对等的条款，不偏向任何一方"）
   - partyA / partyB / contractType：合同基础信息
   - paragraphs：完整段落数组（带 index）
3. 按 stance / stanceFocus 逐段审查合同，按响应格式（response schema）输出结构化结果（risks + summary）。

# 审查要求
- 逐段审查所有对当前立场方不利 / 权利义务不对等 / 存在法律风险的条款
- 每处问题输出一条 Risk，字段见 response schema 中的 description
- high / medium 级别 Risk **必须**额外提供 suggestedClauseText（AI 重写后的完整条款）
- 使用专业法律术语，禁用感叹号
- 引用具体法条（《民法典》《劳动合同法》《合同法》等及条号）
- 宁可多标，不可漏标
- summary 以 Markdown 简要说明合同整体风险画像、主要问题集中领域、建议行动顺序

# 当前元信息（systemPrompt 变量注入）
- reviewId：{{reviewId}}
- 合同类型（若已识别）：{{contractType}}

# 段落引用规则
- clauseIndex 从工具返回的 paragraphs 数组索引取值（0-based）
- clauseText 必须是 paragraphs 中对应段落的完整文本
- 禁止编造段落
```

> 若某一轮 systemPrompt 渲染时 `contractType` 还未从工具获得（首轮），`renderContent` 对未定义变量保留 `{{contractType}}` 字面值；AI 会在工具返回后的轮次从 ToolMessage 自然获取准确值，不靠提示词二次渲染。

### 6.8 复用清单（实施必读）

实施 M3 时**禁止**新建以下组件的替代实现，全部复用现有路径：

| 要做的事 | 现有文件 / 函数 |
|---|---|
| 构造 agent 骨架 | 仿 `server/services/workflow/agents/caseMainAgent.ts`（`runCaseChat` 骨架） |
| 加载节点配置 | `getValidNodeConfig` / `getNodeConfigsByTypes`（`server/services/node/node.service.ts`） |
| 构造模型实例 | `createChatModel`（`server/services/node/chatModelFactory.ts`） |
| 渲染系统提示词 | `renderSystemPrompt`（`server/services/workflow/utils/promptRenderer.ts`；扩展 `PromptRenderContext` 加 `reviewId` / `contractType` 两字段） |
| 工具按名加载 | `getToolInstancesService`（`server/services/workflow/tools/index.ts`）；工具注册表 `toolModules` 新增 `parseAndAskStance` |
| 中间件声明式优先级排序 | `buildMiddlewareStack` + `MIDDLEWARE_PRIORITY` + `MIDDLEWARE_NAMES`（`server/services/workflow/middleware/types.ts`）；`MIDDLEWARE_NAMES` 追加 `REVIEW_RESULT_PERSISTENCE`，`middleware/index.ts` 追加 export |
| checkpointer / store | `getCheckpointer` / `getStore`（`server/services/workflow/checkpointer.ts`） |
| 积分扣减 | `pointConsumptionMiddleware(userId, 'contract_review_token', sessionId)`（`server/services/workflow/middleware/pointConsumption.middleware.ts`） |
| 结果持久化 | 仿 `server/services/workflow/middleware/analysisResultPersistence.middleware.ts` 实现 `reviewResultPersistence.middleware.ts` |
| SSE 推送 | `createAgentSseStream`（`server/services/sse/agentSseStream.ts`） |
| Run 入队 + resume | `enqueueRunService`（`server/services/agent/agentRun.service.ts`）；input 含 `command: { stance, partyA, partyB }` 时转 `Command({ resume })` |
| Worker 分发 | `AgentWorker.executeRun`（`server/services/agent/agentWorker.ts:164+`）加 `scope==='contract'` if 分支，非 map 注入 |
| OSS 上传 | `uploadFileService`（`server/services/storage/storage.service.ts`）+ `createOssFileDao`（`server/services/files/ossFiles.dao.ts`）两步组合；`createOssFileDao` 入参为 **plain 字段 `{ userId, bucketName, fileName, filePath, fileSize, fileType, source, status, encrypted }`**，无 Prisma nested connect；bucketName 需先调 `getDefaultStorageConfigDao` 获取；严格对齐范例 `server/services/workflow/tools/uploadWorkspaceFile.tool.ts` L196-212 |
| OSS 下载 | `findOssFileByIdDao(id)` 取 row → `downloadFileService(row.filePath)` 单参数调用（ossFiles 表字段名是 `filePath`，不是 `path`；不用 `configId` 参数，参考 `server/services/material/docxRecognition.service.ts:119`） |
| OSS 签名 URL | `generateOssDownloadSignaturesService`（`server/services/files/files.service.ts`） |
| .docx parser buffer 下载复用 | `server/services/material/docxRecognition.service.ts` 有 mammoth 做 docx → markdown 的样例，可抽共用 helper（段落提取业务不同，本 spec 的 `parser.ts` 仍需独立实现） |
| 前端流管理 | `useStreamChat`（`app/composables/useStreamChat.ts`）；`useContractReview` 仿 `useAssistantChat` / `useDocumentDraft`（若文书生成已产出） |
| 前端文件上传 | `AiPromptInput`（`app/components/ai/AiPromptInput.vue`，721 行，含拖拽/进度/识别/查重/OSS 签名/预览）；**严禁重做上传 UI** |
| 前端消息渲染 | `AiChat` / `AiMessageList` / `AiToolRenderer`；`parseAndAskStance` 工具调用可挂一个自定义渲染器在 `app/components/ai/tools/` 下 |

---

## 7. 输入与 docx 处理

### 7.1 输入源（MVP）

| sourceType | 字段 | 处理流程 |
|---|---|---|
| `upload` | `ossFileId: number` | 校验归属当前用户 + MIME=.docx + 大小 ≤ 20MB；直接使用 |
| `paste` | `text: string` | 调 `textToDocxService(text)` 生成最小 .docx（单段落纯文本，mammoth 可解）→ 上传 OSS → 获得 ossFileId |

MVP 不含 `case_material` 源（案件页复用延后）。

### 7.2 docx 子模块

`server/services/assistant/contract/docx/`：

```
docx/
├── parser.ts           # mammoth 提取段落数组；返回 { paragraphs: string[], rawXml: string }
├── partyDetector.ts    # 正则 + LLM 兜底识别甲乙方 + 合同类型
├── commentInjector.ts  # jszip 读原 .docx → 改 word/document.xml + 新建 word/comments.xml + 更新 [Content_Types] 与 _rels → 导出 Buffer
├── zipRewriter.ts      # 底层：在 JSZip 上操作目标文件，封装 readText/writeText 便于单测
└── index.ts
```

**复用既有 docx 能力**：`server/services/material/docxRecognition.service.ts` 已用 mammoth 做 docx → markdown。本期 `parser.ts` 的"段落数组提取"业务形态不同（需要带 index 的原文 `string[]`），不直接复用其函数，但可抽共用 helper（如 docx Buffer 合法性校验、mammoth 初始化参数）减少重复。具体复用点 M2 启动时由工程判断，严禁平行造相同的 mammoth 包装。

### 7.3 partyDetector 实施要点

- 正则路径：按常见模式匹配（`甲方[：:]\s*(.+?)[\n。；]` / `乙方[：:]\s*(.+?)[\n。；]`）
- LLM 兜底：正则未命中时，把前 1500 字符发给 model（复用 `contractReviewMain.modelId`）按 JSON 返回 `{ partyA, partyB, contractType }`
- 两者都失败时：`partyA`/`partyB`/`contractType` 置 null；StanceSelectionDialog 前端兜底（空 Input + 占位"甲方"/"乙方"）

### 7.4 textToDocxService

`server/services/assistant/contract/textToDocx.service.ts`：

- 用 `docx` 或 `jszip` 构造最小合规 .docx（一个段落即可，因为后续 mammoth 会重新 parse）
- 若项目未装 `docx` 库，直接用 jszip 手动构造（spec 模板字符串 + 转义处理）
- 文件命名：`pasted-contract-{userId}-{timestamp}.docx`

---

## 8. API 契约

沿用父 spec §6.8，本文档裁剪 MVP + 新增两端点。**所有响应必须走 `resSuccess(event, message, data)` / `resError(event, code, message)` 封包**（`.claude/rules/api.md`），HTTP 状态码恒为 200，错误码在响应 JSON 的 `code` 字段。下文 `resp` 仅列 `data` 字段形状，实际 wire 格式为 `{ code: 200, message: '...', data: {...} }`。

> **前端调用陷阱**：`app/composables/useApiFetch` 已内置"自动提取 `response.data` 字段"的处理，前端代码应直接用 `response.downloadUrl` / `response.reviewId`，**不要写 `response.data.downloadUrl`**（这是项目里反复踩过的坑，写成后者 TypeScript 不报错但实际拿到 undefined）。

### 8.1 创建与查询

```
POST /api/v1/assistant/contract/reviews
  body: CreateReviewRequest
  data: CreateReviewResponse  // { reviewId, sessionId }

GET /api/v1/assistant/contract/reviews/:id
  data: {
    review: {
      id, status, contractType, partyA, partyB, stance,
      risks, summary, originalFileId, reviewedFileId,
      createdAt, updatedAt,
    }
  }
```

**POST 同步性**：立即返回 `{ reviewId, sessionId }`，不等 agent 结果；`paste` 源同步等待 text→docx 完成（<1s），agent 后续异步。前端通过 SSE `runStatus` 感知。

> **MVP 不交付** `GET /reviews?page=&pageSize=[&caseId=]` 列表端点（§1.2 / §2 差异摘要已说明，延后至 M6+）。

### 8.2 立场提交

```
POST /api/v1/assistant/contract/reviews/:id/stance
  body: StanceRequest   // { stance, partyA?, partyB? }
  data: { runId: string }
```

**实现**（沿用父 spec §6.5.1 但扩展 payload）：

```typescript
// server/api/v1/assistant/contract/reviews/[id]/stance.post.ts
import { enqueueRunService } from '~~/server/services/agent/agentRun.service'

export default defineEventHandler(async (event) => {
    const reviewId = Number(getRouterParam(event, 'id'))
    const { stance, partyA, partyB } = await readBody(event)
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const review = await getContractReviewDAO(reviewId)
    if (!review || review.userId !== user.id) return resError(event, 403, '无权操作')

    // 幂等：重复点击已不处于 awaiting_stance 的 review 直接返回
    if (review.status !== 'awaiting_stance') {
        return resSuccess(event, '立场已提交（状态：' + review.status + '）', { reviewId })
    }

    const result = await enqueueRunService({
        sessionId: review.sessionId,
        threadId: review.sessionId,
        userId: user.id,
        caseId: null,
        input: {
            message: undefined,
            command: { stance, partyA, partyB },  // 透传给 parseAndAskStance 的 interrupt resume
        },
    })
    if ('error' in result) return resError(event, 429, result.error)

    return resSuccess(event, '立场已提交，审查继续', { reviewId, runId: result.runId })
})
```

### 8.3 用户编辑 risks

```
PATCH /api/v1/assistant/contract/reviews/:id
  body: PatchReviewRequest   // { risks: Risk[] }，不含 summary
  data: { reviewId: number }
```

**约束**：

- `review.status` 必须是 `completed`；其他状态（pending / reviewing / awaiting_stance / failed / rebuilding）返回 `resError(event, 409, '...')`
- `risks` 全量替换；后端用 `z.array(RISK_SHAPE)` 校验结构，失败 400
- **不接受 `summary` 字段**（UI 无 summary 编辑入口；YAGNI）
- 不触发批注重生（需用户显式调 rebuild-docx）

### 8.4 重新生成批注 Word

```
POST /api/v1/assistant/contract/reviews/:id/rebuild-docx
  data: RebuildDocxResponse  // { reviewedFileId, downloadUrl }
```

**实现**：

1. 校验 status=completed
2. 原子占位：`UPDATE contract_reviews SET status='rebuilding' WHERE id=? AND status='completed' RETURNING id`；影响行数 0 → 并发中，返回 `resError(event, 429, '批注正在重新生成中，请稍候')`
3. 读最新 `review.risks`
4. 下载 originalFileId（`findOssFileByIdDao` → `downloadFileService(ossFile.filePath)`）→ commentInjector 注入 → `uploadFileService` + `createOssFileDao`（plain 字段，参考 §6.5 的完整写法）写新 ossFile → `update contractReviews set reviewedFileId=?, status='completed'`
5. 失败：`update contractReviews set status='completed'`（回滚占位），返回 500
6. 成功：返回新 ossFileId + `generateOssDownloadSignaturesService` 生成的 1 小时签名 URL

**`rebuilding` 是 DB 层临时态**，不进 §5.1 状态机主图（内部占位，正常流程 <10s）。前端 GET 看到 `rebuilding` 显示"批注正在重新生成"toast，禁用编辑按钮。

### 8.5 下载

```
GET /api/v1/assistant/contract/reviews/:id/download
  data: DownloadResponse  // { downloadUrl }
```

**实现**：校验 review 归属 + status ∈ {completed, exported}，调 `generateOssDownloadSignaturesService({ ossFileIds: [review.reviewedFileId] })` 取签名 URL 返回给前端；前端拿到后 `window.open(downloadUrl)` 或 `<a :href download>`。

> **不使用 302 重定向**：对齐项目 `.claude/rules/api.md` 的"API 永远返回 200 + 封装"规则，改为返回 `data.downloadUrl` 由前端处理下载。

---

## 9. UI 实现

### 9.1 路由与页面

| 路径 | 页面 | 权限 |
|---|---|---|
| `/dashboard/assistant/contract` | 合同审查主页 | 登录用户 |

**案件页复用** 延后迭代（见 §1.2 "不在本次范围"；父 spec §6.10 的 `<ContractReviewPanel :case-id>` 方案届时一并实现）。

### 9.2 组件划分

所有组件文件位于 `app/components/assistant/contract/`：

```
app/components/assistant/contract/
├── ContractReviewPanel.vue            # 主组件（含 runStatus 旋转文案，MVP 内联，不单独拆 ContractReviewStatus.vue）
├── ContractSourceInput.vue            # 提交屏：paste / upload（复用 AiPromptInput，严禁重做上传 UI）
├── StanceSelectionDialog.vue          # 立场选择对话框（甲乙方可编辑）
├── RiskListPanel.vue                  # 右侧风险清单侧栏（含风险 CRUD + 重生/下载按钮）
├── RiskClauseDiff.vue                 # 单条风险展开：原文 vs suggestedClauseText 的 diff（diff-match-patch 渲染）
└── ContractDocxPreview.vue            # docx-preview 左侧合同全文 + 批注浮层
```

共 6 个组件（MVP 砍原 `ContractReviewStatus.vue`，runStatus 文案内联进 `ContractReviewPanel`；未来若要接 `AiToolRenderer` 展示工具调用时再抽出独立组件）。

**组件只负责渲染**，数据流集中在 `useContractReview` composable（仿 `useDocumentDraft`）：

```typescript
// app/composables/useContractReview.ts
export function useContractReview(reviewId: Ref<number | null>) {
    const stream = useStreamChat({
        apiUrl: '/api/v1/assistant/contract/chat',
        threadId: /* from review.sessionId */,
    })
    const review = ref<ContractReview | null>(null)
    const interruptData = ref<{ partyA: string, partyB: string, contractType: string } | null>(null)

    // 监听 SSE interrupt 事件 → 填充 interruptData → 拉起 StanceSelectionDialog
    watch(() => stream.interruptData.value, (data) => {
        if (data?.type === 'awaiting_stance') {
            interruptData.value = data
        }
    })

    return {
        review,
        runStatus: stream.runStatus,
        interruptData,
        onSubmit: (payload: CreateReviewPayload) => /* ... */,
        onStance: (payload: StancePayload) => /* POST /stance + resume stream */,
        onEditRisks: debounce(patchRisks, 500),
        onRebuildDocx: () => /* POST /rebuild-docx */,
        onDownload: () => /* GET /download */,
    }
}
```

### 9.3 三屏交互布局（对齐父 spec §6.9）

**Step 1 提交屏**：居中单栏；`ContractSourceInput` + "开始审查"按钮。

**Step 2 立场 Dialog**（模态）：

```
┌─────────────────────────────────────┐
│  已识别合同类型：劳动合同              │
│  甲方名称：[某某科技有限公司     ]   ← 可编辑 Input
│  乙方名称：[张三（个人）         ]   ← 可编辑 Input
│                                     │
│  请问您代表哪一方进行审查？           │
│  [○ 甲方]  [○ 乙方]  [○ 中立]        │
│           [取消]   [确认]            │
└─────────────────────────────────────┘
```

- 识别失败（partyA/partyB 为 null）→ Input 空白，placeholder="请填写甲方名称"
- 用户必须选立场才能点击"确认"；甲乙方为空允许（AI 仍可按立场审查，但批注里甲乙方填"甲方/乙方"占位）

**Step 3 结果屏**（左右双栏）：

```
┌────────────────────┐  ┌────────────────────┐
│ 合同全文            │  │ 风险清单            │
│ (docx-preview)     │  │ [高] 付款条件       │
│                    │  │   展开：[查看改写] │
│                    │  │   diff 前后对照     │
│ 批注浮层            │  │   [编辑] [删除]    │
│ （点击段落底纹弹框）│  │ [中] 保密条款       │
│                    │  │ ...                 │
│                    │  │ [+ 新增风险]        │
│                    │  │                     │
│                    │  │ [重新生成批注 Word] │
│                    │  │ [下载 Word]         │
└────────────────────┘  └────────────────────┘
```

- "下载 Word"：调 `GET /reviews/:id/download` 拿到 `data.downloadUrl`（项目规约恒返回 200，不用 302），前端 `window.open(downloadUrl)` 或 `<a :href download>` 触发浏览器下载
- "重新生成批注 Word"：只在用户编辑过 risks 且未重生过 docx 时高亮；调 `/rebuild-docx` 后自动打开新文件的 downloadUrl
- "新增风险"按钮：弹出空白 Risk 表单（clauseIndex 由用户从下拉选原文段落）
- 批注浮层：点击合同段落的批注标记弹出浮层，显示对应 Risk 内容 + [编辑] / [删除] 按钮
- **rebuilding 态禁用编辑**：前端 GET `/reviews/:id` 若 `status='rebuilding'`，禁用风险清单编辑按钮 + 显示"批注正在重新生成..."toast（避免 PATCH 并发被 409 打断用户输入）

---

## 10. 批注注入实现要点

对齐父 spec §6.7 XML 协议（python-docx 版在 SKILL.md 第 262-402 行），Node.js 实现：

### 10.1 三处 XML 改动

**1. `word/document.xml`**：每个目标段落插入三元素

```xml
<w:p>
  <w:commentRangeStart w:id="0"/>
  ...（原段落 runs 不变）
  <w:commentRangeEnd w:id="0"/>
  <w:r><w:commentReference w:id="0"/></w:r>
</w:p>
```

**2. 新建 `word/comments.xml`**（整文件）：

- 命名空间 `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`
- 每条批注：`<w:comment w:id="N" w:author="LexSeek 审查助手" w:date="<ISO8601>">...段落结构...</w:comment>`
- 批注内容段落结构：`<w:p><w:r><w:t xml:space="preserve">...</w:t></w:r></w:p>`

**3. `[Content_Types].xml`** 追加：

```xml
<Override PartName="/word/comments.xml"
          ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
```

**4. `word/_rels/document.xml.rels`** 追加：

```xml
<Relationship Id="rIdComments"
              Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments"
              Target="comments.xml"/>
```

### 10.2 批注内容文本格式（五模块，MVP 已砍谈判策略）

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
```

**格式规则**：

- 首行固定 `[<level 中文>] <category>`（level 映射：high→高风险 / medium→中风险 / low→低风险）
- 其后四段：法律依据 / 条款分析 / 法律风险 / 修改建议
- `legalBasis` 为空时省略"【法律依据】"整段
- **MVP 不含"谈判策略"模块**（§2 差异摘要已说明：Risk.strategy 字段砍除，与 suggestion 重叠；后续按产品反馈决定是否恢复）

### 10.3 单测必含（M2）

- Microsoft Word 打开可见完整批注（人工验证，至少 1 次）
- WPS 打开不崩溃且批注可见（人工验证，至少 1 次）
- 同一 reviewId 重复执行两次，批注 id 不冲突（commentInjector 每次重新分配 id，从 0 开始）
- 批注内容含中文、英文、数字、括号、引号时正常显示
- 批注数量 ≥ 20 时 .docx 结构仍合法（unzip 可重新打包）

### 10.4 边界处理

- 段落 runs 切分：用 fast-xml-parser 读出 `<w:p>` 的完整节点，在 `<w:p>` 起始处插入 `<w:commentRangeStart>`，末尾插入 `<w:commentRangeEnd>` + `<w:commentReference>`，保持 runs 原样。不拆分 runs
- `clauseIndex` 与 mammoth 提取的 `paragraphs` 数组索引一一对应；commentInjector 根据 clauseIndex 定位第 N 个 `<w:p>`
- 空段落（仅 `<w:pPr>` 无 `<w:r>`）不加批注（避免 Word 报错）

---

## 11. 实施里程碑

**测试命令**：本 spec 所有单元 / 集成测试一律使用 `npx vitest run`（项目规范 `.claude/rules/commands.md`，**禁止 `bun test`**，因为 Nuxt 自动导入仅在 vitest 环境下可正确解析）。

| # | 里程碑 | 核心产出 | 可 demo 场面 | 依赖 |
|---|---|---|---|---|
| M1 | 数据层 + 依赖 + 样本 | **必装依赖**：`bun add fast-xml-parser diff-match-patch`；`docx-preview` 若 package.json 未有则 `bun add docx-preview`（与文书生成共用）；**已有依赖（无需装）**：`mammoth` / `jszip`；`contractReviews` migrate（**不含 caseId 列**，unique 索引）；`InterruptType.AWAITING_STANCE` 枚举扩展；新建 `shared/types/contract.ts`；`MIDDLEWARE_NAMES.REVIEW_RESULT_PERSISTENCE` 常量 + `middleware/index.ts` export；`seedContractReviewMainNode` / `seedContractReviewTokenRule` 写 seed；工程 AI 生成 5 份占位样本 .docx 入 `prisma/seeds/contract-samples/`；**向 `.claude/rules/git.md` scope 列表新增 `contract`** 条目（本 spec 全部 commit 统一使用此 scope） | `bun run prisma:migrate` + `bun prisma db seed` 跑完；样本可被 mammoth 解析 | — |
| M2 | docx 子模块 | `server/services/assistant/contract/docx/`：parser / partyDetector（正则+LLM）/ commentInjector（五模块批注格式）/ zipRewriter；`textToDocxService`；对 5 份样本跑单测（批注 ≥20 / 中文 / id 不冲突 / Word+WPS 人工验证；`npx vitest run`） | 5 份样本全通过单测；`commentInjector(sample, mockRisks[25])` 生成的 .docx 在 Word 打开批注完整 | M1 |
| M3 | AI 审查闭环 | **PoC 前置**：验证 `state.structuredResponse` 在 afterAgent 可见（与文书生成共用）；**接口扩展**：`PromptRenderContext` 加 `reviewId` / `contractType` 两字段、`ToolContext` 加 `reviewId`；`contractReviewMain` 节点 + 提示词 v1；`buildRiskSchema`（含 refine，无 strategy）；`parseAndAskStance` 工具（interrupt；OSS 下载用 `findOssFileByIdDao` + `downloadFileService`）；`reviewResultPersistenceMiddleware`（用 `buildMiddlewareStack` 挂载；OSS 上传用 `uploadFileService` + `createOssFileDao`）；`contractReviewMainAgent.ts` + `runContractReviewChat`；Worker 加 `scope='contract'` 分支；`contractReview.service/dao`；POST/GET `/reviews` + POST `/stance`（**GET list 端点本期不交付**）；`contract_review_token` seed + `pointConsumptionMiddleware` 接入；**必含测试**：mock commentInjector 抛错 → risks 已落库 + status=failed + rebuild-docx 可恢复；structuredResponse 缺失 → status=failed + risks=null（不可 rebuild） | curl：POST `/reviews` → SSE awaiting_stance interrupt → POST `/stance` → SSE completed → DB 有 risks + reviewedFileId | M1, M2 |
| M4 | 用户页 + P0 UI | `/dashboard/assistant/contract` 路由；`ContractReviewPanel` + 6 个子组件（`ContractSourceInput` / `StanceSelectionDialog` / `RiskListPanel` / `RiskClauseDiff` / `ContractDocxPreview` / 空白组件占位）；`useContractReview` composable；docx-preview 渲染；风险清单侧栏；下载批注 Word 按钮（`data.downloadUrl` 非 302） | 浏览器走通：提交 → 立场 Dialog → 审查完成 → 下载 Word；Word 打开批注完整 | M3 |
| M5 | diff + 编辑 + E2E | 条款级 diff 展开（diff-match-patch 段落对照）；PATCH `/reviews/:id`（**只收 risks**，校验 RISK_SHAPE）；POST `/reviews/:id/rebuild-docx`（原子 `status='rebuilding'` 占位 + 覆盖 reviewedFileId）；结果页编辑 UI（风险 CRUD）；E2E 全路径；`server/services/assistant/contract/` 覆盖率 ≥ 90% | 编辑 risks 后重生 Word，Microsoft Word 打开批注内容已更新；E2E CI 绿 | M4 |

**M6+（不在本 spec 范围，下一轮迭代按需启动）**：

- 案件详情页复用：`contractReviews.caseId` 列（ALTER TABLE 补）+ 索引 + `<ContractReviewPanel :case-id>`
- `GET /reviews?page=&pageSize=&caseId=` 列表端点（配合"我的合同审查历史"列表 UI）
- 24h 超时 cron（扫 awaiting_stance 置 failed）
- 导出 PDF / Markdown 审查报告（父 spec §6.9 UI 里的"导出报告"按钮）
- 多合同对比 / 合并审查
- 合同审查清单 / 经验库

---

## 12. 测试策略

### 12.1 单元 / 集成覆盖

| 里程碑 | 测试类型 | 必须覆盖 |
|---|---|---|
| M1 | 单元 | seed 幂等性；`InterruptType.AWAITING_STANCE` 枚举存在且被 `InterruptConfirmation.vue` 忽略（不误渲染） |
| M2 | 单元 + 集成 | 5 份样本：mammoth 提段落数量 > 5 且 < 500；partyDetector 正则命中率 ≥ 80%；LLM 兜底路径（mock model）返回合法 JSON；commentInjector 三 XML 改动正确；zipRewriter 重打包可被 mammoth 重读；textToDocxService 输出的 .docx 可被 mammoth 解析 |
| M3 | 单元 + 集成 | `buildRiskSchema` 对 high/medium 无 `suggestedClauseText` 校验失败；`parseAndAskStance` interrupt payload 结构正确；`reviewResultPersistence` before/after 两钩子写库行为；`runContractReviewChat` mock agent 跑通 happy path；`/stance` 端点幂等（重复点击不重复入队）；积分扣减触发 |
| M4 | 集成 | POST `/reviews` 两种 sourceType（upload / paste；case_material 不在 MVP）；GET `/reviews/:id` 权限（403 跨用户访问）；`/stance` 参数校验；download 返回 `data.downloadUrl`（非 302） |
| M5 | 集成 + E2E（chrome-devtools） | PATCH `/reviews/:id` 校验失败路径（含拒绝 summary 字段）；`/rebuild-docx` 并发原子占位；"提交 → 立场 → 审查 → 编辑 → 重生 → 下载"完整路径 |

### 12.2 覆盖率门槛

`server/services/assistant/contract/` 目录下的 service / dao / docx 子模块**必须 ≥ 90% 行覆盖**（对齐 `.claude/rules/testing.md` 项目规范），API 层每端点至少一例 happy path + 一例 4xx。所有测试命令一律 `npx vitest run`，不得使用 `bun test`。

### 12.3 E2E 必跑场景

- 粘贴文本场景：粘 1000 字借款合同 → AI 识别出借人/借款人 → 用户选出借人立场 → 生成风险清单 → 下载批注 Word → Word 打开批注完整
- 上传 .docx 场景：上传劳动合同 → AI 识别失败甲乙方 → StanceSelectionDialog 空白 Input → 用户手填甲乙方 → 选乙方立场 → 生成 → 编辑某条 Risk level → 重新生成批注 Word → 下载新文件

---

## 13. 风险清单与缓释

| # | 风险 | 缓释 |
|---|---|---|
| R1 | `state.structuredResponse` 在 afterAgent 钩子不可见 | M3 前 PoC 验证（与文书生成共用）；回退：从 `state.messages.at(-1)` parse JSON |
| R2 | responseFormat 强制 schema 导致 AI 输出失败率高（例如复杂条款无法 refine） | low 级别不强制 `suggestedClauseText`；提示词要求"无法判定则降为 low"；agent 循环自动重试 |
| R3 | partyDetector 正则 + LLM 都识别失败 | Dialog 空白 Input 兜底；用户手填 |
| R4 | 批注注入时 `clauseIndex` 越界（AI 生成了不存在的段落索引） | `commentInjector` 内部 safe guard：遇非法 clauseIndex 跳过该批注并记 warning；不抛错阻塞整个流程 |
| R5 | 用户编辑 risks 后 rebuild-docx 并发冲击 | DB 原子 `UPDATE ... RETURNING` 占位 `status='rebuilding'`；并发请求返回 429 |
| R6 | Word 跨 `<w:r>` 切分段落导致批注位置偏移 | commentInjector 只在 `<w:p>` 级别插入范围标记，不拆 runs，不受切分影响 |
| R7 | 合同 paste 文本过长（>100k 字符）爆 context | API 层限制 `text` ≤ 50k 字符；超出返回 `resError(event, 413, '...')` |
| R8 | AI 立场审查时 stance 传递失败（工具返回后 agent 忽略） | 工具返回 `stanceFocus` 进入 message 历史；summarization 中间件触发时须保留含 stance 的 ToolMessage（safetyTrim 的 `keepLast` 数量调大） |
| R9 | 批注注入成功但 OSS 上传失败 | reviewResultPersistence 内 try-catch：risks/summary 已写库，status=failed，用户可调 rebuild-docx 重试 |

---

## 14. 开放问题（不阻塞 M1 启动，但各里程碑前需定）

| # | 问题 | 责任方 | 截止 |
|---|---|---|---|
| O1 | `contract_review_token` 单价是否与 `assistant_token` 一致 | 运营 / 产品 | M3 启动前 |
| O2 | 风险清单默认排序：按 `clauseIndex` 升序 vs 按 `level` 降序 | 产品 | M4 启动前（本 spec 默认按 clauseIndex 升序） |
| O3 | 批注浮层交互：点击段落弹浮层 vs 仅右侧清单联动 | 产品 / UI | M4 启动前（本 spec 默认两者兼有） |

> 原 O4（Risk.strategy 保留与否）/ O5（批注六模块格式删减）已在本轮审查中决定：**Risk.strategy 砍除**、**批注改为五模块**，从开放问题列表移除。原 O6（5 份样本合同类型）由工程自决，不列入开放问题；建议类型：劳动 / 租赁 / 买卖 / 服务 / 借款。

---

## 15. Seed 与运维

### 15.1 开发环境 seed

`prisma/seed.ts` 新增两个函数：

```typescript
async function seedContractReviewMainNode(prisma: PrismaClient): Promise<void>
async function seedContractReviewTokenRule(prisma: PrismaClient): Promise<void>
```

均为幂等：节点 / 提示词 / 计费键 upsert by name / key。

**样本合同**不进 seed（仅作测试 fixture）。

### 15.2 新环境初始化

`prisma/seeds/seedData.sql` 同步补入：

- `nodes.contractReviewMain`
- `prompts.contractReview_system` v1
- `point_consumption_items.contract_review_token`

### 15.3 回滚 / Feature Flag

沿用父 spec §10.10 的三级关闭策略：

1. **前端层**：RBAC 角色路由表移除 `/dashboard/assistant/contract`
2. **节点层**：`UPDATE nodes SET status=0 WHERE name='contractReviewMain'`（后端新 run 直接拒绝）
3. **API 层**：前置中间件白名单暂停 `/api/v1/assistant/contract/**` 路径

已入队未完成的 run 会继续跑完，不影响用户当前会话。

---

## 16. 术语

| 术语 | 含义 |
|---|---|
| review | 一次合同审查操作的持久化记录（`contractReviews` 行） |
| stance | 用户审查立场：`partyA` / `partyB` / `neutral` |
| contractType | AI 识别的合同类型（劳动 / 租赁 / 买卖 / ...） |
| partyA / partyB | 甲方 / 乙方名称（可为 null 表示未识别） |
| Risk | 单条风险点，schema 见 §6.3 `RiskShape` |
| suggestedClauseText | AI 重写后的完整条款文本（high/medium 必有） |
| commentInjector | 把 `Risk[]` 注入 .docx 的 `word/comments.xml` 相关 XML 的模块 |
| contractReviewMain | 合同审查专用 agent 节点（本文档新增） |
| parseAndAskStance | 合同审查专用工具（本文档新增） |
| responseFormat | LangChain v1 `createAgent` 的结构化输出参数 |
| AWAITING_STANCE | 新增 InterruptType 值，对应立场选择中断 |

---

## 17. 参考

- 父 spec：[`2026-04-17-legal-assistant-design.md`](./2026-04-17-legal-assistant-design.md) §4.6, §6, §9.2
- 姐妹 spec（同架构模式）：[`2026-04-17-document-generation-design.md`](./2026-04-17-document-generation-design.md)
- LangChain v1 `createAgent` + `responseFormat`：https://docs.langchain.com/oss/javascript/langchain/agents
- LangChain interrupt + resume：https://docs.langchain.com/oss/javascript/langgraph/interrupt
- 批注 XML 协议（python-docx 版）：`~/Desktop/contract-review-assistant/SKILL.md` 第 262-402 行
- docxtemplater / pizzip（文书生成使用，合同审查不依赖）：https://docxtemplater.com/

---

**本 spec 冻结本次迭代范围。与父 spec §6 的任何冲突以本文档为准。实施前建议确认 §14 开放问题 O1（计费单价）；O2 / O3 可在对应里程碑启动前决定。**
