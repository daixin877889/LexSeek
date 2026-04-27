# 阶段 4 → 阶段 5 交接说明（新会话起手必读）

> 这份文档让新会话主 agent 快速了解"现在在哪里、下一步做什么"，避免逐个 read plan 文件。

## 已完成

- **阶段 1** (tag `ai-unify-stage-1-done`)：底座类型化 + Skills 入库 + Agent Registry。22 commits。
- **阶段 2** (tag `ai-unify-stage-2-done`)：Agent 工厂化 + 业务 vertical + Skills 入网。约 40 commits。
- **阶段 3** (tag `ai-unify-stage-3-done`)：search_law 普及。20 commits。
- **阶段 4** (tag `ai-unify-stage-4-done`)：合同审查接入底座（C+ 方案）。15 commits（含 stage2 dispatch fix 之后到 stage 4 之间累计的 fix 和测试同步）。
  - 平台 stateGraph 路径升级（`runStateGraphAgent` + `customEventEmitter` + `StateGraphAgentContext`）
  - contract vertical 收敛细节（emitter / nodeConfig 由平台注入；runContractReviewChat 内部行为完全保留）
  - contractReviewMain 节点关联 docx skill（seedData + 同步脚本 + 防回退测试）
  - 端到端 smoke 通过：上传合同 → 立场 interrupt → resume → 6 风险识别 → 持久化
  - SSE 事件契约 byte-for-byte 一致（前端契约 100% 不动）
  - **附带修复**：fix(stage4) 平台 catch 不重复发 status_change（agentWorker 顶层已发）

## 阶段 4 执行模式

阶段 4 用 **TeamCreate (`ai-unify-s4`)** + 3 teammate（platform-runtime + docx-skill + vertical-integration）。
工程量：1 天（plan 估 5-7 天，因为 C+ 方案大幅缩小改造范围 + 现有代码已就位）。
关键事件：
- spec §6 阶段 4 完成定义与 §0 总览矛盾，本阶段修订（C+ 方案）
- platform-runtime 完成 Task 2-5 后正确指出 status_change 重复发的设计 bug，主 lead 修订
- docx-skill teammate 卡死（请求 docker 检查后无响应），主 lead 接管 Task 8
- vertical-integration teammate 顺手修了 3 个 test-db-helper FK 顺序问题（独立 commit）
- stage4 回归脚本暴露 11 个测试隔离问题，独立 chore(test) commit

## 下一步：阶段 5 法律助手 → 文书 / 合同（无 caseId）

**spec 章节**：`docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md` §6 阶段 5

**简述**（1-2 周工程量，**用户可见**）：
- `server/services/agent-platform/tools/draftDocument.tool.ts` + `reviewContract.tool.ts` 实现（子代理工具）
- 法律助手节点配置（assistantMain）的 nodes.tools 加 `draft_document` + `review_contract`
- 法律助手节点接入全部 6 个 skills
- `app/components/agents/document/tools/DraftDocumentCard.vue` + `ReviewContractCard.vue` 实现
- 跳转协议落地：`?from=&caseId=&sessionId=`
- 文书页 + 合同工作台顶部"来源色彩条 + 返回链接 + 关联案件按钮"
- `PATCH /api/v1/assistant/document/drafts/:id { caseId }` + `PATCH /api/v1/assistant/contract/reviews/:id { caseId }` 接口

**完成定义**（来自 spec §6 阶段 5）：
- E2E 1：法律助手输入"帮我起草起诉状" → 工具卡片"已完成" → 跳文书页 → "+关联案件"成功
- E2E 2：法律助手输入"审一下这份合同"（拖入 docx）→ 工具卡片含 Top 风险 → 跳工作台 → "+关联案件"成功
- 验证返回链接能回到法律助手并继续对话

## 阶段 5 启动建议

```
新会话第一条消息：
继续 LexSeek AI 基建统一改造。阶段 4 已完成（tag: ai-unify-stage-4-done）。
请按 spec docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md
§6 阶段 5 章节用 superpowers:writing-plans skill 生成 plan 并执行。
启动前先 read 本 handoff 文档：
docs/superpowers/notes/2026-04-27-stage4-to-stage5-handoff.md
```

## 阶段 4 收尾遗留 issue

记录给阶段 5 知情，**不阻塞**：

### 1. docx skill 工具未自动注入到 stateGraph 路径（架构盲点）

**症状**：合同审查 LLM 工具列表 `toolsCount=2`（仅 parse_and_ask_stance + search_law）。stage 4 接入的 docx skill 关联了，但 4 个 skill 工具（read/write/run_script/run_command）没自动挂载到 contract vertical 的 LLM。

**根因**：spec §3.5.5 的"4 个 skill 工具自动跟随节点 skill 关联"在 `runDomainAgent`（createAgent 路径）里实现。stateGraph 路径的 `runStateGraphAgent` 没有等价机制，contract vertical 自己控制 tools 列表，未读 ctx.nodeConfig 关联的 skills。

**影响评估**：合同审查实际功能不缺（LLM 工作集中在 parseAndAskStance + interrupt + 程序化 runAnalyzeLoop）。node_skills 关联仍有效（admin 后台展示 OK，未来其他地方需要可读取）。

**处置建议**：阶段 7（前端复用收敛）时一并处理，因为同时影响 caseModule（同走 stateGraph）。两条路径任选：
- (a) 在 `runStateGraphAgent` 内部加 skill 工具集合到 ctx，让 stateGraph 业务自己决定要不要挂
- (b) 在每个 stateGraph vertical 的 runStateGraph 内主动读 ctx.nodeConfig 关联的 skills

### 2. 风险卡片"未定位" badge UI bug（pre-existing）

**症状**：合同分析完成后，风险卡片全部显示"未定位"badge。刷新页面有时能修复。

**调研根因**：DB anchor 数据完好（`anchor_paragraph_index` 都有值）；前端 `clauseLocator` 仅基于 `clauseText` 文本匹配，v1 reviewed docx 注入批注后段落 textContent 与原 anchor_quote 因全角/半角/特殊空格等微差异致匹配失败。

**处置建议**：
- 短期：clauseLocator 加优先级 1 — 用 `risk.anchorParagraphIndex` 直接定位 DOM 第 N 个 `<p>`
- 长期：服务端在 v1 快照写入时同时计算 paragraph_index 在 reviewed docx 里的最终 char range
- **与 stage 4 无关**，但用户已两次反馈，建议优先处理

### 3. LangGraph checkpoints 表不存在（dev 库）

**症状**：每次 chat 启动报 `relation "checkpoints" does not exist`。

**根因**：dev 库（ls_new）从来没初始化 LangGraph PostgresSaver 的 checkpoints 表。功能没受影响（lazy repair try/catch 后跳过）。

**影响评估**：仅日志噪声。

### 4. LangSmith 429 配额耗尽（外部服务）

**症状**：`Failed to send multipart request. Received status [429]: tenant exceeded usage limits`。

**影响评估**：仅 telemetry，业务不依赖。

### 5. 4 个 pre-existing test failure（agentRun.* / agentWorker test）

**症状**：测试隔离问题（cases_pkey UniqueConstraintViolation / case_types FK 清理顺序）。stage 1 起就存在。

**影响评估**：stage 4 回归脚本不跑这 4 个文件（专注 stage 4 + 合同审查 + 业务 streaming），所以 5/5 全 PASS。但全量 `bun run test` 仍会失败这 4 个。

**处置建议**：阶段 8 收尾时统一治理。

### 6. 工作区漂移文件（pre-existing）

**症状**：`bun.lock / package.json / vitest.config.ts` 持续在工作区显示 modified。

**影响评估**：与 stage 1-4 主线无关，仅是依赖锁/配置漂移。回归脚本已显式忽略这 3 个文件。

## 阶段 5 → 8 后续路线

| 阶段 | 工程量 | 关键产出 |
|---|---|---|
| 5 | 1-2 周 | 法律助手 → 文书 / 合同（无 caseId 启动 + 工具卡片设计 + 跳转协议）|
| 6 | 1 周 | 小索 → 文书 / 合同（带 caseId 透传）|
| 7 | 1-2 周 | 前端复用收敛（useStreamChat 工厂、interrupt 注册表、6 个业务 composable 收敛）+ stateGraph 路径 skill 工具自动注入修复 |
| 8 | 1 周 | 案件初分接 skills + 提示词改造 |

## 关键架构事实（避免新会话误改）

- **平台两路径**：createAgent (runDomainAgent) 和 stateGraph (runStateGraphAgent) 都已就位且功能完整
- **stateGraph 路径职责**：仅承接 nodeConfig 加载 + customEventEmitter 注入 + 错误兜底 + before/afterRun 钩子。**不自动跑中间件、不自动挂 skill 工具、不强制 checkpointer** — 业务自己决定
- **StateGraphAgentContext** 类型继承 AgentRunnerContext，旧业务不读新字段（nodeConfig / emitCustomEvent）就不会 break
- **合同审查 resume 路径继续不走 Command.resume**（C+ 决策）：后端 /stance enqueue 新 run + 前端 stream.reset()+submit() 模式保留
- **emitContractReviewEvent 向后兼容**：platformEmit 不存在时 fallback 自调 publishCustomEvent
- **registry 6 个 entry**（5 vertical + 1 legacy caseAnalysisV2），nitro 启动日志 `[agents-load] verticalsLoaded=5 registryTotal=6` 一眼可见
- **agentWorker 顶层 publishStatusChange**（agentWorker.ts:341）统一发 failed 事件，平台层不重复发
- **node_skills 关联机制**：DB 有效但 stateGraph 路径不自动注入 skill 工具（finding 1）

## 阶段 4 沉淀的工具

- `scripts/stage4-apply-contract-skill.ts`：一次性同步脚本（幂等），跑过即归档
- `scripts/stage4-regression.sh`：阶段 4 全量回归脚本（typecheck + 阶段 4 测试 + 合同审查 5 文件 + 平台库 + 业务 streaming + 工作区干净检查）
- 后续阶段可仿写 stageN-regression.sh

## 关键 commit 速览（阶段 4 范围，按时间倒序）

```
d564d2b1 chore(stage4): 阶段 4 全量回归脚本
2915b879 chore(test): 测试隔离与 mock 同步（stage4 回归触发）
b8133ecf docs(stage4): 端到端 smoke 与 SSE 契约验证记录
9e2c1999 fix(test): 修测试 cleanup 顺序处理 document_drafts FK 约束
96fb09a5 feat(stage4): contractReviewMain 节点关联 docx skill
b769f7d9 feat(stage4): contract vertical 接入平台 stateGraph ctx
baacad8e fix(stage4): 平台 stateGraph 路径不再重复发 status_change 事件
31c7569a test(stage4): runStateGraphAgent 单测
b814aef1 feat(stage4): 平台 stateGraph 路径升级 — runStateGraphAgent
0b92eea2 feat(stage4): 通用 customEventEmitter 工厂 + 单测
3fb8eaca feat(stage4): 平台 factory types 新增 StateGraphAgentContext
cce3aa8a docs(stage4): 阶段 4 plan + spec §6 阶段 4 修订（C+ 方案）
2b062970 docs(spec): 阶段 4 合同审查接入底座方案改为 C+
```

---

新会话起手时建议先 `git log --oneline ai-unify-stage-3-done..ai-unify-stage-4-done` 速览阶段 4 的 commit，再 read 本文档 + spec §6 阶段 5。
