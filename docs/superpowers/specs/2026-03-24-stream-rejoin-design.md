# 分析页面流式 Rejoin 设计

**日期**: 2026-03-24
**范围**: `/dashboard/analysis/[sessionId]` 页面流式重连

## 问题

当前用户离开分析页面（如切换路由、刷新页面）后，分析流被中断，无法继续接收实时输出。用户必须保持页面打开才能看到完整分析结果，体验不流畅。

## 设计

### 1. 服务端：查询活跃 Run 状态

**API 端点**：`GET /api/v1/case/analysis/thread/status/{sessionId}`

**响应**：
```typescript
{
  code: 200,
  data: {
    isRunning: boolean       // 是否存在活跃 run
    runId?: string          // 当前活跃 run 的 ID（仅 isRunning=true 时返回）
    lastEventId?: string    // 最后一次事件的 ID（用于断点续传）
  }
}
```

**实现**：通过 LangGraph SDK 的服务端 API 查询 `GET /runs/stream` 或直接查询 PostgresSaver checkpointer 中的 run 记录。

### 2. 前端：页面进入时自动 Rejoin

在 `useStream` 初始化后，通过 `onMounted` 或 `watch(threadHistory)` 触发检查：

1. 调用 `/api/v1/case/analysis/thread/status/{sessionId}` 查询活跃状态
2. 若 `isRunning === true`，调用 `stream.joinStream(runId)` 重连流
3. 重连后，`stream.messages` 会收到离线期间产生的消息，并继续接收新消息

### 3. 前端：提交时保存 runId

在 `useStream` 的 `onCreated` 回调中保存 `run.run_id`：

```typescript
const savedRunId = ref<string | null>(null)

const stream = reactive(useStream({
  transport: new FetchStreamTransport({ apiUrl: '/api/v1/case/analysis/chat' }),
  threadId: sessionId.value,
  onCreated: (run) => { savedRunId.value = run.run_id },
  // ...
}))
```

### 4. 提交选项：启用可恢复流

在 `stream.submit()` 中添加：

```typescript
stream.submit(
  { messages: [...] },
  {
    onDisconnect: 'continue',    // 断开后 agent 继续运行
    streamResumable: true,       // 允许后续 rejoin
    // ...
  }
)
```

**注意**：两个选项必须同时设置，缺一不可。

### 5. 离开页面时的处理

无需显式调用 `stream.stop()`——`onDisconnect: 'continue'` 保证 agent 继续运行，前端断开连接不影响后端。

## 改动文件

| 文件 | 改动 |
|------|------|
| `server/api/v1/case/analysis/thread/status/{sessionId}.get.ts` | 新增查询活跃 run 状态 API |
| `app/pages/dashboard/analysis/[sessionId].vue` | onCreated 保存 runId、页面进入时 joinStream |

## 注意事项

- `joinStream` 只能在 `isLoading === false` 时调用（流已断开），需在 stream 初始化完成后判断
- 页面进入时如果已经有 `isLoading === true`（非 rejoin 场景），无需额外操作
- 多个标签页同时打开同一 session 的 rejoin 行为由 LangGraph 服务端控制
