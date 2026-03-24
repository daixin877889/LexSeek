# 分析页面流式 Rejoin 设计

**日期**: 2026-03-24
**范围**: `/dashboard/analysis/[sessionId]` 页面流式重连

## 问题

当前用户离开分析页面（如切换路由、刷新页面）后，分析流被中断，无法继续接收实时输出。用户必须保持页面打开才能看到完整分析结果，体验不流畅。

## 技术背景

- 项目使用 `@langchain/vue` 的 `useStream` + `FetchStreamTransport` 模式
- `FetchStreamTransport` 对应 `CustomStreamOrchestrator`，**不支持** 内置的 `reconnectOnMount`
- 但 `useStream` 返回的对象仍具有 `joinStream(runId)` 方法可用
- 框架完整 LGP 模式需要 4-5 个新端点 + SSE 事件持久化层，成本过高
- 采用**手动 rejoin** 方案：PostgreSQL 存 activeRunId + 前端手动调用 joinStream

## 设计

### 1. 数据库：caseSessions 表新增 activeRunId 字段

在 `prisma/models/case.prisma` 的 `caseSessions` 模型中新增：

```prisma
activeRunId String? @map("active_run_id") @db.VarChar(100)
```

- stream 开始时写入 runId（UUID）
- stream 正常结束或出错时清空为 null
- 支持多实例部署，无状态依赖

### 2. 服务端：在 chat API 中管理 activeRunId

修改 `server/api/v1/case/analysis/chat.post.ts`：
- 调用 `runCaseChat` 前：生成 UUID，写入 `caseSessions.activeRunId`
- 流结束后（通过 TransformStream flush）：清空 `caseSessions.activeRunId`
- 流出错时：同样清空

### 3. 服务端：查询活跃 Run 状态 API

**API 端点**：`GET /api/v1/case/analysis/run-status/[sessionId]`

**响应**：
```typescript
{
  code: 200,
  data: {
    isRunning: boolean
    runId?: string
  }
}
```

**实现**：从 `caseSessions` 表读取 `activeRunId`，非 null 即 isRunning=true。

### 4. 前端：submit 启用可恢复流

在 `stream.submit()` 中添加：
```typescript
{
  onDisconnect: 'continue',    // 断开后 agent 继续运行
  streamResumable: true,       // 允许后续 rejoin
}
```

### 5. 前端：页面进入时自动 Rejoin

```typescript
const runStatus = await useApiFetch<{
  isRunning: boolean
  runId?: string
}>(`/api/v1/case/analysis/run-status/${sessionId.value}`, { showError: false })

if (runStatus?.isRunning && runStatus.runId && !stream.isLoading) {
  try {
    await stream.joinStream(runStatus.runId)
  } catch (error) {
    console.error('[rejoin] 重连流失败:', error)
  }
}
```

### 6. 错误处理

- 查询状态 API 失败：静默降级（showError: false）
- joinStream 异常：catch + console.error，用户仍可通过历史消息查看之前输出
- 进程崩溃导致 activeRunId 残留：已完成的 run 无法 joinStream，前端 catch 后降级到历史消息

## 改动文件

| 文件 | 改动 |
|------|------|
| `prisma/models/case.prisma` | caseSessions 新增 activeRunId 字段 |
| `server/api/v1/case/analysis/chat.post.ts` | 生成 runId，写入/清空 activeRunId |
| `server/api/v1/case/analysis/run-status/[sessionId].get.ts` | 新增查询活跃 run API |
| `app/pages/dashboard/analysis/[sessionId].vue` | submit 选项 + 页面进入时 joinStream |
