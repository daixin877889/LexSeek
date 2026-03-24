# 分析页面流式 Rejoin 设计

**日期**: 2026-03-24
**范围**: `/dashboard/analysis/[sessionId]` 页面流式重连

## 问题

当前用户离开分析页面（如切换路由、刷新页面）后，分析流被中断，无法继续接收实时输出。用户必须保持页面打开才能看到完整分析结果，体验不流畅。

## 设计

### 1. 服务端：查询活跃 Run 状态

**API 端点**：`GET /api/v1/case/analysis/run-status/[sessionId]`

**文件**：`server/api/v1/case/analysis/run-status/[sessionId].get.ts`

**响应**：
```typescript
{
  code: 200,
  data: {
    isRunning: boolean       // 是否存在活跃 run
    runId?: string          // 当前活跃 run 的 ID（仅 isRunning=true 时返回）
  }
}
```

**实现**：项目使用 Nuxt Server + LangGraph.js 直接嵌入（无独立 LangGraph Server），因此通过直接查询 PostgresSaver checkpointer 的 pending_writes 表或 LangGraph 的 state 来判断 run 是否仍在执行。

### 2. 提交选项：启用可恢复流

在 `stream.submit()` 中添加两个选项（**必须同时设置**）：

```typescript
stream.submit(
  { messages: [...] },
  {
    onDisconnect: 'continue',    // 断开后 agent 继续运行
    streamResumable: true,       // 允许后续 rejoin
    // ...existing options
  }
)
```

### 3. 前端：页面进入时自动 Rejoin

注意：`FetchStreamTransport` 模式下 `onCreated` 回调不会触发，因此 **`runId` 完全由服务端 API 提供**，前端无需保存。

页面进入流程：

1. 页面加载时调用 `GET /api/v1/case/analysis/run-status/{sessionId}`
2. 若 `isRunning === true && !stream.isLoading`，调用 `stream.joinStream(runId)` 重连
3. 重连后，离线期间产生的消息会被补发，新消息继续实时推送

```typescript
const runStatus = await useApiFetch<{
  isRunning: boolean
  runId?: string
}>(`/api/v1/case/analysis/run-status/${sessionId.value}`, { showError: false })

if (runStatus?.isRunning && runStatus.runId && !stream.isLoading) {
  stream.joinStream(runStatus.runId)
}
```

### 4. 离开页面时的处理

无需显式调用 `stream.stop()`——`onDisconnect: 'continue'` 保证 agent 继续运行，前端断开连接不影响后端。

### 5. 错误处理

- 查询状态 API 失败：静默降级，不影响页面正常使用（已有 `showError: false`）
- `joinStream` 抛出异常：catch 后 `console.error`，用户仍可通过历史消息查看之前的输出

## 改动文件

| 文件 | 改动 |
|------|------|
| `server/api/v1/case/analysis/run-status/[sessionId].get.ts` | 新增查询活跃 run 状态 API |
| `app/pages/dashboard/analysis/[sessionId].vue` | submit 添加 rejoin 选项、页面进入时 joinStream |
