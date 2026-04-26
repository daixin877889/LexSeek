# 阶段 2 → 阶段 3 交接说明（新会话起手必读）

> 这份文档让新会话主 agent 快速了解"现在在哪里、下一步做什么"，避免逐个 read plan 文件。

## 已完成

- **阶段 1** (tag `ai-unify-stage-1-done`)：底座类型化 + Skills 入库 + Agent Registry。22 commits。
- **阶段 2** (tag `ai-unify-stage-2-done`)：Agent 工厂化 + 业务 vertical + Skills 入网。约 40 commits。
  - 平台库 `server/services/agent-platform/`：factory / registry / middleware / tools / nodeConfig / context / state / sse / skills 完整就绪
  - 业务 vertical `server/agents/{case-main,case-module,legal-assistant,document,contract}/` 5 个 vertical 全部接入 `defineDomainAgent`
  - `server/plugins/agents-load.ts`：5 vertical 自动注册到 agentRegistry；`registerLegacyRunners` 仅保留 caseAnalysisV2（待阶段 8）
  - 后台 admin skills CRUD + 节点关联 skills chip 多选 UI 上线
  - 测试：33 测试文件 367 测试 PASS（typecheck 仅 app.vue 历史路由深度问题）

## 阶段 2 执行模式

阶段 1 我自己 + subagent 串行；阶段 2 用 **TeamCreate (`ai-unify-s2`)** + 4 teammate 并行（impl-alpha/bravo/charlie/delta）+ task list with blockedBy 依赖图。此模式效率高 3-5 倍。新会话可参考此模式做后续阶段。

## 下一步：阶段 3 search_law 普及

**spec 章节**：`docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md` §6 阶段 3

**简述**（2-3 天工程量）：
- 在管理后台把 `search_law` 工具加到三个节点的 `nodes.tools`：`caseModule` / `documentMain` / `contractReviewMain`
- 三个节点的 system prompt 末尾追加"必要时引用法条，使用 search_law 工具"指令（修改 prompts 表对应记录）
- 前端 `app/components/ai/tools/LawSearchTool.vue` 在新场景下渲染验证

**完成定义**（来自 spec §6 阶段 3）：
- 三个节点的 nodes.tools 含 search_law
- 三个 prompts 更新追加引用指令
- E2E 验证：模块对话 / 文书生成 / 合同审查 三个场景下用户提含法条问题，回答附法条出处

**风险点（来自 spec §7）**：
- 阶段 3 是配置改一行级别，风险极低
- 唯一关注：合同审查在 `analyzeSingleClause` 等子流程里，需确认 search_law 能在子代理工具调用链里正常工作

## 阶段 3 启动建议

```
新会话第一条消息：
继续 LexSeek AI 基建统一改造。阶段 2 已完成（tag: ai-unify-stage-2-done）。
请按 spec docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md
§6 阶段 3 章节用 superpowers:writing-plans skill 生成 plan 并执行。
启动前先 read 本 handoff 文档：
docs/superpowers/notes/2026-04-26-stage2-to-stage3-handoff.md
```

## 阶段 2 收尾遗留 issue

记录给阶段 3 知情，**不阻塞**：

1. **`tests/server/assistant/assistantAgent.integration.test.ts` 1 fail**：测试 DB `ls_new_testing` 中 `assistantMain` 节点 seed 数据缺失（"通用法律助手主Agent 节点未配置或未启用"）。pre-existing，与阶段 2 无关。建议在阶段 3 时顺手修测试库 seed。

2. **`tests/server/agent/agentRun.dao.test.ts` 2 个 pre-existing fail**：partial unique index + 测试隔离问题。阶段 1 起就存在，与阶段 2 无关。

3. **HNSW 索引每次 prisma migrate dev 会被 DROP**：项目级权衡，阶段 1 已记录。每次 migrate 后需要补 `restore_hnsw_indexes` migration。阶段 3 不涉及 schema 改动，应不会触发。

4. **app.vue route depth typecheck error**：Nuxt 路由类型递归过深的历史问题，与本改造无关。

## 阶段 3 → 8 后续路线

| 阶段 | 工程量 | 关键产出 |
|---|---|---|
| 3 | 2-3 天 | search_law 普及（轻量配置）|
| 4 | 1-2 周 | 合同审查接底座（resume 路径重写，关键风险）|
| 5 | 1-2 周 | 法律助手 → 文书 / 合同（无 caseId 启动 + 工具卡片设计 + 跳转协议）|
| 6 | 1 周 | 小索 → 文书 / 合同（带 caseId 透传）|
| 7 | 1-2 周 | 前端复用收敛（useStreamChat 工厂、interrupt 注册表、6 个业务 composable 收敛）|
| 8 | 1 周 | 案件初分接 skills + 提示词改造（`useSkillsAsLogic` 字段已存在，可逐节点切换）|

## 关键架构事实（避免新会话误改）

- **case-analysis 仍走 legacy**（`registerLegacyRunners` 中保留 `(CASE, ANALYSIS)`），由阶段 8 接入
- **caseSessions.scope 双域**：'case' / 'assistant' / 'document' / 'contract'，都是 enum `SessionScope`
- **agentRegistry 单例**：6 个 entry（5 vertical + caseAnalysisV2 legacy）
- **节点动态 nodeName**：case-module 用 `(ctx) => ctx.metadata.moduleName`，工厂 runtime.ts 已支持
- **Skills 工具自动跟随**：节点关联了任意 skill，4 个 skill 工具自动注入，不需要 nodes.tools 配置
- **测试 vi.mock 必须 mock 真实路径**（不是 shim）—— 业务搬迁时测试 import 路径要同步

## 阶段 1/2 沉淀的工具

- `scripts/stage2-regression.sh`：阶段 2 全量回归脚本（typecheck + 关键测试 + 工作区干净检查 + tag 命令提示）。阶段 3 后续可仿写 stage3-regression.sh。

---

新会话起手时建议先 `git log --oneline ai-unify-stage-1-done..ai-unify-stage-2-done` 速览阶段 2 的 commit，再 read 本文档 + spec §6 阶段 3。
