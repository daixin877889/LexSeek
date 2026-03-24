# 流式 Rejoin 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户离开分析页面后再返回，能自动重连到正在进行的分析流

**Architecture:** PostgreSQL 存储 activeRunId（caseSessions 表），chat API 在流开始/结束时维护该字段，前端页面进入时查询并调用 joinStream 重连

**Tech Stack:** Prisma ORM, @langchain/vue useStream, Nuxt Server API

**Spec:** `docs/superpowers/specs/2026-03-24-stream-rejoin-design.md`

---

### Task 1: Prisma schema 新增 activeRunId 字段

**Files:**
- Modify: `prisma/models/case.prisma`

- [ ] **Step 1: 在 caseSessions 模型中添加 activeRunId 字段**

在 `status` 字段之后添加：

```prisma
    /// 当前活跃的 run ID（stream 进行中时有值，结束后清空）
    activeRunId String? @map("active_run_id") @db.VarChar(100)
```

- [ ] **Step 2: 推送 schema 到数据库**

```bash
bun run prisma:push
```

- [ ] **Step 3: 重新生成 Prisma 客户端**

```bash
bun run prisma:generate
```

- [ ] **Step 4: 提交**

```bash
git add prisma/models/case.prisma
git commit -m "feat(db): caseSessions 新增 activeRunId 字段用于流式重连"
```

---

### Task 2: chat API 管理 activeRunId 生命周期

**Files:**
- Modify: `server/api/v1/case/analysis/chat.post.ts`

- [ ] **Step 1: 在流开始前写入 activeRunId，流结束时清空**

在 `chat.post.ts` 中，在 `runCaseChat` 调用前后（约第 86-116 行）修改为：

```typescript
// 在文件顶部添加导入
import { randomUUID } from 'crypto'

// 在第 86 行（验证权限通过后）插入：

    // 6. 生成 runId 并写入数据库
    const runId = randomUUID()
    await prisma.caseSessions.update({
        where: { sessionId },
        data: { activeRunId: runId },
    })

    // 7. 获取 SSE 流
    let sseStream: ReadableStream
    try {
        sseStream = await runCaseChat(sessionId, userMessage, {
            userId: user.id,
            caseId: caseInfo.id,
            thinking: true,
        })
    } catch (error) {
        // 出错时清空 activeRunId
        await prisma.caseSessions.update({
            where: { sessionId },
            data: { activeRunId: null },
        }).catch(() => {})
        throw error
    }

    // 8. 包装流：在流结束时清空 activeRunId
    const wrappedStream = sseStream.pipeThrough(new TransformStream({
        transform(chunk, controller) {
            controller.enqueue(chunk)
        },
        flush() {
            prisma.caseSessions.update({
                where: { sessionId },
                data: { activeRunId: null },
            }).catch(() => {})
        },
    }))

    // 9. 设置 SSE 响应头
    setResponseHeaders(event, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    })

    return wrappedStream
```

注意：替换原有的第 89-116 行（`runCaseChat` 调用 + `setResponseHeaders` + `return sseStream`）。

- [ ] **Step 2: 提交**

```bash
git add "server/api/v1/case/analysis/chat.post.ts"
git commit -m "feat(analysis): chat API 管理 activeRunId 生命周期"
```

---

### Task 3: run-status 查询 API

**Files:**
- Create: `server/api/v1/case/analysis/run-status/[sessionId].get.ts`

- [ ] **Step 1: 创建 API 端点**

参考 `server/api/v1/case/analysis/thread/[sessionId].get.ts` 的认证模式。

```typescript
/**
 * 查询线程活跃 Run 状态
 *
 * GET /api/v1/case/analysis/run-status/:sessionId
 *
 * 返回该线程是否有正在执行的 run，
 * 用于前端页面进入时决定是否 joinStream。
 */

import { findCaseBySessionIdService } from '~~/server/services/case/caseSession.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    const sessionId = getRouterParam(event, 'sessionId')
    if (!sessionId) {
        return resError(event, 400, '会话 ID 不能为空')
    }

    const caseInfo = await findCaseBySessionIdService(sessionId)
    if (!caseInfo) {
        return resError(event, 404, '案件不存在')
    }
    if (user.id !== caseInfo.userId) {
        return resError(event, 403, '您没有权限访问该案件')
    }

    const session = await prisma.caseSessions.findUnique({
        where: { sessionId },
        select: { activeRunId: true },
    })

    const runId = session?.activeRunId ?? null

    return resSuccess(event, '查询成功', {
        isRunning: runId !== null,
        runId: runId ?? undefined,
    })
})
```

- [ ] **Step 2: 提交**

```bash
git add "server/api/v1/case/analysis/run-status/[sessionId].get.ts"
git commit -m "feat(analysis): 添加活跃 run 状态查询 API"
```

---

### Task 4: 前端 submit 启用可恢复流 + rejoin

**Files:**
- Modify: `app/pages/dashboard/analysis/[sessionId].vue`

- [ ] **Step 1: submit 添加 onDisconnect 和 streamResumable**

在 `handlePromptSubmit` 函数的 `stream.submit()` 调用中（约第 364 行）添加选项：

```typescript
  stream.submit(
    { messages: [{ type: 'human', content: text }] },
    {
      onDisconnect: 'continue',
      streamResumable: true,
      optimisticValues: () => ({
        messages: [...currentMsgDicts, { type: 'human', content: text }],
      }),
    },
  )
```

- [ ] **Step 2: 页面进入时查询并 rejoin**

在 `stream` 初始化之后、`historyMessages` computed 之前（约第 189 行后）添加：

```typescript
// 查询是否有活跃 run，若有则自动重连
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

- [ ] **Step 3: 提交**

```bash
git add "app/pages/dashboard/analysis/[sessionId].vue"
git commit -m "feat(analysis): 启用可恢复流并支持页面进入时自动 rejoin"
```

---

### Task 5: 验证

- [ ] **Step 1: 类型检查**

```bash
npx nuxi typecheck
```

Expected: 改动文件无新增类型错误

- [ ] **Step 2: 手动验证**

启动 `bun dev`，进入分析页面：
1. 发送消息开始分析
2. 分析进行中切换到其他页面
3. 返回分析页面，观察是否自动接续流式输出
4. 等待分析完成后离开再返回，确认不会误触 rejoin（activeRunId 已清空）
5. 检查数据库：`SELECT active_run_id FROM case_sessions WHERE session_id = '...'`，确认流进行中有值、结束后为 null
