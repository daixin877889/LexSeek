# 阶段 3 → 阶段 4 交接说明（新会话起手必读）

> 这份文档让新会话主 agent 快速了解"现在在哪里、下一步做什么"，避免逐个 read plan 文件。

## 已完成

- **阶段 1** (tag `ai-unify-stage-1-done`)：底座类型化 + Skills 入库 + Agent Registry。22 commits。
- **阶段 2** (tag `ai-unify-stage-2-done`)：Agent 工厂化 + 业务 vertical + Skills 入网。约 40 commits。
- **阶段 3** (tag `ai-unify-stage-3-done`)：search_law 普及。20 commits。
  - `contractReviewMain` 节点 tools 加 `search_law` + prompt 追加指令
  - 7 个分析模块节点（summary/chronicle/claim/trend/cause/defense/evidence）prompt 末尾追加 search_law 指令
  - 一次性同步脚本 `scripts/stage3-apply-search-law.ts`（dev 库已应用，幂等通过）
  - 防回退测试 `tests/server/agent-platform/nodeConfig.searchLaw.test.ts`（锁定 seedData.sql 11 节点 + 8 prompt）
  - 合同审查 streaming test mock 同步
  - 端到端 smoke：法律助手 ✓ / 文书生成 ✓ / 模块对话 ✓（dispatch 通畅）
  - 合同审查端到端 ✗：架构限制（resume 后子流程 invokeNodeJson 不支持 tool calling），阶段 4 解决
  - **附带 stage 2 dispatch bug 修复**（agents-load.ts tree-shake 致 5 vertical 未注册，commit `e3bea88a`）

## 阶段 3 执行模式

阶段 3 用 **TeamCreate (`ai-unify-s3`)** + 2 teammate（data-config + tests-frontend）+ 主 lead 协调。
工程量比预期小（实际 1 天，plan 估 2-3 天），并行机会有限（Task 2-3-4 强串行）。
关键事件：
- data-config teammate 跑全量测试触发 7 个 pre-existing 测试失败，顺手修了（cb27a29a 等 commit）
- data-config teammate Task 4（同步脚本）卡住，主 lead 接手 5 分钟完成
- 端到端 smoke 暴露 stage 2 dispatch bug，主 lead 修复（不阻塞 stage 3 收尾）

## 下一步：阶段 4 合同审查接入底座

**spec 章节**：`docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md` §6 阶段 4

**简述**（1-2 周工程量，**spec 标记为高风险**）：
- `server/agents/contract/agent.config.ts` 改用 `defineDomainAgent`（已经是 stateGraph 形态，但 runStateGraph 内部仍走绕过 agent.stream 的旧 resume 路径）
- **重写 resume 路径**：用 LangGraph `Command.resume` + 中间件 + 工具完成多阶段流程，**不再绕过 `agent.stream`**
- `parseAndAskStance` 工具保留（合同私有）
- `runAnalyzeLoop` / `summarizeOverview` 改造为标准 tool 或 middleware（plan 阶段决定）
- 合同审查接入 docx skill（添加 node_skills 关联）
- 合同审查独立工作台 UI 完全不变

**完成定义**（来自 spec §6 阶段 4）：
- 全功能 E2E：上传合同 → 解析 → 立场选择 interrupt → resume → 风险列表 → 编辑 → 导出 docx
- 对比改造前后 SSE 事件序列，用户感知一致
- `useContractReview` composable 改用 `useDomainAgentSession` 后行为不退化

**风险**：spec §7 标为"高"，需 1-2 周回归 + SSE 事件序列录像对比；保留旧 resume 函数 1 个迭代作为对照

**阶段 3 留下的合同审查相关 finding**（启动阶段 4 时确认）：
- `analyzeSingleClause` 通过 `invokeNodeJson` → 结构化输出 LLM 调用 → **不支持 tool calling**
- 这是 search_law 在合同审查 resume 后子流程不可用的根因
- 阶段 4 方案如选 "Command.resume + 中间件 + 工具" 路线，子流程要换成支持 tool calling 的 ReAct 形态，否则 search_law 仍不可用

## 阶段 4 启动建议

```
新会话第一条消息：
继续 LexSeek AI 基建统一改造。阶段 3 已完成（tag: ai-unify-stage-3-done）。
请按 spec docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md
§6 阶段 4 章节用 superpowers:writing-plans skill 生成 plan 并执行。
启动前先 read 本 handoff 文档：
docs/superpowers/notes/2026-04-27-stage3-to-stage4-handoff.md
重点关注 stage 3 留下的 analyzeSingleClause / invokeNodeJson 限制。
```

## 阶段 3 收尾遗留 issue

记录给阶段 4 知情，**不阻塞**：

1. **`tests/server/agent/agentRun.{coverage,dao,service}.test.ts` + `agentWorker.test.ts` 4 个 pre-existing fail**：测试隔离问题（`cases_pkey UniqueConstraintViolation`、`case_types FK` 清理顺序）。stage 1 起就存在，与 stage 2/3 无关。`a75209fb` commit "局部 sequence 重置避免全量套件中 ID 冲突" 部分缓解但未根治。

2. **`searchLawTool` 旧名残留**（pre-existing，不阻塞）：summary/claim/trend/cause 提示词内多处 `searchLawTool` 旧名（不是 stage 3 新引入），与 `tools/index.ts` 注册的新名 `search_law` 不一致。LLM 看到旧名提示词后会 fallback 到 search_law（容错），但未来提示词改造（阶段 8）时统一改名。

3. **HNSW 索引每次 prisma migrate dev 会被 DROP**：项目级权衡，stage 1 已记录。stage 3 不涉及 schema 改动，未触发。

4. **app.vue route depth typecheck error**：Nuxt 路由类型递归过深的历史问题，与本改造无关。

## 阶段 3 → 8 后续路线

| 阶段 | 工程量 | 关键产出 |
|---|---|---|
| 4 | 1-2 周 | 合同审查接底座（resume 路径重写，关键风险）|
| 5 | 1-2 周 | 法律助手 → 文书 / 合同（无 caseId 启动 + 工具卡片设计 + 跳转协议）|
| 6 | 1 周 | 小索 → 文书 / 合同（带 caseId 透传）|
| 7 | 1-2 周 | 前端复用收敛（useStreamChat 工厂、interrupt 注册表、6 个业务 composable 收敛）|
| 8 | 1 周 | 案件初分接 skills + 提示词改造（`useSkillsAsLogic` 字段已存在，可逐节点切换）|

## 关键架构事实（避免新会话误改）

- **case-analysis 仍走 legacy**（`registerLegacyRunners` 中保留 `(CASE, ANALYSIS)`），由阶段 8 接入
- **caseSessions.scope 双域**：'case' / 'assistant' / 'document' / 'contract'，都是 enum `SessionScope`
- **agentRegistry 6 个 entry**（5 vertical + caseAnalysisV2 legacy），可在 nitro 启动日志看到
- **节点动态 nodeName**：case-module 用 `(ctx) => ctx.metadata.moduleName`，工厂 runtime.ts 已支持
- **Skills 工具自动跟随**：节点关联了任意 skill，4 个 skill 工具自动注入，不需要 nodes.tools 配置
- **caseModule 不是单一节点**：是 7 个分析节点的集合，每个有自己的 prompt（summary/chronicle/...）
- **测试库 ls_new_testing 不 seed 节点**：测试按需 mock 或单点 seed；防回退测试因此采用"读 seedData.sql 文本锁定"策略而非连 DB 查
- **vertical 注册必须命名 import**：纯 side-effect import 会被 esbuild tree-shake，详见 commit `e3bea88a`

## 阶段 3 沉淀的工具

- `scripts/stage3-apply-search-law.ts`：一次性同步脚本（幂等），跑过即归档
- `scripts/stage3-regression.sh`：阶段 3 全量回归脚本（typecheck + 关键测试 + 工作区干净检查 + tag 命令提示）
- 阶段 4 后续可仿写 stage4-regression.sh

## 关键 commit 速览（按时间倒序）

```
42062a3d chore(stage3): 阶段 3 全量回归脚本
8cfd6e0f chore(test): vitest coverage 路径与排除项调整
cd907eee docs(stage3): 前端 LawSearchTool 三场景 smoke 记录 + dev launch 配置
e3bea88a fix(stage2): vertical agent.config 改用命名 import 显式引用
a75209fb test: 局部 sequence 重置避免全量套件中 ID 冲突
fbb1cba4 test(stage3): 节点配置防回退测试 — 锁定 seedData.sql
fe3b4601 chore(stage3): 一次性 search_law 配置同步脚本
a3537a58 feat(prompts): 8 个 prompts 末尾追加 search_law 工具使用指令
e82f3bc7 test(contract): 流式测试 mock 同步 search_law 工具
87389da2 feat(contract): seedData 给 contractReviewMain 节点加 search_law 工具
58d39701 docs(stage3): 阶段 3 search_law 普及实施计划
```

---

新会话起手时建议先 `git log --oneline ai-unify-stage-2-done..ai-unify-stage-3-done` 速览阶段 3 的 commit，再 read 本文档 + spec §6 阶段 4。
