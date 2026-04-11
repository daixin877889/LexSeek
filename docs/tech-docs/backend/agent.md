# Agent Worker

Agent Worker 负责从 PostgreSQL 任务队列取任务、执行 LangGraph Agent/Workflow、通过 Redis 推送实时事件流到前端，并提供心跳维持和崩溃恢复机制。

## 架构概览

```
前端 SSE ← Redis PubSub/Stream ← AgentEventBridge ← AgentWorker
                                                        ↑
                                                   PostgreSQL
                                                  (agent_runs 表)
                                                        ↑
                                              enqueueRunService
                                                   (API 层)
```

核心流程：

1. API 层调用 `enqueueRunService` 创建 `agent_runs` 记录（状态 pending）
2. 通过 Redis PUBLISH 通知 Worker
3. Worker 用 `FOR UPDATE SKIP LOCKED` 原子取任务
4. 执行 Agent/Workflow，遍历 SSE stream
5. 通过 AgentEventBridge 将事件双写到 Redis PubSub + Stream
6. 前端通过 SSE 订阅 Redis PubSub 接收实时事件

## 源码路径

所有文件位于 `server/services/agent/`。

| 文件 | 职责 |
|------|------|
| `agentWorker.ts` | Worker 核心：任务队列、执行、心跳、崩溃恢复 |
| `agentEventBridge.ts` | Redis PubSub 事件管道 |
| `agentRun.service.ts` | 入队、取消、查询等业务逻辑 |
| `agentRun.dao.ts` | 数据访问层（含 FOR UPDATE SKIP LOCKED） |

## AgentWorker 类

### 配置项

```typescript
interface AgentWorkerConfig {
  maxConcurrent: number      // 最大并发任务数
  timeoutMs: number          // 单任务超时（毫秒）
  heartbeatIntervalMs: number // 心跳更新间隔（毫秒）
  crashThresholdMs: number   // 崩溃判定阈值（毫秒）
}
```

配置来源：`runtimeConfig.agent`（`nuxt.config.ts` 中的 `agent` 配置段）。

### 启动流程

`start()` 按顺序执行：

1. 启动 Redis 重连补发监听（`startReconnectFlush`）
2. 订阅 Redis 频道：
   - `agent_tasks`：新任务通知 → 触发 `processNextTask`
   - `run_cancel:*`（psubscribe）：取消信号 → 触发 `handleCancelSignal`
3. 启动心跳循环
4. 启动崩溃恢复检查
5. 主动扫描所有 pending 任务（`drainPendingTasks`，处理 Worker 重启期间入队的任务）

Redis 订阅失败不阻塞启动，仅依赖轮询。

### 任务执行

`processNextTask()` 流程：

1. 检查是否正在关闭、并发是否已满
2. `claimPendingRunDAO(workerId)` 原子取任务
3. 非阻塞执行 `executeRun(run)`（不 await，允许并行）

`executeRun(run)` 流程：

1. 创建 `AbortController` 用于超时和取消控制
2. 发布 `running` 状态
3. 根据 session 类型路由到不同的 Agent/Workflow：
   - `session.type === 2`（初始化分析）→ `startCaseAnalysisV2`
   - `session.type === 3`（模块对话）→ `runModuleChat`
   - 其他（普通案件对话）→ `runCaseChat`
4. 遍历 SSE stream，解析事件并发布到 Redis
5. 检查工作流是否被 interrupt（LangGraph human-in-the-loop）
6. 更新最终状态（completed / interrupted / failed / cancelled）

执行完成后自动尝试取下一个任务。

### SSE 事件处理

Worker 从 Agent/Workflow 接收 SSE 文本流，解析为结构化事件：

```
event: values|messages|updates
data: {...}
```

**消息过滤**（`stripSystemMessages`）：防止系统提示词和内部消息泄露到前端：

| 事件类型 | 过滤逻辑 |
|----------|----------|
| `values` | 过滤 `messages` 数组中的 system 消息和注入消息 |
| `updates` | 按 node 遍历，过滤每个 node 输出中的 messages |
| `messages` | 过滤 `tags: ['internal']` 的 LLM 调用、system 消息、注入消息 |

注入消息识别：`response_metadata.injectedBy` 以 `ModuleContext`、`CaseMaterial` 或 `SubAgentContext` 开头。

### Interrupt 处理

LangGraph 的 `values` 流会过滤 `__interrupt__`，Worker 需要额外检查：

1. Stream 结束后获取 thread state
2. 检查 `tasks[-1].interrupts` 是否存在
3. 如果有 interrupt，发布合并了 `__interrupt__` 的最终 `values` 事件
4. 更新状态为 `INTERRUPTED`

### 心跳维持

`startHeartbeat()` 定时更新活跃任务的 `heartbeat_at` 字段：

- 间隔：`heartbeatIntervalMs`
- 只在有活跃任务时更新
- `updateHeartbeatDAO(workerId)` 批量更新该 Worker 所有 running 任务
- 如果更新返回 0 但仍有活跃 run → 任务可能被其他 Worker 接管，终止执行

### 崩溃恢复

`startCrashRecovery()` 定期检查心跳超时的 running 任务：

- 检查间隔：`crashThresholdMs * 2`
- `findStaleRunsDAO(crashThresholdMs)` 查找 `heartbeat_at < NOW() - threshold` 的 running 任务
- `resetStaleRunDAO(id, oldWorkerId)` 将超时任务重置为 pending（带 workerId 条件防竞态）
- 重置后立即尝试取任务

### 优雅关闭

`shutdown()` 流程：

1. 设置 `isShuttingDown = true`
2. 停止心跳和崩溃恢复定时器
3. 等待活跃任务完成（最多 30 秒）
4. 超时未完成则 `abort` 所有任务

## AgentEventBridge

Redis PubSub 事件管道，提供发布、订阅、重连补发能力。

### 发布

三种事件类型：

| 函数 | 事件类型 | 说明 |
|------|----------|------|
| `publishAgentEvent` | `stream_event` | Agent SSE 流事件 |
| `publishStatusChange` | `status_change` | 状态变更 |
| `publishCustomEvent` | 自定义 | 模块对话的 `analysis_result_saved` 等 |

每个事件双写：
- **Redis PUBLISH**：`run:{runId}` 频道（实时推送）
- **Redis XADD**：`run_events:{runId}` Stream（持久化，MAXLEN ~2000）

状态变更事件额外设置 Stream 7 天过期。

### 内存降级队列

Redis 不可用时事件暂存内存队列：

- 最大容量：`config.agent.pendingQueueMax`
- TTL：`config.agent.pendingQueueTtlMs`
- 超限时优先保留 `status_change` 类型
- Redis 恢复后自动补发（`flushPendingEvents`）

### 重连补发

`startReconnectFlush()` 监听 Redis `ready` 事件，触发 `flushPendingEvents` 补发缓存事件。在 Worker 启动时调用一次。

### 事件订阅

`createEventSubscription(runId, signal)` 返回 `AsyncGenerator<AgentEvent>`，用于 SSE 推送：

- 订阅 Redis PubSub 频道 `run:{runId}`
- 使用 Promise 队列将回调事件转为 async iterable
- 30 分钟空闲超时自动关闭
- 支持 AbortSignal 取消

### 历史重放

`replayEvents(runId, lastEventId)` 从 Redis Stream 读取缺失事件（用于客户端重连）。

## AgentRun Service

### 入队

`enqueueRunService(params)` 逻辑：

1. 检查 session 是否已有活跃 run → 返回已有 runId（幂等）
2. 检查用户并发限制（`maxUserConcurrent`）→ 超限返回错误
3. 创建新 run（`createAgentRunDAO`）
4. 通过 Redis PUBLISH 通知 Worker
5. 处理 partial unique index 冲突（竞态条件）

### 取消

`cancelRunService(runId)` 处理两种状态：

- **pending**：直接更新为 `CANCELLED`
- **running**：更新为 `CANCELLED` + 通过 Redis PUBLISH `run_cancel:{runId}` 通知 Worker

### 查询

| 函数 | 说明 |
|------|------|
| `getActiveRunService` | 查找 session 当前活跃 run |
| `getLatestRunService` | 查找 session 最新 run（不限状态） |
| `getRunListService` | 查询 session 的 run 列表 |

## AgentRun DAO

### 原子取任务

```sql
SELECT * FROM agent_runs
WHERE status = 'pending'
ORDER BY created_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED
```

使用 Prisma `$transaction` + `$queryRaw` 实现，保证多 Worker 环境下不重复取任务。

### 状态流转

```
pending → running → completed
                  → failed
                  → cancelled
                  → interrupted
pending → cancelled
```

数据库通过 partial unique index 保证同一 session 同时只有一个活跃 run。

### 数据清理

`deleteOldRunsDAO(days)` 删除 N 天前已终结的 run（completed/failed/cancelled）。

## 与 Workflow 的协作

Worker 根据 `session.type` 路由到不同的执行入口：

| session.type | 入口 | 模块 |
|-------------|------|------|
| 2 | `startCaseAnalysisV2` | `workflow/caseAnalysisV2.executor` |
| 3 | `runModuleChat` | `workflow/agents/moduleAgent` |
| 其他 | `runCaseChat` | `workflow/agents` |

所有执行入口返回 `ReadableStream`（SSE 格式），Worker 统一遍历并发布事件。

Session 不存在时直接抛错，不做静默降级（避免路由错乱）。

## 相关文档

- [tech-docs/backend/material.md](./material.md) - 材料处理管道（Agent 执行前的数据准备）
- [tech-docs/backend/retrieval.md](./retrieval.md) - 检索系统（Agent 工具调用的底层）
- [tech-docs/patterns/sse-event-bridge.md](../patterns/sse-event-bridge.md) - SSE 事件桥接模式
- [tech-docs/patterns/workflow-middleware.md](../patterns/workflow-middleware.md) - LangGraph 工作流与中间件
