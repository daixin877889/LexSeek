# 分析页面历史加载与多次发送修复 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复分析页面进入时不加载历史对话、以及只能发送一条消息的问题。

**Architecture:** 新建一个 GET API 端点从 PostgresSaver checkpointer 读取线程状态（只读），前端页面初始化时调用该 API。由于 `useStream` 的 `initialValues` 仅存入 `#historyValues` 而不会推入 `stream.values`（`streamValues` 保持 `null` 直到首次 submit），需要额外创建 `displayMessages` computed 做 fallback：stream 未启动时从 API 数据渲染，stream 启动后切换到 `stream.messages`。同时移除手动管理的 `isAnalyzing` ref，改用 `stream.isLoading`，并通过 `optimisticValues` 防止二次提交时消息闪烁。

**Tech Stack:** Nuxt 4 Server API (Nitro), PostgresSaver (`@langchain/langgraph-checkpoint-postgres`), `@langchain/vue` useStream + FetchStreamTransport, `@langchain/core/messages`

**Spec:** `docs/superpowers/specs/2026-03-24-analysis-history-and-multi-submit-design.md`

---

### Task 1: 新建获取线程状态服务函数

**Files:**
- Create: `server/services/agent/threadState.ts`

- [ ] **Step 1: 创建服务函数文件**

创建 `server/services/agent/threadState.ts`（与同目录 `caseAgent.ts` 命名风格一致），从 checkpointer 读取线程最新状态：

```typescript
/**
 * 线程状态读取
 *
 * 从 PostgresSaver checkpointer 读取线程最新检查点，
 * 返回 useStream initialValues 所需的字典格式状态。
 */

import { getCheckpointer } from '~~/server/services/workflow/checkpointer'
import { mapStoredMessageToChatMessage } from '@langchain/core/messages'

/**
 * 将 checkpointer 中的消息转为纯字典格式
 * 兼容 BaseMessage 实例、stored message 格式、已有字典格式
 */
function messageToDict(msg: any): Record<string, unknown> {
    // BaseMessage 实例
    if (typeof msg.toDict === 'function') {
        return msg.toDict()
    }
    // stored message 格式 ({ type, data })
    if (msg.data && msg.type) {
        try {
            const instance = mapStoredMessageToChatMessage(msg)
            return typeof instance.toDict === 'function'
                ? instance.toDict()
                : instance
        } catch {
            return msg
        }
    }
    // 已是字典格式
    return msg
}

/**
 * 获取线程的最新状态值（用于前端 initialValues）
 *
 * @param threadId 线程 ID（即 sessionId）
 * @returns 包含 messages 数组的状态对象，或 null（线程不存在时）
 */
export async function getThreadValuesService(
    threadId: string
): Promise<Record<string, unknown> | null> {
    const checkpointer = await getCheckpointer()

    const tuple = await checkpointer.getTuple({
        configurable: { thread_id: threadId },
    })

    if (!tuple) return null

    const channelValues = tuple.checkpoint.channel_values
    const rawMessages = channelValues.messages

    if (Array.isArray(rawMessages) && rawMessages.length > 0) {
        return {
            ...channelValues,
            messages: rawMessages.map(messageToDict),
        }
    }

    return channelValues as Record<string, unknown>
}
```

- [ ] **Step 2: 验证 `mapStoredMessageToChatMessage` 导入可用**

```bash
grep -r "mapStoredMessageToChatMessage" node_modules/@langchain/core/dist/ --include="*.d.ts" | head -5
```

如果不存在，改用直接返回 `msg`（跳过 stored message 转换分支）。

- [ ] **Step 3: 提交**

```bash
git add server/services/agent/threadState.ts
git commit -m "feat(analysis): 添加线程状态读取服务函数"
```

---

### Task 2: 新建获取线程状态 API 端点

**Files:**
- Create: `server/api/v1/case/analysis/thread/[sessionId].get.ts`
- Reference: `server/api/v1/case/analysis/chat.post.ts`（复用权限验证模式）

- [ ] **Step 1: 创建 API 端点**

```typescript
/**
 * 获取线程历史状态 API
 *
 * GET /api/v1/case/analysis/thread/:sessionId
 *
 * 从 checkpointer 读取指定线程的最新状态，
 * 返回给前端用于渲染历史消息和作为 useStream 的 initialValues。
 */

import { getThreadValuesService } from '~~/server/services/agent/threadState'
import { findCaseBySessionIdService } from '~~/server/services/case/caseSession.service'

export default defineEventHandler(async (event) => {
    // 1. 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 2. 获取路由参数
    const sessionId = getRouterParam(event, 'sessionId')
    if (!sessionId) {
        return resError(event, 400, '会话 ID 不能为空')
    }

    // 3. 验证案件权限
    const caseInfo = await findCaseBySessionIdService(sessionId)
    if (!caseInfo) {
        return resError(event, 404, '案件不存在')
    }
    if (user.id !== caseInfo.userId) {
        return resError(event, 403, '您没有权限访问该案件')
    }

    // 4. 读取线程状态（降级：失败返回空值，不阻塞页面）
    try {
        const values = await getThreadValuesService(sessionId)
        return resSuccess(event, '获取成功', {
            values: values ?? { messages: [] },
            threadId: sessionId,
        })
    } catch (error) {
        logger.warn('读取线程状态失败，返回空值', {
            sessionId,
            error: error instanceof Error ? error.message : '未知错误',
        })
        return resSuccess(event, '获取成功', {
            values: { messages: [] },
            threadId: sessionId,
        })
    }
})
```

- [ ] **Step 2: 手动测试 API**

启动开发服务器后测试：
- 有历史的 session → `{ code: 200, data: { values: { messages: [...] }, threadId: "xxx" } }`
- 无历史的 session → `{ code: 200, data: { values: { messages: [] }, threadId: "xxx" } }`

- [ ] **Step 3: 提交**

```bash
git add server/api/v1/case/analysis/thread/\[sessionId\].get.ts
git commit -m "feat(analysis): 添加获取线程历史状态 API"
```

---

### Task 3: 前端页面改造 — 加载历史 & 修复多次发送

**Files:**
- Modify: `app/pages/dashboard/analysis/[sessionId].vue`

**关键设计说明**：`useStream` 的 `initialValues` 被存入 orchestrator 的 `#historyValues`，但 `StreamManager.state.values` 保持 `null` 直到首次 `submit()`（见 `stream.custom.js:15,74-76`）。因此 `stream.messages` 在首次 submit 前始终返回空数组。需要 `displayMessages` computed 做 fallback。

- [ ] **Step 1: 添加历史加载和 displayMessages fallback**

在 `<script setup>` 中，替换当前的 useStream 初始化代码（约第 155-174 行）。

将：
```typescript
// 派生状态
const isAnalyzing = ref(false)
const isComplete = ref(false)
const thinkingEnabled = ref(route.query.thinking !== 'false')

// reactive() 包装让 getter（如 messages）通过 Proxy 被 Vue 响应式追踪
// 模板中直接用 stream.messages，Vue 自动追踪并在数据变化时重渲染
const stream = reactive(useStream({
  transport: new FetchStreamTransport({
    // apiUrl: '/api/v1/case/analysis/stream/' + sessionId.value,
    apiUrl: '/api/v1/case/analysis/chat',
  }),
  threadId: sessionId.value,
  onError: (error) => {
    console.error('[useStream] 流错误:', error);
  },
  onFinish: (state, error) => {
    console.log('[useStream] 流完成:', state, error);
  },
}));
```

替换为：
```typescript
// 派生状态
const isComplete = ref(false)
const thinkingEnabled = ref(route.query.thinking !== 'false')

// 加载线程历史状态
const threadHistory = await useApiFetch<{
  values: Record<string, unknown>
  threadId: string
}>(`/api/v1/case/analysis/thread/${sessionId.value}`, {
  showError: false,
})

const stream = reactive(useStream({
  transport: new FetchStreamTransport({
    apiUrl: '/api/v1/case/analysis/chat',
  }),
  threadId: sessionId.value,
  // initialValues 存入 #historyValues，供 optimisticValues 合并使用
  // 注意：这不会让 stream.messages 在首次 submit 前返回历史
  initialValues: threadHistory?.values ?? undefined,
  onError: (error) => {
    console.error('[useStream] 流错误:', error)
  },
}))

// 历史消息 fallback：将 API 返回的字典格式消息转为 BaseMessage 实例
// 这样模板中 HumanMessage.isInstance() / AIMessage.isInstance() 检查可以正常工作
const historyMessages = computed(() => {
  const rawMessages = threadHistory?.values?.messages
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) return []
  return rawMessages.map((m: any) => {
    // 字典格式消息有 type 字段：human / ai / tool
    if (m.type === 'human' || m.type === 'ai' || m.type === 'tool') {
      // 使用 @langchain/core/messages 的构造函数创建实例
      if (m.type === 'human') return new HumanMessage({ content: m.content, id: m.id })
      if (m.type === 'ai') return new AIMessage({ content: m.content, id: m.id, tool_calls: m.tool_calls })
      if (m.type === 'tool') return new ToolMessage({ content: m.content, tool_call_id: m.tool_call_id, id: m.id })
    }
    return m
  })
})

// 最终用于模板渲染的消息列表
// stream 启动后（有 values）使用 stream.messages；否则 fallback 到历史
const displayMessages = computed(() =>
  stream.messages.length > 0 || stream.isLoading
    ? stream.messages
    : historyMessages.value
)
```

- [ ] **Step 2: 更新模板中的消息引用**

将模板中所有 `stream.messages` 替换为 `displayMessages`。

1. 空状态条件（约第 23 行）：
```html
<ConversationEmptyState v-if="stream.messages.length === 0 && !stream.isLoading"
```
→
```html
<ConversationEmptyState v-if="displayMessages.length === 0 && !stream.isLoading"
```

2. 消息列表循环（约第 26 行）：
```html
<template v-for="(message, msgIndex) in stream.messages" :key="message.id ?? msgIndex">
```
→
```html
<template v-for="(message, msgIndex) in displayMessages" :key="message.id ?? msgIndex">
```

3. 流式推理判断（约第 39 行）：
```html
:is-streaming="stream.isLoading && msgIndex === stream.messages.length - 1"
```
→
```html
:is-streaming="stream.isLoading && msgIndex === displayMessages.length - 1"
```

- [ ] **Step 3: 更新 toolResultsMap computed**

将 `toolResultsMap`（约第 279-287 行）中的 `stream.messages` 也改为 `displayMessages`：

```typescript
const toolResultsMap = computed(() => {
  const map = new Map<string, any>()
  for (const msg of displayMessages.value) {
    if (ToolMessage.isInstance(msg)) {
      map.set((msg as any).tool_call_id, msg)
    }
  }
  return map
})
```

- [ ] **Step 4: 更新 todo watch 监听 displayMessages**

将 watch 监听源（约第 207 行）从 `stream.messages` 改为 `displayMessages`：

```typescript
watch(displayMessages, (msgs) => {
```

这样加载历史时也能正确提取 todo 列表。

- [ ] **Step 5: 移除 `isAnalyzing` ref，改用 `stream.isLoading`**

删除：
```typescript
const isAnalyzing = ref(false)
```

- [ ] **Step 6: 修改 `handlePromptSubmit` 函数**

替换为：
```typescript
async function handlePromptSubmit(data: PromptSubmitData) {
  if (stream.isLoading || isComplete.value) return

  const text = data.text || '开始分析'

  // 捕获当前消息列表，构造 optimisticValues 防止消息闪烁
  // stream.messages 有值时优先使用，否则 fallback 到历史数据
  const currentMsgDicts = stream.messages.length > 0
    ? stream.messages.map((m: any) => typeof m.toDict === 'function' ? m.toDict() : m)
    : (threadHistory?.values?.messages as any[] ?? [])

  stream.submit(
    { messages: [{ type: 'human', content: text }] },
    {
      optimisticValues: () => ({
        messages: [...currentMsgDicts, { type: 'human', content: text }],
      }),
    },
  )

  promptInputRef.value?.reset()
}
```

- [ ] **Step 7: 替换模板中的 `isAnalyzing` 引用（3 处）**

1. `CaseAnalysisPromptInput` 的 `:loading` prop（第 107 行）：
   `:loading="isAnalyzing"` → `:loading="stream.isLoading"`

2. 加载指示器（第 111 行）：
   `v-if="isAnalyzing"` → `v-if="stream.isLoading"`

3. `CaseAnalysisResults` 的 `:is-analyzing` prop（第 124 行）：
   `:is-analyzing="isAnalyzing"` → `:is-analyzing="stream.isLoading"`

- [ ] **Step 8: 提交**

```bash
git add app/pages/dashboard/analysis/\[sessionId\].vue
git commit -m "fix(analysis): 加载历史消息并修复多次发送问题

- 页面初始化时从 checkpointer API 加载线程历史
- 添加 displayMessages computed 实现历史 fallback
- 用 stream.isLoading 替代手动管理的 isAnalyzing ref
- 通过 optimisticValues 防止二次提交时消息闪烁"
```

---

### Task 4: 端到端手动验证

- [ ] **Step 1: 启动开发服务器**

```bash
bun dev
```

- [ ] **Step 2: 场景 A — 首次进入空会话**

1. 创建新案件分析会话
2. 进入 `/dashboard/analysis/<new-session-id>`
3. **预期**：显示空状态（"开始案件分析"）
4. 输入消息，点击发送
5. **预期**：消息发送成功，AI 开始流式回复

- [ ] **Step 3: 场景 B — 重新进入有历史的会话**

1. 等待 AI 回复完成
2. 返回案件列表，重新进入同一个会话
3. **预期**：页面加载时立即显示之前的对话历史

- [ ] **Step 4: 场景 C — 多次发送消息**

1. 在有历史的会话中，输入新消息，点击发送
2. **预期**：消息发送成功，AI 继续回复
3. 等待回复完成，再次输入消息
4. **预期**：第三次消息也能正常发送，前两轮对话不会消失

- [ ] **Step 5: 场景 D — 消息不闪烁**

1. 在有多轮对话的会话中，发送新消息
2. **预期**：发送时之前的消息不会消失/闪烁，新消息立即出现

- [ ] **Step 6: 场景 E — todo 列表历史恢复**

1. 进入一个之前有 todo 进度的会话
2. **预期**：todo 任务进度条自动从历史消息中恢复显示
