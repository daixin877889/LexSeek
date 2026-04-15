# Agent 错误恢复和 UI 容错设计

## 概述

解决 Agent 执行全链路中的容错问题：工具卡住、执行失败、SSE 断开、页面刷新后状态丢失。目标是**自动重试 + 手动兜底**——出错后自动重试 1-2 次，仍失败才提示用户手动重试，全程不丢失对话历史。

## 问题根因

| 场景 | 当前行为 | 根因 |
|------|---------|------|
| 工具执行卡住 | UI 永久 loading | `execFile` callback 未触发时 Promise 永远 pending |
| Agent 执行失败 | loading 停止但无提示 | 前端不监听 `status_change: FAILED` 事件 |
| SSE 连接中断 | 无提示、无重连 | 前端无心跳超时检测、无重连机制 |
| 页面刷新后状态丢失 | 看不到进行中任务 | 页面加载时不查询当前 run 状态 |

## 架构设计

### 场景 1：工具执行兜底超时

**改动文件**：`server/services/workflow/tools/runSkillScript.tool.ts`

在 `execFile` 的 Promise 外层加兜底超时，防止 callback 不触发导致 Promise 永远 pending：

```typescript
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} 执行超时（${ms / 1000}s）`)), ms)
        promise.then(resolve, reject).finally(() => clearTimeout(timer))
    })
}

// 在 tool handler 中使用
const result = await withTimeout(
    new Promise<string>((done) => {
        execFile(runtimeBin, execArgs, { timeout: 30_000, ... }, (err, stdout, stderr) => {
            // ...
        })
    }),
    35_000,  // 比 execFile 超时多 5s 作为兜底
    `脚本 ${scriptName}`
)
```

`withTimeout` 是通用函数，所有工具都可以使用。放在 `workspace.ts` 共享模块中。

### 场景 2：Agent 执行失败的 UI 反馈

**改动文件**：
- `app/composables/useStreamChat.ts` — 增加 status_change 事件拦截
- 对话页面组件 — 增加错误提示和重试按钮

#### 2.1 前端事件拦截

`@langchain/vue` 的 `useStream` 不暴露底层 SSE 事件拦截 API（无 `onStatusChange`、`onAnyEvent` 等回调）。需要在 SSE 传输层自行处理。

**方案**：扩展 `FetchStreamTransport`，在 fetch response 的 ReadableStream 中拦截 `event: status` 事件，解析后更新状态：

```typescript
// 扩展 FetchStreamTransport，拦截 status 事件
class InstrumentedTransport extends FetchStreamTransport {
    onStatusChange?: (status: string, error?: string) => void
    onHeartbeat?: () => void
    
    // 重写 fetch 方法，包装 response body
    async send(input: any) {
        const response = await super.send(input)
        // 包装 response.body，在每个 SSE 事件到达时检查
        // 如果是 event: status，解析并调用 onStatusChange
        // 任何事件到达时调用 onHeartbeat（用于超时检测）
        return wrapResponseWithInterceptor(response, this.onStatusChange, this.onHeartbeat)
    }
}
```

在 `useStreamChat` 中使用 `InstrumentedTransport` 替代 `FetchStreamTransport`，暴露 `runStatus` 和 `runError` 响应式状态：

```typescript
const runStatus = ref<string>('idle')
const runError = ref<string>('')

const transport = new InstrumentedTransport({ apiUrl })
transport.onStatusChange = (status, error) => {
    runStatus.value = status
    if (status === 'failed') {
        runError.value = error || '执行失败'
    }
}
```

**注意**：具体实现取决于 `FetchStreamTransport` 的可扩展性。如果不可继承，则需要创建一个 wrapper transport 在外层拦截。

#### 2.2 错误 Toast 和重试按钮

执行失败时：
1. 自动弹出 toast：`toast.error('分析失败: ' + runError)`
2. 在最后一条消息下方显示重试按钮
3. 点击重试 = 重新 submit 用户最后一条消息

```
┌─────────────────────────────────────┐
│  ⚠️ 执行失败：脚本超时              │
│  [重试]  [忽略]                      │
└─────────────────────────────────────┘
```

#### 2.3 自动重试

对于特定类型的错误（如工具超时、临时网络错误），在显示错误 UI 之前自动重试 1 次：
- 工具超时 → 自动重试 1 次
- 模型 API 限流 → 等待 3s 后自动重试 1 次
- 其他错误 → 直接显示错误 UI

自动重试逻辑在后端 agentWorker 中实现（不是前端），利用 LangGraph 的 `recursionLimit` 机制——Agent 收到工具错误后会自动尝试修复。

### 场景 3：SSE 连接中断和重连

**改动文件**：`app/composables/useStreamChat.ts`

#### 3.1 心跳超时检测

通过 `InstrumentedTransport` 的 `onHeartbeat` 回调实现（每个 SSE 事件到达时触发，包括 keepalive）：

```typescript
const HEARTBEAT_TIMEOUT = 60_000  // 60s 无事件视为断开
let lastEventTime = Date.now()

transport.onHeartbeat = () => {
    lastEventTime = Date.now()
}

const heartbeatTimer = setInterval(() => {
    if (Date.now() - lastEventTime > HEARTBEAT_TIMEOUT && isLoading.value) {
        handleDisconnect()
    }
}, 10_000)
```

#### 3.2 自动重连（指数退避）

```typescript
const RECONNECT_DELAYS = [3_000, 6_000, 12_000]
let reconnectAttempt = 0

async function handleDisconnect() {
    if (reconnectAttempt >= RECONNECT_DELAYS.length) {
        connectionStatus.value = 'disconnected'
        return
    }
    
    connectionStatus.value = 'reconnecting'
    await sleep(RECONNECT_DELAYS[reconnectAttempt])
    reconnectAttempt++
    
    // 通过 useStream 的 submit(undefined) 或重新创建实例重连
    // 后端 SSE 端点有 replay 机制（replayEvents + createEventSubscription）
    // 重连后会补发错过的事件
    // 注意：需要重新创建 useStream 实例以避免内部状态错乱
    // 具体方式需在实施时根据 @langchain/vue 的 useStream API 确定
    await reconnectSSE()
}
```

**重连与 useStream 的协调**：

`useStream` 内部维护消息状态机，直接重连可能导致重复消息。两种方案：
1. **重新创建 useStream 实例**：干净但丢失客户端缓存的消息（需从 checkpoint 重新加载）
2. **调用 `stream.submit(undefined)`**：类似"空消息 resume"，触发后端发送当前状态

推荐方案 1——重新创建实例 + 从 checkpoint 加载历史消息。这与用户刷新页面的行为一致，代码复用。

#### 3.3 连接状态 UI

```
连接中断时：
┌─────────────────────────────────────┐
│  ⚠️ 连接中断，正在重连...（第2次）   │
└─────────────────────────────────────┘

重连 3 次失败：
┌─────────────────────────────────────┐
│  ❌ 连接已断开                       │
│  [重新连接]                          │
└─────────────────────────────────────┘
```

### 场景 4：页面刷新后状态恢复

**改动文件**：对话页面组件（加载时查询 run 状态）

页面挂载时，查询当前 session 的最新 run 状态：

```typescript
onMounted(async () => {
    const latestRun = await useApiFetch(`/api/v1/case/analysis/runs/latest?sessionId=${sessionId}`)
    
    switch (latestRun?.status) {
        case 'running':
            // 自动重连 SSE，恢复流式输出
            await reconnectSSE()
            break
        case 'failed':
            // 显示上次失败信息 + 重试按钮
            runError.value = latestRun.error
            showRetryButton.value = true
            break
        case 'interrupted':
            // 显示中断卡片（积分不足等）
            break
        case 'completed':
            // 正常，不做特殊处理
            break
    }
})
```

**后端需新增 API**：`GET /api/v1/case/analysis/runs/latest?sessionId=xxx`
- 返回指定 session 的最新 run 记录（status、error、createdAt）
- 如果项目已有类似查询接口可复用

## 文件变更清单

### 修改文件

| 文件 | 变更内容 |
|------|---------|
| `app/composables/useStreamChat.ts` | 增加 runStatus/runError 状态、status_change 拦截、心跳超时检测、自动重连 |
| 对话页面组件 | 增加错误 toast、重试按钮、连接状态 UI、页面加载时状态恢复 |
| `server/services/workflow/tools/runSkillScript.tool.ts` | 增加 Promise 级兜底超时 |
| `server/services/workflow/tools/workspace.ts` | 增加 `withTimeout` 通用函数 |

### 可能新增文件

| 文件 | 职责 |
|------|------|
| `server/api/v1/case/analysis/runs/latest.get.ts` | 查询 session 最新 run 状态（如不存在类似接口） |

### 不受影响

- agentWorker.ts — 已有完善的 FAILED 状态发布逻辑，不需要改动
- checkpoint 机制 — 不修改，重试时自然从 checkpoint 恢复
- 现有的 interrupt 处理（积分不足等）— 保持不变

## 风险评估

### 低风险
- `withTimeout` 兜底超时不影响正常执行（35s > execFile 的 30s）
- runStatus/runError 是新增状态，不影响现有逻辑
- 重试按钮本质上是重新 submit 消息，与用户手动输入等价

### 中等风险
- SSE 自动重连需要与后端 replay 机制配合（后端已有 Redis Stream replay）
- 页面刷新后自动重连 SSE 可能导致重复事件（需要去重）

## 实施步骤

1. `workspace.ts` 增加 `withTimeout` 通用函数
2. `runSkillScript.tool.ts` 包裹 Promise 级兜底超时
3. `useStreamChat.ts` 增加 status_change 拦截 + runStatus/runError 暴露
4. `useStreamChat.ts` 增加心跳超时检测 + 自动重连
5. 对话页面组件增加错误 toast + 重试按钮 + 连接状态 UI
6. 对话页面加载时查询最新 run 状态并恢复
7. 如需新增 `runs/latest.get.ts` API
8. 端到端验证：工具失败 → 错误提示 → 重试 → 成功
