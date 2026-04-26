# AI 基建统一改造 · 阶段交接说明（持续性 handoff）

> 这份文档让新会话主 agent 快速了解"现在在哪里、下一步做什么"。每完成一个阶段，把对应阶段的"已完成"打上 ✓ + 更新"git tags"列表 + 把任何遗留 issue 追加到末尾。

## 总体状态速览

| 阶段 | 状态 | Tag |
|---|---|---|
| 阶段 1 底座类型化 + Skills 入库 + Agent Registry | ✅ 完成 | `ai-unify-stage-1-done` |
| 阶段 2 Agent 工厂化 + 业务 vertical + Skills 入网 | ✅ 完成 | `ai-unify-stage-2-done` |
| 阶段 3 search_law 普及（用户可见）| ⏳ 待做 | — |
| 阶段 4 合同审查接底座（高风险）| ⏳ 待做 | — |
| 阶段 5 法律助手 → 文书 / 合同（用户可见）| ⏳ 待做 | — |
| 阶段 6 小索 → 文书 / 合同（用户可见）| ⏳ 待做 | — |
| 阶段 7 前端复用收敛 | ⏳ 待做 | — |
| 阶段 8 案件初分接 skills + 提示词改造 | ⏳ 待做 | — |

## 起手指令（新会话第一条消息直接复制）

```
继续 LexSeek AI 基建统一改造。
请先 read 现状文档：docs/superpowers/notes/2026-04-26-stage2-to-stage3-handoff.md
spec：docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md
按现状文档"总体状态速览"找到下一个待做阶段，read spec §6 对应章节，
用 superpowers:writing-plans skill 生成 plan 文档（命名 docs/superpowers/plans/2026-04-26-ai-unify-stage-N-<feature>.md），
然后用 superpowers:subagent-driven-development skill 或 TeamCreate 团队模式执行。
```

## 关键架构事实（避免新会话误改）

- **case-analysis 仍走 legacy**（`registerLegacyRunners` 中保留 `(CASE, ANALYSIS) → startCaseAnalysisV2`），由阶段 8 接入，阶段 3-7 不动
- **caseSessions.scope 双域**：`'case' | 'assistant' | 'document' | 'contract'`，对应 enum `SessionScope`（`shared/types/agentEvent`）
- **agentRegistry 单例**：6 个 entry（5 vertical 自动注册 + caseAnalysisV2 legacy）
- **节点动态 nodeName**：case-module 用 `(ctx) => ctx.metadata.moduleName`，工厂 runtime.ts 已支持
- **Skills 工具自动跟随**：节点关联了任意 skill，4 个 skill 工具自动注入，**不要**在 nodes.tools 重复配置
- **测试 vi.mock 必须 mock 真实路径**（不是 shim），业务搬迁时测试 import 路径要同步
- **工作区干净**才能打 tag；前一阶段 tag 是后一阶段的起点 baseline

## 阶段 1 已完成

- 底座类型化：`SessionScope`、`SessionType`、`SSECustomEventType` + 11 payload + Map、`InterruptType`、`SkillSource`、`SkillStatus` 枚举
- Prisma 新增 `skills` + `node_skills` 表 + `nodes.useSkillsAsLogic` 字段
- HNSW 向量索引 restore migration（解决 Prisma migrate dev 自动 DROP 问题）
- SkillSync DAO + Service + 启动 plugin + Admin Resync API
- `AgentRegistry` 注册表 + 5 个 legacy runner 注册
- `agentWorker.executeRun` 改用 `agentRegistry.dispatch`

## 阶段 2 已完成

- 平台库 `server/services/agent-platform/` 完整：factory / registry / middleware / tools / nodeConfig / context / state / sse / skills
- 业务 vertical `server/agents/{case-main,case-module,legal-assistant,document,contract}/` 5 个 vertical 全部接入 `defineDomainAgent`
- `defineDomainAgent` 工厂支持 createAgent / stateGraph 双路径 + 动态 nodeName + 自动 skillsMiddleware 挂载 + 4 个 skill 工具自动跟随
- `server/plugins/agents-load.ts`：5 vertical 自动注册到 agentRegistry；`registerLegacyRunners` 仅保留 caseAnalysisV2
- 后台 admin skills CRUD + 节点关联 skills chip 多选 UI 上线
- 33 测试文件 367 测试 PASS

执行经验：阶段 2 用 **TeamCreate (`ai-unify-s2`)** + 4 teammate 并行 + task list with blockedBy 依赖图，效率比串行高 3-5 倍。后续阶段建议沿用此模式。

## 阶段 3：search_law 普及（用户可见，2-3 天）

**Spec 章节**：spec §6 阶段 3

**简述**：在管理后台把 `search_law` 工具加到三个节点（`caseModule`、`documentMain`、`contractReviewMain`）的 `nodes.tools`；三个节点的 system prompt 末尾追加"必要时引用法条，使用 search_law 工具"指令。

**完成定义（DoD）**：
- 三个节点 nodes.tools 含 search_law（管理后台直接配置 / seed）
- 三个 prompts 更新追加引用指令
- E2E 验证：模块对话 / 文书生成 / 合同审查 三个场景下用户提含法条问题时回答附法条出处

**关键风险**：
- 合同审查 `analyzeSingleClause` 等子流程在 LLM JSON 调用链中，需确认 search_law 在该子链路也生效
- 风险整体极低（配置改一行级别）

**用户可见点**：模块对话 / 文书 / 合同审查回答能引用具体法条 + 出处。

**任务量提示**：plan 估计 5-8 个 task，全量上线（spec D18 决策）。

---

## 阶段 4：合同审查接底座（关键风险，1-2 周）

**Spec 章节**：spec §6 阶段 4

**简述**：合同审查改造的核心是把现有的"resume 路径绕过 agent.stream"重写为标准 `Command.resume` + 中间件 + 工具流程。本阶段开始时合同审查通过 stateGraph 类型在 `agentType: 'stateGraph'` 路径下委托给 `runContractReviewChat`（阶段 2 决策保留现状），本阶段把它改为标准 createAgent 路径。

**完成定义**：
- contractReview 节点改用 `agentType: 'createAgent'`
- `parseAndAskStance` 工具保留（合同私有），但 `runAnalyzeLoop` / `summarizeOverview` 改造为 tool / middleware 形态
- resume 走 `Command.resume`，不再绕过 agent.stream
- 合同审查独立工作台 UI 完全不变
- 合同审查接入 docx skill（添加 node_skills 关联）

**关键风险（spec §7 风险表第 1 条）**：高风险——resume 路径行为可能存在细微差异（中间件执行时机 / 流式事件序列）。**必须做端到端 SSE 事件序列对比**。

**缓解**：
- 单独 1-2 周回归测试 + 对比改造前后的 SSE 事件录像
- 旧 resume 函数文件保留至下个迭代结束（仅用于 bug 排查，不进生产路径）
- 上线后专门观察 1-2 天监控

**注意**：阶段 4 最容易暴雷。建议**单独一个 PR / 单独一个 stage tag**，不要急着进阶段 5。

---

## 阶段 5：法律助手 → 文书 / 合同（用户可见，1-2 周）

**Spec 章节**：spec §6 阶段 5 + §5（业务互调设计）

**简述**：实现 C 档协作的核心——法律助手能调起文书生成和合同审查作为子代理工具。无 caseId 启动模式（用户在结果独立页通过"+关联案件"按钮补绑）。

**完成定义**：
- `server/services/agent-platform/tools/draftDocument.tool.ts` + `reviewContract.tool.ts` 实现（同步执行）
- 两个工具注册到工具注册表
- 法律助手节点（`assistantMain`）的 nodes.tools 加 `draft_document` 和 `review_contract`
- 法律助手节点接入全部 6 个 skills
- `app/components/agents/document/tools/DraftDocumentCard.vue` 实现（摘要 + 跳转按钮）
- `app/components/agents/contract/tools/ReviewContractCard.vue` 实现（摘要 + Top 风险 + 跳转）
- 跳转协议落地：`?from=&caseId=&sessionId=`
- 文书页 + 合同工作台顶部"来源色彩条 + 返回链接 + 关联案件按钮"
- `PATCH /api/v1/assistant/document/drafts/:id { caseId }` 接口
- `PATCH /api/v1/assistant/contract/reviews/:id { caseId }` 接口

**用户可见点**：法律助手输入"帮我起草起诉状" / "审一下这份合同" → 工具卡片在对话流出现 → 跳转独立页继续精修。

**关键风险（spec §7 第 5 条）**：低风险——子代理同步执行可能阻塞主对话 30 秒-2 分钟。缓解：工具卡片实时显示进度。

---

## 阶段 6：小索 → 文书 / 合同（用户可见，1 周）

**Spec 章节**：spec §6 阶段 6

**简述**：在阶段 5 基础上，让小索（caseMain）也能调起两个子代理工具。**带 caseId 透传**——文书自动绑定当前案件，合同审查带入案件信息。

**完成定义**：
- caseMain 节点（`caseMain`）的 nodes.tools 加 `draft_document` 和 `review_contract`
- caseId 透传：小索 ToolContext.caseId 非空时自动带入子代理
- 文书生成节点（`documentMain`）接入 docx skill（修补"docx skill 本是为文书造的，但文书没接"的产品缺位）
- 文书页 + 合同工作台识别 from=xiaosuo + caseId 不为空时不显示"+ 关联案件"按钮
- 复用阶段 5 的工具卡片组件（不重写）

**用户可见点**：小索浮窗输入"起草起诉状" / "审合同" → 工具卡片显示"关联案件: XXX" → 跳转文书页 / 合同工作台带 caseId。

**关键风险**：低（基本是阶段 5 的复用 + 透传 caseId）。

---

## 阶段 7：前端复用收敛（1-2 周，可与 5/6 并行）

**Spec 章节**：spec §6 阶段 7

**简述**：前端 6 个业务 composable 共有的"延迟初始化 + effectScope + custom event 分发"逻辑抽到 `useDomainAgentSession` 工厂；分散在两个目录的 interrupt handler 收敛到注册表。

**完成定义**：
- `useDomainAgentSession` 工厂实现（基于现有 `useStreamChat` 内核）
- 6 个业务 composable 收敛为 30-50 行薄包装
- **删除（破坏性更新允许）**：`useCaseChat.ts` / `useAssistantChat.ts` / `useXiaosuoChat.ts` / `useChatSessionManager.ts` / `useModuleChatManager.ts` / `useDocumentDraft.ts` / `useContractReview.ts` / `useInitAnalysis.ts`
- Interrupt 注册表实现，`case/interrupt/` 各 handler 注册
- 删除 `app/components/caseAnalysis/interrupts/` 目录（功能并入 `case/interrupt/`）
- 删除 `app/components/caseAnalysis/promptInput.vue`（功能由 `ai/AiPromptInput.vue` 提供）
- SSE custom event 类型化分发器在工厂内置

**用户可见点**：无（纯前端基建收敛）。

**关键风险**：中——大量旧 composable 删除可能漏掉某些业务的特殊行为。建议**逐业务迁移**而非一次性删全部，每迁完一个跑该业务 smoke。

---

## 阶段 8：案件初分接 skills + 提示词改造（1 周）

**Spec 章节**：spec §6 阶段 8

**简述**：案件初分（StateGraph）形态保留，但每个分析子模块支持配置 skills；提示词改造为"只写规范，分析方法论放 skill 里"。

**完成定义**：
- `server/agents/case-analysis/` 完成（StateGraph 形态保留）
- StateGraph 各分析子模块（每个 `nodes.type='analysis'` 节点）支持 skills 配置
- 各分析子模块的 ReAct 子图共享 `agent-platform/middleware/` 的中间件管道（含 skillsMiddleware）
- 提示词改造："只写规范，不写做事方法"——分析方法论转移到对应 skill
- 3-5 个分析模块配上 skills（建议清单：诉讼策略 → evidence-defense；证据清单 → docx；案情可视化 → litigation-visualization）
- `nodes.useSkillsAsLogic` 字段控制（阶段 1 已建好该字段）：每个节点独立选用"skills-as-logic"风格还是"传统嵌入式 prompt"风格——**节点级颗粒度，不是全局开关**

**用户可见点**：无（除非提示词改造影响输出质量）。

**关键风险（spec §7 第 3 条）**：中——提示词改造可能影响输出质量。**必须抽样测试 5-10 个真实案件对比新旧两种风格的输出**。

**缓解**：
- `useSkillsAsLogic` 字段允许逐节点迁移，某节点出现质量退化时单独切回 false
- 阶段 8 验收时只把 3-5 个核心分析模块切到 true，其他保 false
- 后续迭代逐步推进

**完成阶段 8 后**：完成整个 AI 基建统一改造，可以删除 `registerLegacyRunners`（不再需要 case-analysis 走 legacy）。

---

## 阶段 1/2 沉淀的工具

- `scripts/stage2-regression.sh`：阶段 2 全量回归脚本（typecheck + 关键测试 + 工作区干净检查 + tag 命令提示）
- 后续阶段可仿写 `stage{N}-regression.sh`（**不要**复用 stage2 脚本，每阶段独立产物）

## 收尾遗留 issue（不阻塞，记录给后续阶段知情）

1. **`tests/server/assistant/assistantAgent.integration.test.ts` 1 fail**：测试 DB `ls_new_testing` 中 `assistantMain` 节点 seed 数据缺失（"通用法律助手主Agent 节点未配置或未启用"）。pre-existing。建议在阶段 3 时顺手修测试库 seed。
2. **`tests/server/agent/agentRun.dao.test.ts` 2 个 pre-existing fail**：partial unique index + 测试隔离问题。阶段 1 起就存在。
3. **HNSW 索引每次 prisma migrate dev 会被 DROP**：项目级权衡。每次 migrate 后需补 `restore_hnsw_indexes` migration。阶段 3 不涉及 schema 改动，应不会触发。阶段 8 涉及节点 schema 变更时需注意。
4. **app.vue route depth typecheck error**：Nuxt 路由类型递归过深的历史问题，与本改造无关。

---

## 启动新阶段时的最佳实践

1. **read 本文档**找到下一个待做阶段
2. **read spec § 6 对应阶段章节**了解 DoD
3. **`git log --oneline ai-unify-stage-N-1-done..HEAD`** 看上一阶段做了什么（如有遗留改动）
4. 用 `superpowers:writing-plans` skill 生成 plan 文档（参考阶段 1/2 plan 格式）
5. 用 `superpowers:subagent-driven-development` skill 或 TeamCreate 团队模式执行
6. 完成后跑回归脚本（如有）+ 打 tag `ai-unify-stage-N-done`
7. **更新本文档**："已完成"打 ✓ + 更新 tags 列表 + 追加遗留 issue + commit

每阶段完成后用一致的提交信息：`docs(stageN): 阶段 N 完成更新交接说明`。
