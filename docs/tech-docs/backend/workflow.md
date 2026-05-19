# LangGraph AI 编排模块

`server/services/workflow/` 承载案件分析 StateGraph 工作流的图定义与执行器，并保留一批向后兼容的 re-export shim。

> **重要现状**：本目录在 agent-platform 化改造后已大幅瘦身。绝大多数通用工具、通用中间件、上下文管理代码的**实体已迁出**——分别落到 `server/services/agent-platform/**` 与 `server/agents/**`，本目录对应文件仅作为 `export * from ...` 的兼容 shim 保留旧 import 路径。真正还住在本目录的实体只有：案件分析 StateGraph（`caseAnalysisV2.*`）、`repairOrphanToolUse.ts`、`agents/` 下的几个对话式 Agent、`callbacks/` 与 `nodes/` 两个小文件。

## 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    API Layer                             │
│  入队 agent_runs 任务（按 session scope/type）            │
└──────────────┬──────────────────────────────┬────────────┘
               │                              │
               ▼                              ▼
┌──────────────────────┐    ┌────────────────────────────┐
│  agentRun.service     │    │  agentWorker               │
│  入队 → Redis 通知    │───▶│  取任务 → 执行 → 心跳      │
└──────────────────────┘    └──────────┬─────────────────┘
                                       │ agentRegistry.dispatch
                                       │ ({ scope, type, ... })
                                       ▼
                          ┌────────────────────────────┐
                          │  agent-platform Registry    │
                          │  按 (scope,type) 路由 runner │
                          └────────────┬───────────────┘
                                       │
               ┌───────────────────────┼───────────────────┐
               ▼                       ▼                   ▼
        案件分析 vertical        案件主对话 vertical    其他 vertical
   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
   │caseAnalysisV2    │  │caseMainAgent     │  │moduleAgent /     │
   │结构化批量分析     │  │对话式主Agent      │  │assistant / 合同 …│
   │(StateGraph)      │  │(createAgent)     │  │(createAgent)     │
   └──────────────────┘  └──────────────────┘  └──────────────────┘
```

**派发机制**：`agentWorker` 不再用 `session.type` 写死 type=1/2/3 的 if-else 路由。它把 `(scope, type, caseId, userId)` 交给 `agentRegistry.dispatch`（`server/services/agent-platform/registry/agentRegistry.ts`）统一派发——各业务 vertical 通过 `defineDomainAgent` 工厂把自己的 runner 注册进来，`dispatch` 先精确匹配 `(scope, type)`、未命中再降级匹配 `(scope, null)`。本文档只覆盖案件分析 StateGraph；vertical 注册与中间件栈详见 [tech-docs/patterns/workflow-middleware.md](../patterns/workflow-middleware.md)。

## 文件清单

```
server/services/workflow/
├── caseAnalysisV2.workflow.ts    # 案件分析 StateGraph 图定义（核心，实体）
├── caseAnalysisV2.executor.ts    # 案件分析执行入口，返回 SSE stream（实体）
├── repairOrphanToolUse.ts        # 修复 checkpoint 中的 orphan tool_use（实体）
├── checkpointer.ts               # shim → agent-platform/checkpointer
├── agents/
│   ├── assistantAgent.ts         # 通用问答主代理（assistantMain 节点，实体）
│   ├── caseMainAgent.ts          # 案件主代理工具：仅保留 getChatThreadState（实体）
│   ├── contractReviewMainAgent.ts # 合同审查主代理（实体）
│   ├── documentMainAgent.ts      # 文书生成主代理（实体）
│   ├── moduleAgent.ts            # 模块对话 Agent（实体）
│   ├── subAgentToolFactory.ts    # shim → agent-platform/subAgent/subAgentToolFactory
│   ├── threadState.ts            # 线程状态读取 / 消息格式转换（实体）
│   └── index.ts                  # agents 聚合导出
├── callbacks/
│   └── LLMUsageCallbackHandler.ts # LangChain 回调，采集 LLM token 用量（实体）
├── context/
│   ├── contextErrorLogger.ts     # shim → agent-platform/context/contextErrorLogger
│   ├── messageCompressor.ts      # shim → agent-platform/context/messageCompressor
│   ├── moduleContextBuilder.ts   # shim → agent-platform/context/moduleContextBuilder
│   └── toolResultTruncator.ts    # shim → agent-platform/context/toolResultTruncator
├── middleware/                   # 详见「middleware/」一节
├── nodes/
│   └── contractReviewStageEmitter.ts # 合同审查 SSE 阶段事件发送器（实体）
├── state/
│   └── storage.ts                # shim → agent-platform/state/storage
├── tools/                        # 详见「tools/」一节
└── utils/
    └── promptRenderer.ts         # shim → agent-platform/nodeConfig/promptRenderer
```

## caseAnalysisV2.workflow.ts -- 图定义

### 工作流状态 (WorkflowState)

```typescript
WorkflowState = {
    sessionId: string,          // 会话 ID（同时是 LangGraph thread_id）
    userId: number,
    caseId: number,
    thinking: boolean,          // 是否启用 extended thinking
    messages: MessagesValue,    // LangGraph 消息列表
    selectedModules: string[],  // 用户选择的分析模块名
    llmCalls: ReducedValue<number>,  // LLM 调用次数（累加器）
    result: ReducedValue<Record<string, string>>,  // 各模块结果（合并器）
    lastExecutedModule: string,
    lastExecutedResult: string,
    lastExecutedTitle: string,
    failedModules: ReducedValue<Record<string, string>>,  // 失败模块信息
}
```

**关键设计**：`result` 和 `failedModules` 使用 `ReducedValue`（reducer 合并策略），各节点独立写入不冲突。

### 图结构

```
START ──(条件)──▶ module_A ──(条件)──▶ module_B ──(条件)──▶ ... ──▶ END
```

- 模块列表从数据库 `nodes` 表动态加载（`type=analysis`，按 `priority` 排序）
- `START` 边指向第一个被 `selectedModules` 选中的模块
- 每个模块节点的出边指向下一个选中模块或 END
- **每次调用 `getCaseAnalysisWorkflow()` 都重新查数据库**，确保节点配置实时生效

### createAnalysisNode -- 分析节点生命周期

每个分析节点执行 6 个步骤：

1. **查 DB 判断模块状态**：已完成+已扣费直接返回；已完成+未扣费跳到步骤 6
2. **会员检查**：`while(true)` 循环 + `interrupt()`，用户开通会员后 resume 继续
3. **积分预检**：`while(true)` 循环 + `interrupt()`，充值后 resume 继续
4. **创建 IN_PROGRESS 记录**：调用 `createAnalysisDao`
5. **执行 LLM 分析**：构建内部 ReAct 子图（callModel + tools 循环），注入模块上下文
6. **扣减积分**：`while(true)` 循环，扣减失败则 interrupt 等待充值

**陷阱**：
- `interrupt()` 抛出 `GraphInterrupt` 异常，catch 块必须用 `isGraphInterrupt()` 判断并 re-throw
- 步骤 5d 先保存 `pointDeducted=false`，步骤 6 成功后再设为 true（两步持久化防丢）
- 内部 ReAct 子图的 `recursionLimit: 1000` 防止无限工具调用

### 内部 ReAct 子图（每个分析节点内）

```
                  ┌─────────┐
START ──▶ callModel ──(有 tool_calls)──▶ tools
                  │         │              │
                  │    (无 tool_calls)      │
                  ▼                        │
                 END            ◄──────────┘
```

- `callModel` 内置三道上下文防线：预防截断 → 动态摘要压缩 → safetyTrim 兜底
- 模块上下文通过 `buildModuleContext()` 构建后合并到 system prompt

## caseAnalysisV2.executor.ts -- 执行入口

```typescript
// 首次启动
startCaseAnalysisV2(params) → workflow.stream(initialState, config)

// 中断恢复（充值后继续）
startCaseAnalysisV2({ ...params, command }) → workflow.stream(new Command({ resume }), config)
```

- `streamMode: ['values', 'messages', 'updates']`：同时输出状态值、消息和节点更新
- `configurable.thread_id = sessionId`：通过 checkpointer 持久化状态
- `getWorkflowThreadState(sessionId)`：stream 结束后读取 checkpoint 中的 interrupt 信息

## agents/ -- Agent 模块

> agents/ 下既有真实 Agent 实体，也有兼容 shim。`subAgentToolFactory.ts` 已是 shim（实体在 `agent-platform/subAgent/subAgentToolFactory`）。`caseMainAgent.ts` 经阶段 8 改造后**只剩 `getChatThreadState`**——小索（案件主代理）已迁移到 `server/agents/case-main/agent.config.ts` vertical 走标准管道。

### assistantAgent.ts -- 通用问答主代理

`assistantMain` 节点对应的对话式主代理，是 `caseMainAgent` 的 assistant 版：
- 系统提示词不假设 case 上下文，工具集不含 case 相关工具
- 中间件不注入 caseContext / caseProcessMaterial（无案件上下文）
- 积分计费键为 `assistant_token`，与 `case_analysis_token` 独立
- 导出 `runAssistantChat` / `getAssistantThreadState`

### caseMainAgent.ts -- 案件主代理（仅残留）

阶段 8 改造后，`runCaseChat` 整段及模块级 skillsMiddleware 单例均已删除，小索改由 `server/agents/case-main/agent.config.ts` vertical 走 runtime 标准管道。本文件**仅保留 `getChatThreadState`**，用于读取 checkpoint 的 `channel_values`（如历史消息）。interrupt 检测不允许复用此处的 dummy `createAgent` 路径（详见下文 Interrupt 历史教训）。

### moduleAgent.ts -- 模块对话 Agent

轻量 ReAct Agent，为每个分析模块（案件摘要、大事记等）提供独立多轮对话能力：
- 使用 `nodes` 表中 `type=analysis` 且同 `name` 的节点配置
- 自动注入 `save_analysis_result` 工具，Agent 生成分析结果后主动写库
- 中间件：积分扣减 → 上下文注入（`buildContextSegments` 一次性构建 5 段式 system prompt 命中 prompt cache）→ 摘要压缩 → `analysisResultPersistenceMiddleware`
- `analysisResultPersistenceMiddleware` 作为末位兜底，与 `save_analysis_result` 工具通过 `state._analysisRecordId` 协同：beforeAgent 先建 IN_PROGRESS 记录并把 id 注入 state，工具读到 id 时直接 update 同一条记录避免双写，afterAgent 检查 status 决定跳过或兜底

### contractReviewMainAgent.ts -- 合同审查主代理

`contractReviewMain` 节点对应的对话式主代理，骨架仿 `documentMainAgent`：
- 从 `sessionId` 反查 `contractReviews`（`sessionId` 唯一）
- 唯一工具 `parse_and_ask_stance` 由 toolModules 加载
- 末位挂载 `reviewResultPersistenceMiddleware`（afterAgent 兜底）
- 通过 `nodes/contractReviewStageEmitter.ts` 发出审查阶段 SSE 事件

### documentMainAgent.ts -- 文书生成主代理

`documentMain` 节点对应的对话式主代理，与 `caseMain` / `assistantMain` 同构：
- 挂 `legal-document-writer` skill，用对话上下文 + skill 写作方法论产出字段值
- 通过 `save_document_draft` / `update_document_draft` 工具主动写库
- 系统 prompt 启动时注入 draft 当前状态（模板 / 已填字段 / 字段清单）

### subAgentToolFactory.ts -- 子代理工具工厂（shim）

本文件已是 `export * from '~~/server/services/agent-platform/subAgent/subAgentToolFactory'` 兼容 shim。子代理工具工厂把 `NodeConfig` 列表转换为 LangChain 工具数组（命名 `ask_{sanitized_name}_expert`），每个工具内部创建独立 `createAgent` 子代理，子代理使用独立 thread `{sessionId}_sub_{safeName}`。

### threadState.ts -- 线程状态读取

- `messageToFlatDict(msg)`：将 BaseMessage 转为前端可解析的平坦字典格式（`{ type, content, id, ... }`）
- `getThreadValuesService(threadId)`：读取 checkpoint 最新状态，过滤 system 消息和中间件注入的上下文消息（`ModuleContext`/`CaseMaterial`/`SubAgentContext` 前缀）
- `loadSubAgentThreads(sessionId, messages)`：从主 thread 的 AI 消息中提取 `ask_*_expert` 工具调用，反推子代理 thread_id（`{sessionId}_sub_{safeName}`），加载对应 thread 消息

**注意**：不能使用 `BaseMessage.toDict()`，它返回 constructor 格式（`{ type: "constructor", id: [...], kwargs: {...} }`），前端无法解析。

## tools/ -- 工具注册表

### 工具注册机制

`server/services/workflow/tools/` 下的 `.tool.ts` 文件**几乎全是 re-export shim**——通用工具实体已迁到 `server/services/agent-platform/tools/`，业务私有的 `parseAndAskStance` 实体已迁到 `server/agents/contract/tools/`。

权威注册表是 `server/services/agent-platform/tools/index.ts` 的 `toolModules` 映射。`server/services/workflow/tools/index.ts` 是一层兼容封装：re-export agent-platform 的注册表，并额外挂上业务私有工具 `parse_and_ask_stance`（合同审查用，待后续 vertical 阶段整体搬迁）。

每个工具模块导出 `toolDefinition`（元信息）和 `createTool(context)`（工厂函数）。`getToolInstancesService(names, context)` 按名称列表创建实例，未命中名称会 warn 跳过。

**注意**：`save_analysis_result`（`agent-platform/tools/saveAnalysisResult.tool.ts`）不在 `toolModules` 注册表里，由 `moduleAgent` 直接创建注入。

### 工具列表

`agent-platform/tools/index.ts` 的 `toolModules` 当前注册以下工具：

| 工具 | 功能 |
|------|------|
| `search_law` | 语义搜索法条，支持法律类型/名称/有效性筛选 |
| `search_case_materials` | 检索案件材料，支持语义/精确/组合模式 |
| `process_materials` | 检查材料状态，触发识别/嵌入，按 token 量决定 full/summary 模式 |
| `reserve_points` / `confirm_points` / `rollback_points` | 积分预扣 / 确认实扣 / 回滚 |
| `read_skill_file` / `write_skill_file` | 读取 / 写入 skill workspace 文件 |
| `run_skill_script` / `run_skill_command` | 执行 skill 脚本 / 命令 |
| `upload_workspace_file` | 上传 workspace 文件 |
| `search_case_memory` / `write_case_memory` / `update_case_memory` | 案件长期记忆检索 / 写入 / 更新 |
| `search_case_analysis` | 检索案件已有分析结果 |
| `recommend_template` | 推荐文书模板 |
| `save_document_draft` / `update_document_draft` | 保存 / 更新文书草稿 |
| `review_contract` | 合同审查 |
| `calculate_compensation` | 赔偿计算器 |
| `calculate_interest` / `calculate_delay_interest` | 利息 / 迟延利息计算器 |
| `calculate_court_fee` / `calculate_lawyer_fee` | 诉讼费 / 律师费计算器 |
| `calculate_overtime_pay` / `calculate_social_insurance_backpay` | 加班费 / 社保补缴计算器 |
| `calculate_divorce_property` / `calculate_date` | 离婚财产分割 / 日期计算器 |
| `query_bank_rate` | 银行利率查询 |

业务私有工具（经 `workflow/tools/index.ts` 兼容层额外注册）：`parse_and_ask_stance` —— 合同审查解析并询问立场。

### 工具上下文 (ToolContext)

工具上下文类型定义在 `agent-platform/tools/types.ts`，含 `userId` / `caseId` / `sessionId` / `runId` 等字段。

## context/ -- 上下文管理

> `workflow/context/` 下 `messageCompressor.ts` / `moduleContextBuilder.ts` / `toolResultTruncator.ts` / `contextErrorLogger.ts` 均为 re-export shim，实体在 `agent-platform/context/`。下文描述的是实体行为。

### messageCompressor -- 消息压缩（三道防线）

1. **预防控制**（由 toolResultTruncator 和 materialPipeline 负责）
2. **动态摘要压缩** (`compressMessages`)：
   - 保留 system message + 最近 3 轮消息
   - 中间消息用 LLM 生成结构化摘要替代
   - 摘要提示词总长度限制 30K 字符
3. **trimMessages 兜底** (`safetyTrimMessages`)：
   - 使用自定义 token 计数器（避免 js-tiktoken 的 Unknown model 警告）
   - 最终兜底：基于字符估算裁剪，始终保留 system message

**关键函数**：
- `getContextBudget(contextWindow)` → `{ budget: window*0.8, compressThreshold: budget*0.6 }`
- `estimateMessagesTokens(messages)` → 快速估算总 token 数

### moduleContextBuilder.ts -- 模块上下文构建

从 DB 并行加载四类上下文，按优先级分配 token 预算：

```
总预算 = contextWindow * 0.3
├── 案件基本信息（10%）：标题/原告/被告/概述/extractedInfo
├── 案件材料（40%）：full 或 summary 模式
├── 已完成分析结果（35%）：排除当前模块
└── 案件长期记忆（15%）：从 PostgresStore 读取
```

高优先级 section 实际使用少于预算时，剩余空间累积给后续 section。每类上下文独立 try-catch，失败降级为空。

### toolResultTruncator.ts -- 工具结果截断

- 使用 tiktoken 精确计算 token 数
- 二分查找定位截断点（基于 Unicode 码点数组避免截断 surrogate pair）
- 默认单条结果上限 8000 tokens
- 在序列化前截断，保证 JSON 格式完整

## middleware/ -- 中间件体系

> `server/services/workflow/middleware/` 下文件**全部是 re-export shim**，按实体落点分三处：
> - 通用中间件 → `server/services/agent-platform/middleware/`：`pointConsumption` / `safetyTrim` / `scopeGuard` / `audit` / `toolCallLimit` / `messageIntegrity`
> - 案件模块专用 → `server/agents/case-module/middleware/`：`analysisResultPersistence`
> - 案件上下文共享 → `server/agents/_shared/case-context/`：`caseProcessMaterial`
> - 合同审查专用 → `server/agents/contract/middleware/`：`reviewResultPersistence`
>
> 旧文档列的 `caseMaterialContext.middleware.ts` / `moduleContext.middleware.ts` 已删除——`caseMain` / `caseModule` / `documentMain` 三个 Agent 已于 2026-05 统一切换到 `caseContextSyncMiddleware`（HumanMessage 注入 + 双轨 metadata + splice 模式），不再走 SystemMessage 拼装。中间件优先级 / 装配顺序由各 vertical 的 agent.config.ts 与 agent-platform runtime 决定，详见 [tech-docs/patterns/workflow-middleware.md](../patterns/workflow-middleware.md)。

### pointConsumption -- 积分扣减

- **beforeAgent**：检查会员状态 → 检查积分余额 → 不足则 interrupt
- **afterModel**：获取 token 用量 → 按 token 用量扣减 → 失败则 interrupt 或记入待补扣
- 通过 `updateSessionState` 将 token 累计写入 Redis（跨 middleware/tool 共享）
- `_resumingFromAfterModel` 标记防止 resume 后重复预检

### caseProcessMaterial -- 材料预处理

- **beforeAgent**：调用 `ensureMaterialsReadyService` 确保材料已识别+嵌入
- 通过 `createCustomEventEmitter` 向前端发送材料准备进度的自定义 SSE 事件
- 异常时只记录日志，不中断 Agent 执行

### safetyTrim -- 安全截断

作为 `summarizationMiddleware` 的兜底防线，确保消息列表不超过模型上下文预算。两道防线：
1. LLM 摘要压缩（`compressMessages`）：保留 system + 最近 N 轮，中间轮次用摘要替代
2. 强制截断（`safetyTrimMessages`）：摘要压缩后仍超预算时用 `trimMessages` 兜底
- 先用 `estimateMessagesTokens` 快速预判是否超预算；压缩失败时静默返回原消息
- 使用 `splice` 原地替换 `state.messages`（对齐项目现有中间件写法，避免 Proxy 问题）

### scopeGuard -- 工具调用 scope 校验

在 `wrapToolCall` 钩子中对工具调用参数做确定性 scope 校验，拒绝越权调用。规则 map 仅针对 schema 中真实存在的字段做校验，工具名一律 snake_case 与注册名一致。

### audit -- 工具调用审计

所有工具调用（allowed / denied / error）全部异步持久化到 `agent_tool_audit_logs`，不阻塞业务；写库失败记 `logger.error` 但不抛出。

### toolCallLimit -- 工具调用配额

LangChain 原生 `toolCallLimitMiddleware` 一次只能限一个工具名，本中间件为每个工具创建一个实例、装配时 spread 展开实现多工具分层配额。`exitBehavior` 为 `continue`：超限后该工具调用返回 error 结果，Agent 仍可推进其他动作。

### messageIntegrity -- 消息完整性兜底

双钩子兜底：**beforeModel** 扫描即将喂给模型的 `state.messages`，对每个 orphan tool_use（`AIMessage.tool_calls` 后未紧跟 `ToolMessage`）立即插入合成 `ToolMessage` 占位，防止 Anthropic / OpenAI API 报 400。

### analysisResultPersistence -- 分析结果持久化（案件模块专用）

- **beforeAgent**：创建 IN_PROGRESS 分析记录
- **afterAgent**：提取 AIMessage 内容，更新为 COMPLETED 并设置 `isActive`
- 放在 middleware 数组末位，确保 afterAgent 在所有其他中间件之后执行

### reviewResultPersistence -- 合同审查结果持久化（合同专用）

- **beforeAgent**：首轮 `agent.stream` 启动前置 `status='reviewing'`（resume 路径由 `runContractReviewChat` 直接处理，不经此中间件）
- **afterAgent**：异常兜底，正常流程下不走此分支

## checkpointer -- PostgreSQL 检查点

> `workflow/checkpointer.ts` 是 shim，实体在 `agent-platform/checkpointer`。

- `PostgresSaver` 单例模式，首次调用自动 `setup()` 建表
- `PostgresStore` 单例模式，用于案件长期记忆存储
- 表结构定义在 `prisma/models/checkpoint.prisma`
- 支持 `resetCheckpointer()` 和 `getCheckpointerStatus()` 用于测试/监控

## state/storage -- Redis 状态存储

> `workflow/state/storage.ts` 是 shim，实体在 `agent-platform/state/storage`。

- key 格式：`session_state:{sessionId}`
- TTL：2 小时
- 用途：middleware 和 tool 之间共享状态（如 `_totalTokensConsumed`）
- read-modify-write 合并更新

## utils/promptRenderer -- 提示词渲染

> `workflow/utils/promptRenderer.ts` 是 shim，实体在 `agent-platform/nodeConfig/promptRenderer`。

`renderSystemPrompt(nodeConfig, context)` 从节点配置提取系统提示词并渲染模板变量：
- 仅取 `type === 'system' && status === 1` 的提示词
- 支持模板变量：`{{caseId}}`、`{{moduleName}}`、`{{caseType}}`
- 通过 `renderContent()` 替换变量
- 渲染后检测未替换的 `{{xxx}}` 并记录 warn 日志（便于线上排查配置问题）
- 找不到有效 system 提示词时返回空字符串

## 与 agent 模块的协作

### agentWorker.ts -- 任务执行引擎

`AgentWorker` 是全局单例，负责：
1. **取任务**：`FOR UPDATE SKIP LOCKED` 原子取 pending 任务
2. **派发**：把 `(scope, type, caseId, userId)` 交给 `agentRegistry.dispatch` 统一路由到注册的 runner
3. **流式转发**：遍历 SSE stream，通过 Redis pub/sub + stream 双写到 `agentEventBridge`
4. **安全过滤**：`stripSystemMessages` 过滤 system 消息和中间件注入消息，防泄露
5. **interrupt 检测**：stream 结束后检测 checkpoint 中的 interrupt 并合并到最后一个 values 事件（`type=2` 走 thread state，其余走 PostgresSaver pendingWrites）
6. **心跳/崩溃恢复**：定期心跳，超时任务自动重置为 pending

### agentEventBridge.ts -- 事件桥接

- Redis pub/sub 实时推送 + Redis Stream 持久化（双写保证）
- 内存降级队列：Redis 不可用时缓存事件，重连后自动补发
- `createEventSubscription(runId, signal)` → AsyncGenerator，供 API 层 SSE 推送
- `replayEvents(runId, lastEventId)` → 重连时补发缺失事件

### agentRun.service.ts -- 任务管理

- `enqueueRunService`：入队新 run，检查 session 去重和用户并发限制
- `cancelRunService`：取消 run，通过 Redis publish 通知 Worker
- partial unique index 防竞态条件下重复创建

## 相关文档

- [案件管理](./case.md) -- 案件生命周期、会话管理、分析结果版本
- `server/services/node/node.service.ts` -- 节点配置管理（模型、提示词、工具）
- `server/services/material/materialPipeline.service.ts` -- 材料处理管线
- `server/services/point/pointConsumption.service.ts` -- 积分消耗逻辑
- `shared/types/case.ts` -- InterruptType 等共享类型
- `shared/types/agentRun.ts` -- AGENT_RUN_STATUS 等状态枚举
