# SSE + Redis 事件管道

LexSeek 使用 SSE（Server-Sent Events）+ Redis Pub/Sub + Redis Stream 构建实时事件管道，将后台 Agent 工作流的流式输出推送到客户端，同时支持断线重连和事件补发。

## 整体架构

```
┌───────────┐        SSE         ┌───────────────┐
│  Browser  │ ◀────────────────  │  Nuxt Server  │
│  (前端)    │  text/event-stream │  (SSE API)    │
└───────────┘                    └───────┬───────┘
                                         │ subscribe
                                         ▼
                                ┌─────────────────┐
                                │  Redis Pub/Sub   │  run:<runId> 频道
                                │  Redis Stream    │  run_events:<runId> 键
                                └────────┬────────┘
                                         │ publish
                                         ▼
                                ┌─────────────────┐
                                │  AgentWorker     │  后台任务执行
                                │  (Worker 进程)   │
                                └────────┬────────┘
                                         │ stream
                                         ▼
                                ┌─────────────────┐
                                │  LangGraph       │  Agent 工作流
                                │  Agent 引擎      │
                                └─────────────────┘
```

## AgentEventBridge

`server/services/agent/agentEventBridge.ts` 是 Redis 事件发布与订阅的核心模块。

### 事件发布（双写策略）

每个事件同时写入 Redis Pub/Sub 和 Redis Stream：

```typescript
export async function publishAgentEvent(event: AgentStreamEvent): Promise<void> {
    if (!isRedisReady()) {
        enqueuePending(event)  // Redis 不可用时降级到内存队列
        return
    }

    const redis = getRedisClient()
    const payload = JSON.stringify(event)
    await Promise.all([
        redis.publish(`run:${event.runId}`, payload),           // Pub/Sub：实时推送
        redis.xadd(                                              // Stream：持久化
            `run_events:${event.runId}`, 'MAXLEN', '~', '2000',
            '*', 'payload', payload,
        ),
    ])
}
```

**双写原因**：
- **Pub/Sub**：低延迟实时推送，但无持久化（错过即丢失）
- **Stream**：有序持久化，支持按 ID 范围查询（用于断线重连补发）

### 三种发布方法

| 方法 | 用途 | 事件类型 |
|---|---|---|
| `publishAgentEvent()` | Agent 流式输出 | `stream_event` |
| `publishStatusChange()` | 状态变更 | `status_change`（额外设置 7 天过期） |
| `publishCustomEvent()` | 自定义事件 | 如 `analysis_result_saved` |

### 事件订阅（AsyncGenerator）

使用 AsyncGenerator 将 Redis Pub/Sub 消息转换为异步迭代器：

```typescript
export async function* createEventSubscription(
    runId: string,
    signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
    const sub = createRedisSubscription()
    await sub.connect()
    await sub.subscribe(`run:${runId}`)

    // Promise 队列：将 redis message 事件转为 async iterable
    const queue: QueueItem[] = []
    let resolve: (() => void) | null = null

    sub.on('message', (_ch, message) => {
        const event = JSON.parse(message) as AgentEvent
        queue.push({ value: event })
        resolve?.()
    })

    signal.addEventListener('abort', () => {
        queue.push({ done: true })
        resolve?.()
    })

    try {
        while (true) {
            if (queue.length === 0) {
                await new Promise<void>(r => { resolve = r })
            }
            while (queue.length > 0) {
                const item = queue.shift()!
                if ('done' in item) return
                yield item.value
            }
        }
    } finally {
        sub.unsubscribe(`run:${runId}`)
        sub.quit()
    }
}
```

**空闲超时**：30 分钟无事件自动关闭订阅，防止资源泄漏。

### 断线重连补发

客户端重连时，通过 Redis Stream 的 XRANGE 补发缺失事件：

```typescript
export async function replayEvents(
    runId: string,
    lastEventId: string = '0-0',
): Promise<AgentEvent[]> {
    const redis = getRedisClient()
    const results = await redis.xrange(`run_events:${runId}`, lastEventId, '+')
    return results
        .map(([_id, fields]) => {
            const payloadStr = fields[fields.indexOf('payload') + 1]
            return JSON.parse(payloadStr) as AgentEvent
        })
        .filter(Boolean)
}
```

### 内存降级队列

Redis 不可用时，事件暂存到内存队列，Redis 恢复后自动补发：

```typescript
// 内存队列配置
const PENDING_QUEUE_MAX = config.agent.pendingQueueMax    // 最大容量
const PENDING_QUEUE_TTL_MS = config.agent.pendingQueueTtlMs  // 事件 TTL

// 队列满时优先保留 status_change 类型事件
function enqueuePending(event: AgentEvent): void {
    if (pendingEvents.length >= PENDING_QUEUE_MAX) {
        if (event.type !== 'status_change') return
        // 移除最早的非 status_change 事件腾出空间
        const idx = pendingEvents.findIndex(e => e.event.type !== 'status_change')
        if (idx >= 0) pendingEvents.splice(idx, 1)
    }
    pendingEvents.push({ event, timestamp: Date.now() })
}

// Redis 重连时自动补发
export function startReconnectFlush(): void {
    const client = getRedisClient()
    client.on('ready', () => { flushPendingEvents() })
}
```

## AgentWorker

`server/services/agent/agentWorker.ts` 是后台任务执行引擎。

### 配置参数

```typescript
export interface AgentWorkerConfig {
    maxConcurrent: number       // 最大并发任务数
    timeoutMs: number           // 单任务超时（毫秒）
    heartbeatIntervalMs: number // 心跳间隔
    crashThresholdMs: number    // 崩溃检测阈值
}
```

### 启动流程

```typescript
async start(): Promise<void> {
    // 1. 启动 Redis 重连补发监听
    startReconnectFlush()

    // 2. 订阅 Redis 频道
    sub.subscribe('agent_tasks')       // 新任务通知
    sub.psubscribe('run_cancel:*')     // 取消信号

    // 3. 启动心跳循环
    this.startHeartbeat()

    // 4. 启动崩溃恢复检查
    this.startCrashRecovery()

    // 5. 主动扫描 pending 任务（处理重启期间入队的任务）
    await this.drainPendingTasks()
}
```

### 任务执行

```typescript
private async executeRun(run: agentRuns): Promise<void> {
    const abortController = new AbortController()
    this.activeRuns.set(run.id, abortController)

    // 超时保护
    const timeoutTimer = setTimeout(() => abortController.abort(), this.config.timeoutMs)

    // 发布 RUNNING 状态
    await publishStatusChange({ type: 'status_change', runId: run.id, status: 'running' })

    // 根据 session.type 路由到不同 Agent
    // type=1: 普通案件对话 → runCaseChat
    // type=2: 初始化分析   → startCaseAnalysisV2
    // type=3: 模块对话     → runModuleChat

    // 遍历 SSE stream，解析事件并发布到 Redis
    const reader = stream.getReader()
    while (!abortController.signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break

        const events = parseSSEEvents(text)
        for (const evt of events) {
            // 剥离 system 消息和注入的上下文消息
            const sanitized = stripSystemMessages(evt.event, evt.data)
            if (sanitized === null) continue

            await publishAgentEvent({
                type: 'stream_event', runId: run.id,
                event: evt.event, data: sanitized,
            })
        }
    }

    // 检查工作流是否被 interrupt
    // 发布最终状态（COMPLETED / INTERRUPTED / FAILED / CANCELLED）
}
```

### 安全过滤

Worker 在转发事件到 Redis 前，过滤三类内部消息：

| 过滤类型 | 检测方式 | 目的 |
|---|---|---|
| System 消息 | `msg.type === 'system'` | 防止系统提示词泄露 |
| 注入上下文 | `response_metadata.injectedBy` 前缀匹配 | 隐藏中间件注入的上下文 |
| 内部 LLM 调用 | `metadata.tags.includes('internal')` | 隐藏意图分类器等内部调用 |

### 心跳检测

```typescript
private startHeartbeat(): void {
    setInterval(async () => {
        if (this.activeRuns.size === 0) return
        const count = await updateHeartbeatDAO(this.workerId)
        if (count === 0 && this.activeRuns.size > 0) {
            // 心跳更新返回 0 但有活跃 run → 可能被其他 Worker 接管
            for (const [runId, controller] of this.activeRuns) {
                controller.abort(new Error('心跳丢失'))
            }
        }
    }, this.config.heartbeatIntervalMs)
}
```

### 崩溃恢复

```typescript
private startCrashRecovery(): void {
    setInterval(async () => {
        // 查找心跳超时的 run → 重置为 pending → 重新分配
        const staleRuns = await findStaleRunsDAO(this.config.crashThresholdMs)
        for (const run of staleRuns) {
            await resetStaleRunDAO(run.id, run.workerId)
            this.processNextTask()
        }
    }, this.config.crashThresholdMs * 2)
}
```

### 并发控制

```typescript
async processNextTask(): Promise<boolean> {
    if (this.isShuttingDown) return false
    if (this.activeRuns.size >= this.config.maxConcurrent) return false

    const run = await claimPendingRunDAO(this.workerId)  // 原子 claim
    if (!run) return false

    this.executeRun(run).catch(...)  // 非阻塞执行
    return true
}
```

### 优雅关闭

```typescript
async shutdown(): Promise<void> {
    this.isShuttingDown = true
    // 停止定时器
    // 等待活跃任务完成（最多 30 秒）
    // 超时则强制 abort
}
```

## SSE Service

`server/services/sse/sse.service.ts` 管理与前端的 SSE 连接。

### 连接管理器

```typescript
class SSEConnectionManager {
    private connections: Map<string, SSEConnection> = new Map()

    add(connection: SSEConnection): void
    remove(connectionId: string): void
    get(connectionId: string): SSEConnection | undefined
    clear(): void  // 进程退出时清理所有连接
}
```

### 连接创建

```typescript
export async function createSSEConnectionService(
    event: H3Event,
    config: SSEConnectionConfig = {},
): Promise<SSEConnection> {
    // 1. 设置 SSE 响应头
    setResponseHeader(event, 'Content-Type', 'text/event-stream')
    setResponseHeader(event, 'Cache-Control', 'no-cache')
    setResponseHeader(event, 'Connection', 'keep-alive')

    // 2. 创建 H3 事件流
    const eventStream = createEventStream(event)

    // 3. 设置心跳定时器（默认 30 秒间隔）
    connection.heartbeatTimer = setInterval(async () => {
        await sendSSEMessageService(connection, {
            type: SSEMessageType.HEARTBEAT,
            message: 'ping',
        })
    }, heartbeatInterval)

    // 4. 监听客户端断开
    eventStream.onClosed(() => {
        connection.isClosed = true
        connectionManager.remove(connectionId)
    })

    // 5. 发送连接成功消息
    await sendSSEMessageService(connection, {
        type: SSEMessageType.CONNECTED,
        data: { connectionId },
    })

    return connection
}
```

### 消息类型

| 类型 | 常量 | 用途 |
|---|---|---|
| `connected` | `CONNECTED` | 连接建立确认 |
| `heartbeat` | `HEARTBEAT` | 心跳保活 |
| `text_delta` | `TEXT_DELTA` | AI 生成文本增量 |
| `reasoning` | `REASONING` | 推理过程 |
| `tool_call` | `TOOL_CALL` | 工具调用 |
| `tool_result` | `TOOL_RESULT` | 工具结果 |
| `task_start` | `TASK_START` | 任务开始 |
| `task_progress` | `TASK_PROGRESS` | 任务进度 |
| `task_complete` | `TASK_COMPLETE` | 任务完成 |
| `workflow_start` | `WORKFLOW_START` | 工作流开始 |
| `workflow_complete` | `WORKFLOW_COMPLETE` | 工作流完成 |
| `interrupt` | `INTERRUPT` | 工作流中断（需用户操作） |
| `error` | `ERROR` | 错误 |
| `closed` | `CLOSED` | 连接关闭 |
| `info` | `INFO` | 信息通知（如 resume 确认） |

### 中断事件

工作流中断（如积分不足）通过 SSE 推送到前端：

```typescript
export async function sendInterruptEventService(
    connection: SSEConnection,
    interruptType: string,
    interruptMessage: string,
    interruptData?: Record<string, unknown>,
): Promise<boolean> {
    return sendSSEMessageService(connection, {
        type: SSEMessageType.INTERRUPT,
        message: interruptMessage,
        data: {
            __interrupt__: {
                type: interruptType,
                message: interruptMessage,
                data: interruptData,
            },
        },
    })
}
```

## 数据流完整路径

```
1. 前端发起分析请求
   POST /api/v1/case/analysis/agents → 创建 agentRuns 记录（status=PENDING）
   → Redis publish('agent_tasks', runId)

2. Worker 接收任务
   Worker.subscribe('agent_tasks') → claimPendingRunDAO(workerId) → executeRun()
   → 路由到对应 Agent（runCaseChat / startCaseAnalysisV2 / runModuleChat）

3. Agent 流式输出
   LangGraph Agent → SSE stream → Worker 解析 → 过滤内部消息
   → publishAgentEvent() → Redis Pub/Sub + Stream 双写

4. 前端订阅事件
   GET /api/v1/case/analysis/runs/[sessionId] → createEventSubscription(runId)
   → Redis subscribe('run:' + runId) → SSE 推送到浏览器

5. 断线重连
   前端携带 lastEventId 重连 → replayEvents(runId, lastEventId) → 补发缺失事件
```

## 容错设计汇总

| 故障场景 | 应对措施 |
|---|---|
| Redis 不可用 | 内存降级队列，Redis 恢复后自动补发 |
| Worker 崩溃 | 心跳超时 → 其他 Worker 崩溃恢复 → 重置为 pending |
| 任务执行超时 | AbortController + setTimeout 强制终止 |
| 客户端断线 | SSE `onClosed` 清理资源 + Stream 补发 |
| 内存队列满 | 优先保留 status_change，丢弃低优先级事件 |
| 优雅关闭 | 等待活跃任务（30s）→ 超时强制 abort |

## 相关文档

- [tech-docs/patterns/workflow-middleware.md](./workflow-middleware.md) - 工作流中间件（interrupt 事件的产生源头）
- [tech-docs/patterns/service-dao.md](./service-dao.md) - Service + DAO 分层模式（agentRun DAO 层）
- [tech-docs/patterns/adapter-factory.md](./adapter-factory.md) - 适配器工厂模式（同样的抽象解耦思路）
