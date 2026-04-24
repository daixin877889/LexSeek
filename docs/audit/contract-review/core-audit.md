# 合同审查 M1-M5 核心链路审计报告

> 审计人：auditor-core（Task #1）
> 审计日期：2026-04-24
> 主 spec：`docs/superpowers/specs/2026-04-17-contract-review-design.md`

## 审查范围

| 文件 | 涉及 spec 章节 |
|---|---|
| `server/services/assistant/contract/contractReview.service.ts` | §4.1 创建阶段、§7.1 输入源、§8.1 |
| `server/services/assistant/contract/contractReview.dao.ts` | §5.1 状态机、§8.3 / §8.4 DAO |
| `server/services/assistant/contract/contractReviewRebuild.service.ts` | §8.4 rebuild-docx |
| `server/services/workflow/agents/contractReviewMainAgent.ts` | §4.2 / §6.2 / §6.6 / §6.7 |
| `server/services/workflow/middleware/reviewResultPersistence.middleware.ts` | §6.5 |
| `server/services/workflow/tools/parseAndAskStance.tool.ts` | §6.4 |
| `server/services/assistant/contract/analyzeSingleClause.ts` | §6.3（实际架构偏离） |
| `server/services/assistant/contract/riskSchema.builder.ts` | §6.3 |
| `server/api/v1/assistant/contract/reviews/index.get.ts` | §8.1（spec 原本不交付，已超前） |
| `server/api/v1/assistant/contract/reviews/[id].get.ts` | §8.1 |
| `server/api/v1/assistant/contract/reviews/[id].delete.ts` | spec 未定义 |
| `server/api/v1/assistant/contract/reviews/[id]/stance.post.ts` | §8.2 |
| `server/api/v1/assistant/contract/reviews/[id]/index.patch.ts` | §8.3 |
| `server/api/v1/assistant/contract/reviews/[id]/rebuild-docx.post.ts` | §8.4 |
| `server/api/v1/assistant/contract/reviews/[id]/download.get.ts` | §8.5 |
| `server/services/agent/agentWorker.ts:203-216` | §6.6 worker 分流 |
| `app/pages/dashboard/contract/[id].vue` | §9.1 路由 |
| `app/components/assistant/contract/ContractReviewPanel.vue` | §9.2 / §9.3 |
| `app/components/assistant/contract/StanceSelectionDialog.vue` | §9.3 Step 2 Dialog |
| `app/components/assistant/contract/RiskListPanel.vue`（节选） | §9.3 Step 3 风险清单 |
| `app/composables/useContractReview.ts` | §9.2 composable |

---

## 偏差清单

### [Critical] GET `/reviews/:id/download` 端点会全量重生批注 + 强制写库 + 无并发占位

- **spec 原文**: `2026-04-17-contract-review-design.md:881-889`
  > §8.5 下载: 校验 review 归属 + status ∈ {completed, exported}，**调 `generateOssDownloadSignaturesService({ ossFileIds: [review.reviewedFileId] })` 取签名 URL 返回**给前端
  > §8.4 重生: ... 原子占位：`UPDATE contract_reviews SET status='rebuilding' WHERE ... AND status='completed'`
- **当前实现**:
  - `server/api/v1/assistant/contract/reviews/[id]/download.get.ts:50-56`：每次 GET 直接 `await rebuildDocxService(review)`
  - `rebuildDocxService` 内部最后调用 `setCompletedAfterRebuildDAO(review.id, newOssFile.id)`（见 `contractReviewRebuild.service.ts:148`），强制覆盖 `reviewedFileId` + 把 `hasUnsavedDocxChanges` 置 false
  - 调用前没有 `atomicSetRebuildingDAO` 占位、调用后失败时也没有 `rollbackRebuildDAO`
- **偏差**:
  1. spec 要求 download 是 read-only：取出 reviewedFileId → 生成签名 URL；实现把它做成"每次下载都全量重 OCR + 重 LLM 注入 + 重新上传 OSS + 写库 setCompleted"。
  2. 没有 `atomicSetRebuildingDAO` 守护：两个客户端（甚至同一客户端连点两次"下载"）会并发跑 rebuild。两次并发 `rebuildDocxService` 会：①各自上传一个新 OSS 文件、②各自竞争写 `wordCommentRef`（`prisma.$transaction` 两个事务可能用不同 ref 互相覆盖）、③后到的 `setCompletedAfterRebuildDAO` 覆盖先到的 `reviewedFileId`，留下 OSS 孤儿。
  3. 即便没有并发，正常下载也会把"未保存编辑"标记 (`hasUnsavedDocxChanges=true`) 在用户**没点过"保存新版本/重生批注"**的情况下静默置回 false。前端右上角"有未保存的编辑"徽章会消失，但用户其实没保存任何东西。
  4. 与 rebuild-docx 端点产生交叉副作用：用户点了"重新生成批注"（占位 status=rebuilding 中），如果同时另一个标签页/同一用户多客户端点了"下载"，下载侧的 `rebuildDocxService` → `setCompletedAfterRebuildDAO` 会**把 rebuilding 状态强行覆盖为 completed**（DAO 的 update 没有 status 守卫），破坏 rebuild 端点的占位锁语义，原子性彻底失效。
- **分类**: 实现 bug + 违背需求
- **用户感知**:
  - 单次下载耗时从 spec 设计的 <100ms（仅签名 URL）变成 5-30s（含解析 + 注入 + OSS 上传），用户以为"卡住了"会反复点击放大问题。
  - 多次连续下载会产生大量 OSS 孤儿文件，运营成本累积。
  - 多端协作时，A 端下载、B 端正在重生，B 端"重新生成批注"按钮显示"成功"但拿到的是 A 端 download 路径的产物，wordCommentRef 引用错位。
  - 用户感觉"未保存编辑"标记会无故消失。
- **建议**:
  - 短期：恢复 spec §8.5 行为 —— download 只取 `review.reviewedFileId` → `generateSignedUrlService(...)`，不调 `rebuildDocxService`。
  - 文件名带版本号的需求保留：`buildContractReviewFilename` 在签发 URL 时仍能用。
  - 中期：如果 download 路径确实需要解决"旧产物 wordCommentRef 不符合 LEXSEEK-xxx"问题（注释里给的理由），应改为：检查 reviewedFileId 对应的 ossFile 是否带 `meta.commentSchemaVersion` 之类标记，不带才触发一次性 backfill rebuild（且必须走 `atomicSetRebuildingDAO` 占位）。
  - 任何情况下，download GET 都不应有 `setCompletedAfterRebuildDAO` 这种"写 reviewedFileId + 清未保存标记"的副作用。

---

### [Critical] `setCompletedAfterRebuildDAO` 在 rebuilding 状态下没有状态守卫，与 download 路径叠加放大

- **spec 原文**: `2026-04-17-contract-review-design.md:872-877`
  > §8.4 ... 原子占位 ... 4. ... `UPDATE contract_reviews SET ... status='completed'`
  > §8.4 ... 5. 失败：`update contract_reviews set status='completed'`（回滚占位）
- **当前实现**: `server/services/assistant/contract/contractReview.dao.ts:101-114`
  ```typescript
  export async function setCompletedAfterRebuildDAO(id, reviewedFileId) {
      return prisma.contractReviews.update({
          where: { id, deletedAt: null },   // ← 缺 status 守卫
          ...
      })
  }
  ```
  注释也明确写 "不校验入参 status（调用方负责只在 rebuilding 时调）"。
- **偏差**: spec 设计预期 `setCompletedAfterRebuildDAO` **只**由 `rebuild-docx` 端点（已占位为 rebuilding）调用。但实际 `rebuildDocxService` 也被 `download.get.ts` 复用，且 download 路径下 status 是 completed 而非 rebuilding。导致：调用约束被破坏后，DAO 既能从 completed 流向 completed（无害），也能把 rebuilding 强制覆盖为 completed（破坏占位锁，见上一条）。
- **分类**: 实现 bug
- **用户感知**: 多端并发场景下 reviewedFileId 错乱、占位锁失效、batch 重生数据丢失。
- **建议**:
  - 给 DAO 加 status 守卫：`updateMany({ where: { id, status: 'rebuilding', deletedAt: null }, ... })`，count=0 时抛错/返回特殊态由调用方决定。
  - 同时强制让 `rebuildDocxService` 的调用方先持有占位（`atomicSetRebuildingDAO` 返回 true 才能进），把"占位 + 重生 + 完成"做成不可拆开的契约。

---

### [High] `createAgent` 没有挂 `responseFormat`，agent 主路径已绕过 spec §6.3 设计

- **spec 原文**: `2026-04-17-contract-review-design.md:130-145, 388-428`
  > §4.1 ... `createAgent({ model, tools: [parseAndAskStance], systemPrompt: ..., responseFormat: riskSchema, middleware: [...] })`
  > §6.3 responseFormat 动态构造（新增模块）... `buildRiskSchema()`
- **当前实现**: `server/services/workflow/agents/contractReviewMainAgent.ts:365-372`
  ```typescript
  const agent: ReactAgent = createAgent({
      model, systemPrompt, checkpointer, store, tools, middleware,
      // ← 没有 responseFormat
  })
  ```
  实际 risks 由 resume 分支（同文件 L407-484）通过 `runAnalyzeLoop` → `analyzeSingleClause` 逐条 LLM invoke + 自定义 `extractFirstJsonObject` + `safeParse` 产生。`buildRiskSchema()` 只在 `analyzeSingleClause` 里间接被引用（`RISK_SHAPE`）。
- **偏差**: 实施时把 spec §6.3 "agent 按 responseFormat 一次性产出 risks/summary" 改成了 "逐条 LLM 调用 + JSON 字符串解析"。这正是 spec §13 R1 所列的**回退方案**，但 spec 主路径仍是 responseFormat。
  - 是不是真 bug：从 UX 看，逐条流式更好（progress 事件 + risk 增量冒出），spec §2 表里就承认这是优势。但是：spec §13 R1 定义"回退"的前提是"PoC 验证 structuredResponse 不可见"，仓库里没有 PoC 结论文档；§6.5 起头还要求 M3 必须做 PoC。结论：决策**没有落地为可追踪的 spec 修订**，只在代码注释里隐含表达。
- **分类**: 需求未明确（设计已变更但 spec 未同步）
- **用户感知**: 体验上更好（流式可见进度），但任何后续看 spec 的人会以为是"遵从 spec"，遇到 LLM 输出格式问题（已在最近 commit `b7cd9e95` / `f1f53e02` 反复修复）会找错地方。
- **建议**:
  - 要么补一份 spec 修订 ADR，明确"M6.1 之后改为 analyzeSingleClause 流式分条"，让 §6.3 的 responseFormat 章节失效。
  - 要么按 spec 把 responseFormat 接回 createAgent，把 analyzeSingleClause 退回到回退路径。
  - 现状不允许"两边都说自己是主路径"。

---

### [High] 用户路由从 `/dashboard/assistant/contract` 改成 `/dashboard/contract/:id`，spec 未同步

- **spec 原文**: `2026-04-17-contract-review-design.md:27, 893-901`
  > §1.1 步骤 1：进入 `/dashboard/assistant/contract`（MVP 唯一入口）
  > §9.1 路径 `/dashboard/assistant/contract` 合同审查主页
- **当前实现**:
  - `app/pages/dashboard/contract/index.vue`、`app/pages/dashboard/contract/[id].vue` —— 路径改到顶级 `/dashboard/contract/:id`
  - `app/pages/dashboard/contract/[id].vue:1-8` 的页面注释也写 "顶级路由，从 /dashboard/assistant/contract?reviewId=X 迁移而来"
  - 整个 `/dashboard/assistant/contract` 路径已不存在
- **偏差**: 路径迁移（结构性改动）实施时未更新 spec。
- **分类**: 需求未明确（实施变更，文档没跟上）
- **用户感知**:
  - 老链接（早期文档、外部分享、菜单源代码、客服工单截图）失效。
  - RBAC 路由表、左侧 sidebar 配置、菜单 i18n、面包屑 breadcrumb 路径需要排查是否都改到了新路径。
- **建议**:
  - 做一次仓库内 grep 确认无 `/dashboard/assistant/contract` 残留引用（菜单、permissions 表 seed、文档、单元测试 URL）；
  - 同步更新 spec §1.1 / §9.1，把路径改为 `/dashboard/contract`；
  - 同时检查 permissions seed（`prisma/seeds/seedData.sql` 与权限 seed 函数），确保对应的菜单/权限项指向新路径，否则旧用户角色可能看不到入口。

---

### [High] PATCH `/reviews/:id` 提交后**没有任何机制**让批注 docx 重新生成，"未保存编辑"指引可能误导

- **spec 原文**: `2026-04-17-contract-review-design.md:849-861`
  > §8.3 PATCH /reviews/:id ... **不触发批注重生**（需用户显式调 rebuild-docx）
- **当前实现**: `server/api/v1/assistant/contract/reviews/[id]/index.patch.ts:46-56` 只调 `patchReviewRisksDAO`，DAO 同时置 `hasUnsavedDocxChanges=true`。前端 `RiskListPanel.vue` 在 `canRebuild = hasUnsavedDocxChanges && !isRebuilding && completed` 时显示"重新生成批注"按钮。
- **偏差**: 这是 spec 行为，没问题；但与 [Critical] download 偏差**叠加**后形成隐患：
  - 用户编辑 risks → `hasUnsavedDocxChanges=true` → "重新生成批注"按钮亮 → 用户点"下载" → download 路径偷偷跑 rebuild → setCompleted 把 `hasUnsavedDocxChanges=false` → 按钮消失，用户以为"已保存"，但其实是 download 路径意外帮他重生了。
  - 反过来，如果 download 按 spec 改回纯签名 URL，用户编辑后直接点下载，下载到的是**旧批注**（没包含编辑），用户看不到任何"请先点重新生成批注"提示。
- **分类**: 违背需求（spec 未明确这种 UX 引导，但 §11.1 R5 强调"用户编辑 risks 后 rebuild-docx"）
- **用户感知**: 编辑后下载到旧批注，又没有"请先重生"的提示，会投诉"明明编辑了为什么 Word 里没体现"。
- **建议**:
  - 修复 [Critical] download 后，前端 `RiskListPanel` 在 `hasUnsavedDocxChanges=true` 且用户尝试下载时弹一个 toast 或二次确认 "您有未保存的编辑，先重新生成批注 Word？"。
  - 或者下载按钮在 hasUnsavedDocxChanges=true 时变 disabled + 显示 hint "请先点击重新生成批注"。

---

### [Medium] `reviewResultPersistenceMiddleware.afterAgent` 在首轮 interrupt 后能否被触发未验证；若被触发会把 `awaiting_stance` 误置 `failed`

- **spec 原文**: `2026-04-17-contract-review-design.md:213-223, 545-619`
  > §5.1 状态机 / §6.5 中间件 hook 一致性
- **当前实现**: `server/services/workflow/middleware/reviewResultPersistence.middleware.ts:184-224`
  ```typescript
  afterAgent: { hook: async (_state) => {
      const review = await getContractReviewDAO(options.reviewId)
      if (review.status === 'completed') return
      const risks = Array.isArray(review.risks) ? review.risks : []
      if (risks.length === 0) {
          await updateContractReviewDAO(reviewId, { status: 'failed' })
          ...
      }
  }}
  ```
  代码里只跳过 `status === 'completed'`，不跳过 `status === 'awaiting_stance'`。
- **偏差**:
  - 首轮 agent.stream 在 parseAndAskStance 内 `interrupt(...)` 后挂起，review.status 已被工具置为 `awaiting_stance`、risks=[]。
  - 如果 LangGraph 把 interrupt 视为 "agent 已结束本轮"，afterAgent 钩子会触发；此时 status='awaiting_stance' 被误判为"agent 跑完了但 risks 为空"，强行覆盖为 'failed'，立场 Dialog 还在用户屏幕上但后端已置失败 → 用户点"确认"立场后 stance.post.ts 看到 `review.status='failed'`（不在 `awaiting_stance`），走幂等分支返回 200 但不入队任何 run，整个审查流程冻结。
  - 仓库里没有 PoC 验证 interrupt 是否触发 afterAgent；目前 review 流程 work fine 推断**应当不触发**，但缺少守护代码。
- **分类**: 实现 bug（隐患/防御缺失）
- **用户感知**: 一旦 LangGraph 升级版本改变 interrupt 行为，所有 review 在 awaiting_stance 后立刻 failed，全量阻塞。
- **建议**: 在 `afterAgent` 头部加守卫：
  ```typescript
  if (review.status === 'completed' || review.status === 'awaiting_stance') return
  ```
  pending 同理（首轮 stream 异常退出 → review 仍是 pending，已经错位的早期阶段不是 afterAgent 该兜底的）。

---

### [Medium] 首轮 createAgent 路径下，agent 完全不知道审查规范（systemPrompt 也没把 risks 输出格式告知）；仅在 resume 路径才有 analyzeSingleClause 兜底

- **spec 原文**: `2026-04-17-contract-review-design.md:670-705`
  > §6.7 提示词 contractReview_system v1 ... 任务流程 1. 调用 parseAndAskStance ... 2. 工具返回后 ... 3. 按 stance / stanceFocus 逐段审查合同，**按响应格式（response schema）输出结构化结果**
- **当前实现**:
  - `contractReviewMainAgent.ts:151-156` `buildInitialPrompt` 仅告诉 model "调用 parseAndAskStance"
  - `systemPrompt` 由 DB `contractReviewMain` 节点的 prompts 表渲染，假设运营按 spec 配置；但代码层面没有兜底
  - resume 分支 (`L407-484`) 直接绕过 agent，不再让 model 看到任何"输出 risks"指令；agent 在 interrupt 后实际**永远不会被 LangGraph 唤回**
- **偏差**: 现状下 systemPrompt 里的"按 response schema 输出结构化结果"段落是死代码（resume 不走 agent）。如果 DB prompts 配置出错（漏配 / 字段错位），用户首轮 interrupt 之前的"调用 parseAndAskStance"指令也可能失效，agent 会自由发挥；缺少代码层兜底。
- **分类**: 需求未明确 / 设计偏移（与上一条 [High] responseFormat 缺失同源）
- **用户感知**: DB 配置错误时审查流可能完全卡住（model 不调工具就直接回复文本），用户看到"AI 回了一段话但没进入立场 Dialog"。
- **建议**: 与 [High] responseFormat 缺失合并，在 ADR 里统一处理：
  - 要么把"agent 主路径只负责 interrupt"明文写进 spec，去掉 §6.7 关于"按 response schema"的描述；
  - 要么补全 responseFormat + 让 systemPrompt 真的发挥作用。

---

### [Medium] PATCH `/reviews/:id` 不校验"用户编辑后的 risks 是否参考了已存在的 contractRisks 表"

- **spec 原文**: `2026-04-17-contract-review-design.md:849-859`
  > §8.3 ... risks 全量替换；后端用 `z.array(RISK_SHAPE)` 校验结构，失败 400
- **当前实现**: `server/api/v1/assistant/contract/reviews/[id]/index.patch.ts:46-56` 直接 `patchReviewRisksDAO(review.id, parsed.data.risks)` 全量覆盖 `contract_reviews.risks` JSON 字段；但 GET `/reviews/:id` 返回的 risks 优先从 `ContractRisk` + `ContractAnnotation` 表读取（M6.1 Phase A 引入，见 `[id].get.ts:38-57`）。
- **偏差**:
  - PATCH 写的是 legacy `contract_reviews.risks` JSON 字段；
  - GET 在 `currentVersionId != null`（即已迁移到新表）时**完全不读** legacy JSON 字段，只读 `ContractRisk`；
  - 结果：用户编辑提交后，下次刷新页面看到的还是 ContractRisk 表里的旧数据，编辑被静默丢失。
  - rebuild-docx 端点也只读 `ContractAnnotation` 表（见 `contractReviewRebuild.service.ts:52`），完全不关心 PATCH 提交的 legacy risks。
- **分类**: 实现 bug（M6.1 Phase A 引入新表后 PATCH 路径未同步迁移）
- **用户感知**: 已迁移的 review（绝大多数活跃 review）编辑风险点后保存→刷新→编辑消失；下载得到的 Word 也没有用户的修改。
- **建议**:
  - PATCH 端点判断 `review.currentVersionId != null` 时，应该改写 `ContractRisk` / `ContractAnnotation` 表（增量 diff/全量替换都行），而不是 legacy JSON。
  - 或者前端在已迁移 review 上彻底禁用 PATCH，只允许通过 ContractAnnotation 接口（`/reviews/:id/annotations`）增量编辑。
  - 紧急：先在 PATCH 处加 405：`if (review.currentVersionId != null) return resError(event, 410, '此审查已升级到新批注表，请通过批注接口编辑')`，避免静默丢失。

---

### [Medium] `/stance` 端点对 `partyA / partyB` 不做长度限制

- **spec 原文**: `2026-04-17-contract-review-design.md:805-810`
  > §8.2 ... body: StanceRequest // { stance, partyA?, partyB? }
- **当前实现**: `server/api/v1/assistant/contract/reviews/[id]/stance.post.ts:24-28`
  ```typescript
  const BodySchema = z.object({
      stance: z.enum(['partyA', 'partyB', 'neutral']),
      partyA: z.string().optional(),  // ← 无 max
      partyB: z.string().optional(),
  })
  ```
- **偏差**: 用户可以提交任意长度的甲乙方名称，最终落入 `contract_reviews.partyA / partyB` 字段（DB 层的限制如果是 varchar(50)/(255) 会抛 P2000；如果是 text 则可能塞入超长内容污染后续 prompt 渲染）。
- **分类**: 实现 bug（防御缺失）
- **用户感知**: 极端情况下提交超长甲方名称 → 后端 500，体验差。
- **建议**: 加 `.max(200)` 之类合理上限，trim 后空字符串改为 undefined。

---

### [Low] `runAnnotateAndUpload` 与 `rebuildDocxService` 中"过滤孤立批注 + 映射 ContractAnnotationForExport"逻辑完全重复

- **spec 原文**: 无（spec 没规定代码组织粒度）
- **当前实现**:
  - `server/services/workflow/middleware/reviewResultPersistence.middleware.ts:87-116`
  - `server/services/assistant/contract/contractReviewRebuild.service.ts:58-87`
  两段代码逻辑、注释、字段映射几乎逐行相同。
- **偏差**: 重复实现，未来维护时容易一处改了另一处忘改（filter 规则、字段映射）。
- **分类**: 非偏差，但建议重构
- **用户感知**: 无直接感知，但属于潜在维护债。
- **建议**: 抽公共函数 `buildExportableAnnotations(reviewId)`，两处都调它。

---

### [Low] `summarizeOverview` 失败时降级 summary 写为 `{ highlights: null, overall: '本合同识别到 N 条风险。' }`，spec 没定义降级形态

- **spec 原文**: `2026-04-17-contract-review-design.md:411-425, 691-702`
  > §6.3 buildRiskSchema() summary: z.string()
  > §6.7 systemPrompt - summary 以 Markdown 简要说明合同整体风险画像
- **当前实现**: `contractReviewMainAgent.ts:498-504`
  ```typescript
  await updateContractReviewDAO(review.id, {
      summary: { highlights: null, overall: `本合同识别到 ${risks.length} 条风险。` } as ...
  })
  ```
- **偏差**: spec 里 summary 是 string，实际 DB 是 JSON（M6.1 Task 1.3 改为 ContractOverview），可见 spec 已超前过期。降级文案合理，但"highlights: null + 一句话 overall"是隐式协议，没有文档支撑；前端 `extractSummaryPreview` (`contractReview.dao.ts:151-159`) 已处理这种结构。
- **分类**: 需求未明确（M6.1 改造的副产物）
- **用户感知**: 失败时仍能看到"本合同识别到 X 条风险"作为占位摘要，OK。
- **建议**: 在 spec 修订（M6.1）里把 summary 类型从 string 改为 ContractOverview 并明确降级形态。

---

### [Low] `failed` + `segments=[]` 失败路径前端没有"重新上传"专属引导

- **spec 原文**: `2026-04-17-contract-review-design.md:236-239`
  > §5.1 status='failed' && risks IS NULL：结构化输出失败 ... 前端显示"AI 输出异常，请重新发起审查"
- **当前实现**:
  - `contractReviewMainAgent.ts:462-473`：segments=[] 时置 status=failed
  - 前端 `useContractReview.ts:265-269` 收到 stream failed 时只 toast "审查未能完成，请刷新页面或稍后重试"
  - 没有"请重新上传"按钮或专属引导
- **偏差**: 失败语义没有按 spec 区分（spec 明确 failed && risks IS NULL 应文案"AI 输出异常"），且 segments=[] 这种"切分失败"在 UI 上和"AI 输出失败"混在一起，用户没法判断是文件本身的问题。
- **分类**: 违背需求（细节）
- **用户感知**: 上传一个空白合同/纯图片合同 → 转半天 → 看到"审查未能完成" → 不知道原因 → 不知道该上传别的文件。
- **建议**:
  - 后端 GET `/reviews/:id` 在 status=failed 时附 `failReason` 字段（'no_segments' / 'ai_schema' / 'inject_fail'），由不同代码位写入。
  - 前端 RiskListPanel 在 status=failed 时根据 failReason 渲染不同 CTA（"重新上传" vs "重新审查"）。

---

### [Low] DELETE `/reviews/:id` 端点存在但 spec 完全没定义

- **spec 原文**: spec 全篇未提及删除接口（§8 API 契约只列 5 个端点）
- **当前实现**: `server/api/v1/assistant/contract/reviews/[id].delete.ts` 完整实现软删 + busy 状态 409 防护
- **偏差**: 实施超出 spec 范围（合理需求，但应在 spec 同步）。
- **分类**: 需求未明确
- **用户感知**: 删除按钮 / 状态防护 OK，无负面感知。
- **建议**: 同步 spec §8 增加 DELETE 端点描述。

---

### [Low] `STANCE_FOCUS_TABLE` / `STANCE_LABELS` 在 `parseAndAskStance.tool.ts` 与 `analyzeSingleClause.ts` 各定义一份

- **当前实现**:
  - `server/services/workflow/tools/parseAndAskStance.tool.ts:33-43`
  - `server/services/assistant/contract/analyzeSingleClause.ts:167-171`（用 if/else 重写而非引用常量）
- **偏差**: 同样的"partyA→甲方"映射在多处实现，spec §6.4 明确"代码内置常量表"。
- **分类**: 非偏差但维护点
- **建议**: 抽到 `shared/types/contract.ts` 或 `server/services/assistant/contract/stance.const.ts`，两处复用。

---

## 非偏差但值得留意

1. **`enqueueRunService` 在 `createAndStartContractReviewService` 失败后的清理缺失**：如果 enqueueRunService 抛错，已经创建的 caseSession + contractReviews + ossFiles 不会回滚，留 dangling 行（用户重试会成功，但 DB 累积无效记录）。可加事务包裹，或异步 cleanup job。

2. **`hasUnsavedDocxChanges` 字段的语义边界模糊**：DAO 在 PATCH 时置 true、在 setCompletedAfterRebuild 时置 false。若用户 PATCH 之后 rebuild 失败 → DAO 走 `rollbackRebuildDAO` 把 status 回滚到 completed，但 `hasUnsavedDocxChanges` 没被还原（仍为 true，符合"还有编辑没生成 docx"的语义；但最初的 true 是 PATCH 写的，rebuild 失败的"丢的是这次 rebuild"还是"丢的是 PATCH"用户分不清）。属于业务态机的边角，目前能 work，但 spec 没覆盖。

3. **`agentWorker.executeRun` 的 contract scope 分流**（`L203-216`）严格遵循 spec §6.6 的"非 handler map 注入"建议，OK。

4. **`reviewGuard.loadOwnedReview` 抽象做得不错**：所有 [id] 类端点统一走它，避免每个 endpoint 重复写 owner 校验。但本审计未深入读它，假定它正确。

5. **流式 `progress / risk / stage` 自定义 SSE 事件**：是 spec §13 / M6.1 引入的，体感上比 spec §6.3 的"agent 一次性返回"好得多。属于实现层超额交付（ux 角度算正分），但与 [High] responseFormat 缺失同根，需要在 spec 里统一回写。

---

## 总结

| 等级 | 数量 | 关键词 |
|---|---|---|
| Critical | 2 | download 路径误把 read-only 做成全量重生 + DAO 缺 status 守卫 |
| High | 3 | responseFormat 缺失、路由迁移未同步 spec、PATCH 不触发 rebuild 与 download 副作用叠加 |
| Medium | 3 | afterAgent awaiting_stance 误判、首轮 systemPrompt 死代码、PATCH 不写新表导致编辑丢失 |
| Low | 5 | 重复代码、降级 summary 形态、失败 UI 引导、DELETE 端点、stance 常量重复 |

**最优先修**（按"用户能立即投诉/出事故"排序）：

1. **[Critical] download 路径恢复 spec §8.5 行为**（仅签名 URL，不重生），同步给 `setCompletedAfterRebuildDAO` 加 status 守卫。
2. **[Medium] PATCH 不写新表导致编辑丢失**（已迁移 review 上编辑全量丢失，是用户能直接看到的功能性 bug）。
3. **[High] 路由迁移**：grep 全仓库残余引用 + 同步 spec / RBAC seed。
4. **[Medium] afterAgent 加 awaiting_stance 守卫**（防御 LangGraph 升级带来的回归）。
