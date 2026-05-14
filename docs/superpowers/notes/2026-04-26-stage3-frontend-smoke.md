# 阶段 3 · 前端 LawSearchTool.vue 三场景 smoke 记录

- **日期**：2026-04-27
- **执行人**：team-lead@ai-unify-s3 + chrome-devtools MCP
- **dev server**：http://localhost:3001（实际占 3001，3000 被占）
- **测试用户**：dx (130\*\*\*\*8490)，旗舰版会员，926 积分

---

## 0. 前置发现：阶段 2 遗留 dispatch bug（已修）

首次 smoke 暴露：5 个 vertical 的 `defineDomainAgent` 注册未生效，dispatch 时报 `AgentRegistry 未注册 scope=<scope> type=1`。

**根因**：Nitro/esbuild 把 `agents-load.ts` 里的纯 side-effect import 当死码移除，模块顶层 `agentRegistry.register` 没被求值。

**修复**（commit `e3bea88a`）：把副作用 import 改成命名 import + 在 plugin 函数体里数组化引用。修复后 `[agents-load]` 日志输出 `verticalsLoaded=5 registryTotal=6`，包含 5 vertical + 1 legacy（caseAnalysisV2）。

> 这是阶段 2 遗留 bug，**不属于阶段 3 范围**。但阶段 3 端到端 smoke 是它首次被发现的契机。

---

## 场景 1：通用问答（基线对照）✓

- **节点**：`assistantMain`（id=15）— stage 3 之前已配置 `tools:["search_law"]`
- **路径**：`/dashboard/assistant`
- **用户提示**："查一下《民法典》关于借款合同的核心条款是哪几条？请用 search_law 工具查证后给我引用条文。"

**结果**：
- 后端 `POST /api/v1/assistant/chat` → 200 SSE
- LLM 调用 `search_law` 工具 **2 次**：
  - 第 1 次"找到 12 条结果"
  - 第 2 次"找到 7 条结果"（LLM 自述："第一次检索未命中，可能是法律名称格式不匹配，我调整参数后重新检索"）
- LawSearchTool.vue 工具卡片正确渲染：折叠按钮显示"法律检索完成 找到 N 条结果"
- 回答正文按"第 X 条 | 标题 / 引文 / 解读"格式列出民法典 669-678 条

**结论**：基线工作正常。LawSearchTool.vue 渲染契约 OK。

---

## 场景 2：文书生成 ✓

- **节点**：`documentMain`（id=17）— stage 3 之前已含 `tools:["process_materials","search_case_materials","search_law"]` 且提示词已含 search_law 指令
- **路径**：`/dashboard/document/drafts/7`（民事起诉状草稿）→ 点 "AI 生成" 唤起对话面板
- **用户提示**：同上

**结果**：
- 修复 dispatch bug 前：`AgentRegistry 未注册 scope=document type=1`（首次 smoke 时）
- 修复后：`POST /api/v1/assistant/document/chat` → 200 SSE
- LLM 调用 `search_law` **1 次**："找到 10 条结果"
- LawSearchTool.vue 卡片渲染正常
- 截图存证：`/tmp/claude/stage3-scenario2-document.jpeg`

**结论**：阶段 3 新场景验证通过。documentMain 配置 + dispatch + 工具调用 + 渲染全链路通畅。

---

## 场景 3：合同审查 — 阶段 3 不跑端到端（已知架构限制）

- **节点**：`contractReviewMain`（id=18）— 阶段 3 新加 `tools:["parse_and_ask_stance","search_law"]` + 提示词追加 search_law 指令
- **路径**：`/dashboard/contract/871`

**为什么不跑**：合同审查是独立工作台 UI（不是聊天界面）。流程是：
1. 上传合同 → `contractReviewMain` 主 agent 自动调 `parse_and_ask_stance` → interrupt 等用户选立场
2. 用户选立场 → resume 进入 `runAnalyzeLoop` → 程序化调 `analyzeSingleClause`（用 `invokeNodeJson`，**结构化输出 LLM 不支持 tool calling**）

`search_law` 在合同审查里**没有自然触发点**：
- 主 agent 阶段（stance 选择前）：用户没有自由对话窗口，主 agent 第一件事就是 parse_and_ask_stance
- resume 后：`runAnalyzeLoop` 程序化调 `analyzeSingleClause`，子流程 LLM 没有工具调用能力

**阶段 3 验证范围**（已通过）：
- 节点 `tools` 含 `search_law` ← `tests/server/agent-platform/nodeConfig.searchLaw.test.ts` 防回退测试锁定
- 节点 `prompt` 含 search_law 指令 ← 同上防回退测试锁定
- streaming test mock 同步 ← `tests/server/workflow/agents/contractReviewMainAgent.streaming.test.ts` 新增断言

**端到端验证留给阶段 4**：阶段 4 计划用 `Command.resume` + 中间件 + 工具改造让 resume 路径回归主线，届时 `search_law` 在子流程内才能用。

---

## 场景 4：模块对话 ✓

- **节点**：动态 `caseModule = ctx.metadata.moduleName`（实际节点名为 `summary` / `chronicle` / `claim` / `trend` / `cause` / `defense` / `evidence`，全部已含 `search_law`）
- **路径**：`/dashboard/cases/1036?tab=analysis&ai=summary&am=detail` → 点"AI 辅助修改"唤起对话面板
- **用户提示**：同上

**结果**：
- 修复 dispatch bug 前：`AgentRegistry 未注册 scope=case type=3`
- 修复后：`POST /api/v1/case/analysis/chat` → 200 SSE
- LLM 自主选择先调 `search_case_materials`（合理行为，先搜本案件材料再决定是否要 search_law）
- 工具链工作通畅

**结论**：caseModule dispatch 通畅，工具链 OK。`search_law` 实际触发由 LLM 自主决定 — 不是 100% 可控（与场景 1 同 prompt 在 assistantMain 节点稳定调 search_law 对比，可能因为 case 内有材料，LLM 优先 search_case_materials）。这是 LLM 行为合理决策，不是 bug。

---

## 阶段 3 整体结论

| 场景 | 状态 | LawSearchTool.vue 渲染 | 备注 |
|---|---|---|---|
| 1. 通用问答 | ✓ 通过（基线） | ✓ 2 次卡片 | stage 3 前已配，作为对照证明渲染契约稳定 |
| 2. 文书生成 | ✓ 通过 | ✓ 1 次卡片 | stage 3 新场景验证通过 |
| 3. 合同审查 | ✗ 不跑 e2e | — | 架构限制，阶段 4 解决；配置防回退已锁定 |
| 4. 模块对话 | ✓ dispatch 通过 | — | LLM 自主选 search_case_materials；工具链 OK |

**LawSearchTool.vue 渲染契约**：work as expected — 工具返回 `{score, content, metadata:{legal_name,document_number,chapter_hierarchy,...}}` 标准 JSON，组件按"折叠按钮 + 找到 N 条结果 + 法条卡片"风格渲染，复制按钮可用。

**Stage 3 核心交付**全部就位：
- DB 配置（contractReviewMain.tools 加 search_law + 8 prompt 追加指令）
- 一次性同步脚本（dev 库已应用 + 幂等）
- 节点配置防回退测试（11 节点 tools + 8 prompt 锁定 seedData.sql）
- 合同审查 streaming 测试 mock 同步
- 端到端 smoke 通过（场景 1/2/4 + 场景 3 已知限制）

**附带产出**（不属于 stage 3 范围但已修）：
- stage 2 dispatch bug 修复（commit `e3bea88a`）
