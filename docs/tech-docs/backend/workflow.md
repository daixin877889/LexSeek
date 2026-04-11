# LangGraph AI 编排模块

使用 LangGraph StateGraph 编排案件分析工作流，支持多模块顺序执行、中断恢复、流式输出和积分扣减。

## 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    API Layer                             │
│  /api/v1/case/analysis/agents.post.ts                   │
│  /api/v1/case/analysis/chat.post.ts                     │
└──────────────┬──────────────────────────────┬────────────┘
               │                              │
               ▼                              ▼
┌──────────────────────┐    ┌────────────────────────────┐
│  agentRun.service     │    │  agentWorker               │
│  入队 → Redis 通知    │───▶│  取任务 → 执行 → 心跳      │
└──────────────────────┘    └──────────┬─────────────────┘
                                       │ 按 session.type 路由
               ┌───────────────────────┼───────────────────┐
               ▼                       ▼                   ▼
     type=2                  type=1                type=3
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│caseAnalysisV2    │  │caseMainAgent     │  │moduleAgent       │
│结构化批量分析     │  │对话式主Agent      │  │模块对话Agent      │
│(StateGraph)      │  │(createAgent)     │  │(createAgent)     │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

**三种执行模式**：
- **type=2 (caseAnalysisV2)**：结构化批量分析，StateGraph 顺序执行所有选中模块
- **type=1 (caseMainAgent)**：对话式主 Agent，支持子代理委派
- **type=3 (moduleAgent)**：模块级对话 Agent，针对单个分析模块深入对话

## 文件清单

```
server/services/workflow/
├── caseAnalysisV2.workflow.ts    # StateGraph 图定义（核心）
├── caseAnalysisV2.executor.ts    # 执行入口，返回 SSE stream
├── checkpointer.ts              # PostgresSaver 单例管理
├── agents/
│   ├── caseMainAgent.ts          # 对话式主 Agent（createAgent）
│   ├── moduleAgent.ts            # 模块对话 Agent
│   ├── subAgentToolFactory.ts    # 子代理工具生成工厂
│   ├── caseAnalysis.ts           # 通用分析 Agent 工厂（createAgent + 完整中间件栈）
│   ├── threadState.ts            # 线程状态读取/消息格式转换
│   └── index.ts
├── tools/
│   ├── searchLaw.tool.ts         # 法条检索
│   ├── searchCaseMaterials.tool.ts # 材料检索
│   ├── processMaterials.tool.ts  # 材料预处理
│   ├── reservePoints.tool.ts     # 积分预扣
│   ├── confirmPoints.tool.ts     # 积分确认
│   ├── rollbackPoints.tool.ts    # 积分回滚
│   ├── saveAnalysisResult.tool.ts # 保存分析结果
│   ├── types.ts                  # 工具类型定义
│   └── index.ts                  # 工具注册表
├── context/
│   ├── messageCompressor.ts      # 消息压缩（三道防线）
│   ├── moduleContextBuilder.ts   # 模块上下文构建
│   └── toolResultTruncator.ts    # 工具结果截断
├── middleware/
│   ├── pointConsumption.middleware.ts      # 积分扣减
│   ├── caseMaterialContext.middleware.ts   # 材料上下文注入
│   ├── caseProcessMaterial.middleware.ts   # 材料预处理
│   ├── moduleContext.middleware.ts         # 模块上下文注入
│   ├── analysisResultPersistence.middleware.ts # 结果持久化
│   ├── safetyTrim.middleware.ts           # 安全截断兜底
│   ├── types.ts                           # 优先级/互斥定义
│   └── index.ts
├── state/
│   └── storage.ts                # Redis 状态存储
└── utils/
    └── promptRenderer.ts         # 提示词模板渲染
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

### caseMainAgent.ts -- 对话式主 Agent

使用 `createAgent` 创建，核心特点：
- 加载 `caseMain` 节点配置（模型、提示词、工具）
- 生成子代理工具（`createSubAgentTools`），将分析模块注册为 `ask_xxx_expert` 工具
- 中间件栈：积分扣减 → 材料预处理 → 材料上下文注入 → 摘要压缩 → 安全截断
- `summarizationMiddleware` 触发阈值：`contextWindow * 0.6`（下限 30k）

### moduleAgent.ts -- 模块对话 Agent

为每个分析模块提供独立的多轮对话能力：
- 使用与分析模块同名的节点配置
- 自动注入 `save_analysis_result` 工具，Agent 生成分析结果后必须调用
- 中间件栈：积分扣减 → 模块上下文注入 → 摘要压缩 → 安全截断
- **不挂载 `analysisResultPersistenceMiddleware`**（与 save_analysis_result 工具冲突）

### subAgentToolFactory.ts -- 子代理工具工厂

将 `NodeConfig` 列表转换为 LangChain 工具数组：
- 工具命名：`ask_{sanitized_name}_expert`
- 每个工具内部创建独立的 `createAgent` 子代理
- 子代理使用独立 thread：`{sessionId}_sub_{safeName}`
- 首次调用注入精简案件上下文（通过 `response_metadata.injectedBy: 'SubAgentContext'` 标记防重复注入）
- 跳过无可用 API Key 的节点
- 错误降级：返回错误字符串而非抛异常

### caseAnalysis.ts -- 通用分析 Agent 工厂

使用 `createAgent` 构建分析 Agent，支持两种调用模式：
- **直接调用**：传入完整的 userId/caseId/prompt
- **workflow 场景**：通过 `runtimeConfig.configurable` 覆盖运行时参数（`user_id`/`case_id`）

挂载完整的中间件栈（按优先级排序）：
1. `pointConsumptionMiddleware` → 积分扣减
2. `caseProcessMaterialMiddleware` → 材料预处理
3. `caseMaterialContextMiddleware` → 材料上下文注入
4. `todoListMiddleware` → 待办列表
5. `summarizationMiddleware` → 摘要压缩
6. `safetyTrimMiddleware` → 安全截断
7. `analysisResultPersistenceMiddleware` → 结果持久化（末位）

### threadState.ts -- 线程状态读取

- `messageToFlatDict(msg)`：将 BaseMessage 转为前端可解析的平坦字典格式（`{ type, content, id, ... }`）
- `getThreadValuesService(threadId)`：读取 checkpoint 最新状态，过滤 system 消息和中间件注入的上下文消息（`ModuleContext`/`CaseMaterial`/`SubAgentContext` 前缀）
- `loadSubAgentThreads(sessionId, messages)`：从主 thread 的 AI 消息中提取 `ask_*_expert` 工具调用，反推子代理 thread_id（`{sessionId}_sub_{safeName}`），加载对应 thread 消息

**注意**：不能使用 `BaseMessage.toDict()`，它返回 constructor 格式（`{ type: "constructor", id: [...], kwargs: {...} }`），前端无法解析。

## tools/ -- 工具注册表

### 工具注册机制

`server/services/workflow/tools/index.ts` 维护工具模块映射表：

```typescript
const toolModules = {
    search_case_materials: ...,
    search_law: ...,
    process_materials: ...,
    reserve_points: ...,
    confirm_points: ...,
    rollback_points: ...,
}
```

每个工具模块导出 `toolDefinition`（元信息）和 `createTool(context)`（工厂函数）。`getToolInstancesService(names, context)` 按名称列表创建实例。

**注意**：`save_analysis_result` 工具不在注册表中，由 `moduleAgent` 直接创建注入。

### 工具列表

| 工具 | 文件 | 功能 |
|------|------|------|
| `search_law` | `searchLaw.tool.ts` | 语义搜索法条，支持法律类型/名称/有效性筛选 |
| `search_case_materials` | `searchCaseMaterials.tool.ts` | 检索案件材料，支持语义/精确/组合模式 |
| `process_materials` | `processMaterials.tool.ts` | 检查材料状态，触发识别/嵌入，按 token 量决定 full/summary 模式 |
| `reserve_points` | `reservePoints.tool.ts` | 批量预扣积分，返回各模块 batchId |
| `confirm_points` | `confirmPoints.tool.ts` | 确认积分实扣（分析成功后） |
| `rollback_points` | `rollbackPoints.tool.ts` | 回滚预扣积分（分析失败时） |
| `save_analysis_result` | `saveAnalysisResult.tool.ts` | 保存分析结果到 DB 并通过自定义事件通知前端 |

### 工具上下文 (ToolContext)

```typescript
interface ToolContext {
    userId: number
    caseId: number
    sessionId: string
    runId?: string  // 模块对话需要
}
```

## context/ -- 上下文管理

### messageCompressor.ts -- 消息压缩（三道防线）

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

### 优先级排序

```
优先级  中间件                   说明
10     caseProcessMaterial      材料预处理（ensureMaterialsReady）
20     pointConsumption         积分扣减（beforeAgent + afterModel）
30     caseMaterialContext      材料上下文注入（与 moduleContext 互斥）
30     moduleContext            模块上下文注入（与 caseMaterialContext 互斥）
40     summarization            摘要压缩
50     safetyTrim               安全截断兜底
80     todoList                 待办列表
90     analysisResultPersistence 结果持久化（必须最后）
```

**互斥规则**：`caseMaterialContext` 和 `moduleContext` 不能同时挂载。

### pointConsumption.middleware.ts -- 积分扣减

- **beforeAgent**：检查会员状态 → 检查积分余额 → 不足则 interrupt
- **afterModel**：获取 token 用量 → 按 1000 tokens = 1 积分扣减 → 失败则 interrupt 或记入待补扣
- 通过 `updateSessionState` 将 token 累计写入 Redis（跨 middleware/tool 共享）
- `_resumingFromAfterModel` 标记防止 resume 后重复预检

### moduleContext.middleware.ts -- 模块上下文注入

每轮对话前检测四种上下文变更，仅在有变化时注入增量内容：
1. 材料（sourceId 列表对比，首次全量/后续增量）
2. 长期记忆（MD5 hash 对比）
3. 其他模块分析结果（MD5 hash 对比）
4. 当前模块分析结果（hash 对比）

注入消息通过 `response_metadata.injectedBy` 标记，threadState 读取时过滤。

### caseMaterialContext.middleware.ts -- 材料上下文注入

- **beforeAgent**：首次全量注入 / 后续增量注入案件材料上下文
- 通过 `_injectedSourceIds` 状态字段跟踪已注入的材料（使用 Set 优化大数据量去重）
- 首次注入：在 SystemMessage 之后插入 HumanMessage（full/summary 模式由 token 阈值决定）
- 增量注入：在用户最新消息前插入新增材料信息
- 注入消息标记 `injectedBy: 'CaseMaterialContextMiddleware'`，被 threadState 和 agentWorker 过滤

### caseProcessMaterial.middleware.ts -- 材料预处理

- **beforeAgent**：调用 `ensureMaterialsReadyService` 确保材料已识别+嵌入
- 日志记录处理结果（totalMaterials、alreadyEmbedded、newlyProcessed、failedCount）
- 异常时只记录日志，不中断 Agent 执行

### analysisResultPersistence.middleware.ts -- 结果持久化

- **beforeAgent**：创建 IN_PROGRESS 记录（复用 FAILED/IN_PROGRESS 旧记录避免版本号浪费）
- **afterAgent**：提取最后一条 AIMessage 内容，事务内 deactivate 旧版本 + 激活新版本
### safetyTrim.middleware.ts -- 安全截断

- **beforeAgent**：两道防线（LLM 摘要压缩 → 强制截断）
- 先用 `estimateMessagesTokens` 快速预判是否超预算
- 防线一：`compressMessages` 生成摘要（不抛异常，失败时静默返回原消息）
- 防线二：压缩后仍超预算时调用 `safetyTrimMessages` 强制截断
- 使用 `splice` 原地替换 state.messages（对齐项目现有中间件写法，避免 Proxy 问题）

## checkpointer.ts -- PostgreSQL 检查点

- `PostgresSaver` 单例模式，首次调用自动 `setup()` 建表
- `PostgresStore` 单例模式，用于案件长期记忆存储
- 表结构定义在 `prisma/models/checkpoint.prisma`
- 支持 `resetCheckpointer()` 和 `getCheckpointerStatus()` 用于测试/监控

## state/storage.ts -- Redis 状态存储

- key 格式：`session_state:{sessionId}`
- TTL：2 小时
- 用途：middleware 和 tool 之间共享状态（如 `_totalTokensConsumed`）
- read-modify-write 合并更新

## utils/promptRenderer.ts -- 提示词渲染

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
2. **路由**：按 `session.type` 路由到对应 Agent（type=1/2/3）
3. **流式转发**：遍历 SSE stream，通过 Redis pub/sub + stream 双写到 `agentEventBridge`
4. **安全过滤**：`stripSystemMessages` 过滤 system 消息和中间件注入消息，防泄露
5. **interrupt 检测**：stream 结束后通过 `getState()` 读取 checkpoint 中的 interrupt，合并到最后一个 values 事件
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
