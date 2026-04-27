# 阶段 5 · 法律助手 → 文书 / 合同（无 caseId）

> Spec 锚点：`docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md` §6 阶段 5
> 工程量：1-2 周（用户可见）
> 起点 tag：`ai-unify-stage-4-done`
> 入口 handoff：`docs/superpowers/notes/2026-04-27-stage4-to-stage5-handoff.md`

---

## 一、目标（用户视角）

让用户在「法律助手」对话里可以一句话起草文书 / 审一份合同：

- **E2E 1**：用户输入"帮我起草起诉状" → 助手调 `draft_document` 工具 → 工具卡片"已完成"显示标题/字数/摘要 → 用户点击"在文书页继续编辑" → 跳转到 `/dashboard/document/drafts/:id?from=assistant&sessionId=…` → 顶部"来源 = 法律助手 · 未关联案件 · [+ 关联案件]" → 弹出案件选择 Dialog → 选完后该草稿与案件绑定。
- **E2E 2**：用户输入"审一下这份合同"（拖入 docx 到 prompt input）→ 助手调 `review_contract` 工具（带立场参数）→ 工具卡片"已完成"显示风险点统计 + Top 3 摘要 → 用户点击"打开合同审查工作台" → 跳到 `/dashboard/assistant/contract/[reviewId]?from=assistant&sessionId=…` → 顶部同样的"来源条 + 关联案件"。
- **返回闭环**：从子页面顶部"← 返回 法律助手"按钮可以回到原对话（用 `?sid=` 恢复 session）。

---

## 二、现状与盲点（基于调研）

### 已就位的基建（不重复造）

| 项 | 现状 | 文件 |
|---|---|---|
| `SSECustomEventType.DRAFT_SAVED` / `CONTRACT_REVIEW_SAVED` | 阶段 1 已预留 + payload 接口已声明 | `shared/types/agentEvent.ts:43-64` |
| `publishCustomEvent(event)` | 通用桥接已就位 | `server/services/agent/agentEventBridge.ts:124` |
| `assistantMain` 节点（id=15）| DB 已有，当前 tools=`["search_law"]`，无 skills 关联 | `prisma/seeds/seedData.sql:1077` |
| 法律助手 vertical | createAgent 路径，自动跑全栈中间件 + 自动挂 4 个 skill 工具 | `server/agents/legal-assistant/agent.config.ts` |
| `documentDraft.service.createDraftService` | 字段已含 `caseId`（默认 null） | `server/agents/document/documentDraft.service.ts:49` |
| `runDocumentChat` / `runContractReviewChat` | 流式 `Promise<ReadableStream>` | `agent.config.ts` 双 vertical |
| `ToolContext` 类型 | 已有 `caseId? / runId? / sessionId / userId / draftId? / reviewId?` | `server/services/agent-platform/tools/types.ts:36` |
| `AiToolRenderer.toolMap` 注入机制 | 已就位但 0 业务在用（阶段 7 全局收敛前先走本阶段示范） | `app/components/ai/AiToolRenderer.vue:21` |
| 现有 16 张工具卡片样式 | 可仿写 props 协议 | `app/components/ai/tools/SaveAnalysisResultTool.vue` |

### 空白 / 需新建

| 项 | 处理 |
|---|---|
| 子代理工具 `draft_document` / `review_contract` | 新增 2 个 tool 文件 + 注册到 `tools/index.ts` |
| sub-agent stream drain helper | 新增通用 helper：`server/services/agent-platform/subAgent/runAndDrain.ts`（吞掉流，提取最终持久化结果） |
| 案件选择 Dialog 组件 | 新增 `app/components/cases/CaseLinkerDialog.vue`（用户端：列出"我的"未删除案件，单选 + 确认） |
| `PATCH /api/v1/assistant/document/drafts/:id { caseId }` | 现有 PATCH 只支持 `values`，新增 `caseId` 字段 |
| `PATCH /api/v1/assistant/contract/reviews/:id { caseId }` | 全新接口（review 层无 PATCH） |
| 文书页顶部"来源条"区块 | `app/pages/dashboard/document/drafts/[id].vue` 新增 |
| 合同工作台顶部"来源条"区块 | `app/pages/dashboard/assistant/contract/[id].vue`（待确认路径） |
| `app/components/agents/document/tools/DraftDocumentCard.vue` | 新增 |
| `app/components/agents/contract/tools/ReviewContractCard.vue` | 新增 |
| 法律助手 toolMap 注入这 2 张卡 | 在法律助手 `useAssistantChat`（待阶段 7 收敛，本阶段先就地注入）传给 `AiToolRenderer` |

### 关键约束 / 决策点（用户拍板）

#### 决策点 D1：子代理工具的 stance 处理（**ReviewContract 工具最棘手**）

合同审查 vertical 内部有 `awaiting_stance` interrupt，子代理工具 await 整个 stream 会卡死（无人 resume）。三个方案：

- **方案 A（推荐）**：`review_contract` 工具 schema 强制要求 `stance: 'partyA' | 'partyB' | 'neutral'` + 可选 `partyA / partyB` 名称参数。LLM 在 prompt 里被引导（要么用户已说立场→直接传；要么先用一句对话问用户→再调工具）。工具内部用预设的 stance 直接走完流程，跳过 interrupt（要么 contractReview vertical 的 stance 字段已有值，要么子代理工具在创建 review 时立即 enqueue stance）。
- **方案 B**：工具不等结果，立即返回 href 给 LLM，让用户跳到合同工作台再继续 stance/分析。卡片只显示"审查中..."而非"已完成 + Top 风险"。
- **方案 C**：复杂——把 interrupt 透传给主代理 → 主代理透传给前端 → 前端再调一次 review_contract 工具 confirm。工程量翻倍。

> **推荐方案 A**：与 spec §5.1 原意（"工具同步执行 await 然后返回结果"）一致，且产品体验最好。

#### 决策点 D2：DraftDocument 工具是否要求 templateId（vs templateName）

spec §5.1 工具签名是 `templateName: z.string()`，但 `documentDraft.service.createDraftService` 内部需要 `templateId: number`。两条路：

- **D2-A（推荐）**：工具 schema 只接 `intent: string`，模板由 documentMain 在内部依据语义自选（沿用文书生成现有逻辑）。简单、不依赖 LLM 给准模板名。
- **D2-B**：工具 schema 同时接 `templateName: string`，工具内部 fuzzy 匹配 templates 表。如果没匹配到回落到 D2-A 路径。

#### 决策点 D3：6 个 skills 入网——node_skills 关联策略

`assistantMain` 当前无 skills 关联。要给它接入 6 个 skill，两条思路：

- **D3-A（推荐）**：seedData 一次性 INSERT 6 行 `node_skills(15, 'docx')`...`(15, 'minimax-xlsx')` + 一次性同步脚本（仿阶段 4 `stage4-apply-contract-skill.ts` 的幂等模式）。运维新部署一次性带上。
- **D3-B**：仅注册 docx + pptx 两个最常用，剩下 4 个等阶段 8 真用到再加。

#### 决策点 D4：toolMap 在哪里注入

阶段 7 才做"前端复用收敛"，所以本阶段需要一个临时位置注入两张卡片：

- **D4-A（推荐）**：在 `useAssistantChat`（或 `app/components/assistant/AssistantChatPanel.vue`）传给 `AiToolRenderer` 的 toolMap prop 里注入这 2 张卡。阶段 7 收敛 useDomainAgentSession 时再迁移。
- **D4-B**：直接改 `AiToolRenderer.vue` 内置 v-if 链路。会污染全局，不推荐。

#### 决策点 D5：执行模式

仿阶段 4 用 TeamCreate 并行（3-4 个 teammate），还是单 agent 顺序。

- **D5-A（推荐）**：4 个 teammate 并行：
  - `tools-impl`：sub-agent 工具 + runAndDrain helper + tools/index 注册（后端）
  - `admin-api`：2 个 PATCH 接口 + 关联案件 service（后端）
  - `frontend-cards`：2 张工具卡片 + CaseLinkerDialog 组件（前端）
  - `frontend-pages`：文书页/合同页顶部"来源条" + assistant 路由 toolMap 注入（前端）
  - **主 lead（你）**：seedData / node_skills 同步 + 集成 + 回归脚本 + E2E smoke
- **D5-B**：单 agent 顺序，省 team 协调成本但慢。

---

## 三、任务拆分（按 vertical 分组，10 个 Task）

### 子组 1：后端工具实现（teammate `tools-impl`）

**Task 1 · sub-agent stream drain helper**
- 新建 `server/services/agent-platform/subAgent/runAndDrain.ts`
- 提供 `runAndDrainStream(stream): Promise<{ finalState, success }>`
- 负责消费整个 ReadableStream + 解析最后的 values 事件 + 错误兜底
- 单测覆盖：成功 drain / 中途错误 / cancel 信号

**Task 2 · `draft_document` 工具实现**
- 新建 `server/services/agent-platform/tools/draftDocument.tool.ts`
- schema：`{ intent: string, additionalContext?: string }`（采纳 D2-A）
- 流程：
  1. `createDraftService({ userId, caseId: ctx.caseId ?? null, sourceText: intent + additionalContext, templateId: ASSISTANT_DEFAULT_TEMPLATE_ID })`
  2. `runDocumentChat(draft.sessionId, intent, ...)` → drain
  3. 从 documentDrafts 表 reload 拿到 title / 字数 / summary
  4. `publishCustomEvent({ runId, type: DRAFT_SAVED, payload: { draftId, summary, title, href } })`
  5. 返回 LLM `{ success, draftId, title, summary, href }`（JSON.stringify）
- 单测：mock runDocumentChat → 验证 drain + publishCustomEvent 调用

**Task 3 · `review_contract` 工具实现**
- 新建 `server/services/agent-platform/tools/reviewContract.tool.ts`
- schema：`{ ossFileId: number, stance: 'partyA' | 'partyB' | 'neutral', partyA?: string, partyB?: string }`（采纳 D1-A）
- 流程：
  1. `createReviewService({ userId, caseId: ctx.caseId ?? null, sourceType: 'upload', ossFileId, stance, partyA, partyB })` — 注意 stance 直接落库，跳过 interrupt
  2. `runContractReviewChat(review.sessionId, { skipStanceInterrupt: true, ... })` → drain
  3. 从 contractReviews 表 reload 拿 risks/summary
  4. `publishCustomEvent(CONTRACT_REVIEW_SAVED, { reviewId, riskCount, topRisks, href })`
  5. 返回 LLM
- **关键依赖**：`runContractReviewChat` 需新增可选参数 `{ skipStanceInterrupt?: boolean }`，当 review.stance 已有值时不再 interrupt。需要一并修改 contract vertical（小动作，不破坏现有 flow）。
- 单测：mock runContractReviewChat → 验证流程

**Task 4 · 注册工具 + ToolContext 透传**
- `server/services/agent-platform/tools/index.ts` 注册 2 个新工具
- 验证 ToolContext.runId 在 createAgent 路径上能被正确传到工具（grep `runId` 在 platform tool context 注入路径）
- 验证 publishCustomEvent 能用主代理 runId 而非子代理 runId

### 子组 2：后端关联案件 API（teammate `admin-api`）

**Task 5 · `PATCH /api/v1/assistant/document/drafts/:id { caseId }`**
- 修改 `server/api/v1/assistant/document/drafts/[id].patch.ts` 接受 `caseId?: number | null`
- service 层加 `linkDraftToCaseService(draftId, userId, caseId)`：校验 case 归属（owner-only） + 校验 draft 归属 + 写入
- 单测：归属校验 / 解绑（caseId=null） / 跨用户 case 拒绝

**Task 6 · `PATCH /api/v1/assistant/contract/reviews/:id { caseId }`**
- 新建 `server/api/v1/assistant/contract/reviews/[id].patch.ts`
- 同 Task 5 的归属校验 + 写入
- 单测同上

### 子组 3：前端工具卡片 + 案件选择 Dialog（teammate `frontend-cards`）

**Task 7 · `CaseLinkerDialog.vue`**
- 新建 `app/components/cases/CaseLinkerDialog.vue`
- 列出当前用户"我的"未删除案件 + 单选 + 确认 callback
- 接受 props: `open`, `currentCaseId`, `onConfirm: (caseId: number | null) => Promise<void>`
- 复用 shadcn Dialog；加搜索框（案件多时）
- 不写"无案件→新建"分支（控制范围，让用户先去案件页建好）

**Task 8 · `DraftDocumentCard.vue` + `ReviewContractCard.vue`**
- 新建：
  - `app/components/agents/document/tools/DraftDocumentCard.vue`
  - `app/components/agents/contract/tools/ReviewContractCard.vue`
- 仿现有工具卡片 props 协议：`{ toolName, input?, output?, state }`
- 状态：执行中 / 已完成 / 失败（同 SaveAnalysisResultTool）
- 内容：从 output JSON 解构 title / summary / risks / href
- 操作：「在文书页继续编辑」/「打开合同审查工作台」按钮 → `navigateTo(href)`

### 子组 4：前端跳转协议 + 顶部色彩条（teammate `frontend-pages`）

**Task 9 · 文书页顶部"来源条"**
- 修改 `app/pages/dashboard/document/drafts/[id].vue`
- 解析 `route.query.from / caseId / sessionId`
- 顶部条件渲染：`<DraftSourceBar v-if="from" .../>` 显示来源 + 返回按钮 + "+ 关联案件"按钮
- 关联案件按钮 → 打开 CaseLinkerDialog（confirm 后调 PATCH 接口 + toast）
- 抽 `app/components/agents/document/DraftSourceBar.vue` 子组件（也复用给阶段 6 小索路径）

**Task 10 · 合同工作台顶部"来源条" + assistant toolMap 注入**
- 修改 `app/pages/dashboard/assistant/contract/[id].vue`（先确认路径）
- 同 Task 9 模式 + 抽 `ReviewSourceBar.vue` 子组件
- 修改 `app/components/assistant/AssistantChatPanel.vue`（或对应 chat 渲染入口）：把两个新工具卡片传入 `AiToolRenderer` 的 `toolMap` prop

### 主 lead 收尾

**Task 11 · seedData + node_skills 同步**
- `prisma/seeds/seedData.sql`：
  - `nodes` 表 id=15 的 tools 数组改成 `["search_law", "draft_document", "review_contract"]`
  - `node_skills` 表 INSERT 6 行（id=15, 6 个 skill code，幂等 ON CONFLICT）
- 一次性同步脚本 `scripts/stage5-apply-assistant-config.ts`（仿 stage 4，PrismaPg 适配 + 幂等 upsert）
- 防回退测试 `tests/server/agent-platform/nodeSkills.assistant.test.ts`

**Task 12 · 集成 + 回归脚本**
- `scripts/stage5-regression.sh`（仿 stage 4）：
  - typecheck
  - 阶段 5 新增的全部测试
  - 法律助手 / 文书 / 合同 业务测试
  - 工作区干净检查（忽略 bun.lock / package.json / vitest.config.ts）

**Task 13 · E2E smoke（自起 dev server + chrome-devtools）**
- E2E 1：法律助手「帮我起草起诉状」全流程
- E2E 2：法律助手「审一下这份合同」（拖 docx）全流程
- 验证返回链接 + 关联案件
- 出具 `docs/superpowers/notes/2026-04-27-stage5-e2e-smoke.md`

---

## 四、完成定义（DoD）

- [ ] `draft_document` / `review_contract` 工具注册到 `tools/index.ts`
- [ ] `assistantMain` 节点 tools = `["search_law", "draft_document", "review_contract"]`
- [ ] `assistantMain` node_skills 关联 6 个 skill
- [ ] 2 张工具卡片就位 + 通过 `AiToolRenderer.toolMap` 注入法律助手对话流
- [ ] `CaseLinkerDialog.vue` 就位，文书页 / 合同工作台两处都能调起并成功 PATCH
- [ ] 跳转协议 `?from=&caseId=&sessionId=` 在两个独立页落地，「返回法律助手」可恢复 session
- [ ] 2 个 PATCH 接口 + 用户端归属校验
- [ ] E2E 1 / E2E 2 smoke 全通过
- [ ] `stage5-regression.sh` 全绿
- [ ] tag `ai-unify-stage-5-done`
- [ ] 出 handoff note `docs/superpowers/notes/2026-04-XX-stage5-to-stage6-handoff.md`

---

## 五、风险 / 已知遗留

- contract vertical 增加 `skipStanceInterrupt` 选项需小心，确保不破坏老 stance 流（用 default `false` 兼容）
- 法律助手页面 `useAssistantChat` 是阶段 7 收敛目标，本阶段只在它上游加 toolMap prop，不改内核
- `runAndDrainStream` 的合同分析超时（30-60s）可能让 LLM 调用工具看起来"卡住"——用户体验上助手"调用工具中..."的状态需要前端在工具卡片"执行中"态显示 loading 动画
- 文书 / 合同的"未关联案件"提示，**只在 caseId 为空时显示**，已关联的状态不显示按钮（D6 隐含设计）

---

## 六、关键决策点汇总（等用户确认）

| 编号 | 决策 | 推荐 |
|---|---|---|
| D1 | review_contract 工具如何处理 stance interrupt | 方案 A：schema 强制 stance 参数 + 跳过 interrupt |
| D2 | draft_document 工具的模板传递方式 | D2-A：只接 intent，模板由 documentMain 自选 |
| D3 | 6 个 skill 是否一次性接入 | D3-A：一次性 6 个 |
| D4 | toolMap 在哪里注入 | D4-A：法律助手 chat panel 就地注入 |
| D5 | 执行模式 | D5-A：4 个 teammate 并行（仿阶段 4） |
