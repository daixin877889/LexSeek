# 分析页面历史加载与多次发送修复设计

## 问题概述

`/dashboard/analysis/[sessionId]` 页面存在两个问题：

1. **进入页面时不加载历史对话**：使用 `FetchStreamTransport`（自定义传输）时，`useStream` 的 `CustomStreamOrchestrator` 初始化 `#historyValues = options.initialValues ?? {}`。未传入 `initialValues`，messages 始终从空数组开始。
2. **只能发送一条消息**：`isAnalyzing` 设为 `true` 后从未重置；同时 orchestrator 的 `#historyValues` 在整个生命周期中**永远不会被更新**（仅构造函数赋值一次），因此第二次 `submitDirect` 会将 `streamValues` 重置为 `{...#historyValues}` 即 `{}`，导致所有之前的消息被清空。

## 方案设计

### 1. 新建获取线程状态 API

**文件**：`server/api/v1/case/analysis/thread/[sessionId].get.ts`

**功能**：从 PostgresSaver checkpointer 读取指定 `thread_id` 的最新检查点状态，返回对话历史。

**请求**：
```
GET /api/v1/case/analysis/thread/:sessionId
```

**响应**：
```json
{
  "code": 200,
  "message": "获取成功",
  "data": {
    "values": {
      "messages": [/* 字典格式的消息 */]
    },
    "threadId": "xxx"
  }
}
```

**实现要点**：
- 验证用户认证和案件权限（复用现有逻辑）
- 使用 `getCheckpointer()` 获取 PostgresSaver 实例
- 调用 checkpointer 的 `getTuple({ configurable: { thread_id: sessionId } })` 读取最新检查点
- **消息格式转换**：checkpointer 返回的是 `BaseMessage` 实例，必须调用 `.toDict()` 将每条消息转换为 `useStream` 期望的纯字典格式（`{ type: 'human', content: '...' }`, `{ type: 'ai', content: '...', tool_calls: [...] }`）
- 如果线程不存在（首次访问），返回空 values：`{ messages: [] }`
- 不触发 Agent 执行，纯只读操作
- **错误降级**：如果 checkpointer 读取失败，返回空 values 而非报错，确保页面仍可使用

### 2. 前端页面改造

**文件**：`app/pages/dashboard/analysis/[sessionId].vue`

#### 2.1 初始化时加载历史

```typescript
// 页面加载时获取历史状态
const { data: threadState, status: threadStatus } = await useApiFetch(
  `/api/v1/case/analysis/thread/${sessionId.value}`
)

// 将历史状态传入 useStream
const stream = reactive(useStream({
  transport: new FetchStreamTransport({
    apiUrl: '/api/v1/case/analysis/chat',
  }),
  threadId: sessionId.value,
  initialValues: threadState.value?.values ?? undefined,
  // ...
}))
```

如果 `useApiFetch` 失败（网络错误等），`threadState.value` 为 `null`，`initialValues` 传入 `undefined`，等效于当前行为（空消息列表），不会阻塞页面。

#### 2.2 修复 isAnalyzing 不重置

**方案**：用 `stream.isLoading` 直接替代 `isAnalyzing`，因为 `isLoading` 在 StreamManager 的 `finally` 块中始终会被正确重置。

需要替换的位置（共 3 处）：
1. `<CaseAnalysisPromptInput :loading="isAnalyzing">` → `:loading="stream.isLoading"`
2. `<div v-if="isAnalyzing">` → `<div v-if="stream.isLoading">`
3. `<CaseAnalysisResults :is-analyzing="isAnalyzing">` → `:is-analyzing="stream.isLoading"`

```typescript
// 删除: const isAnalyzing = ref(false)

async function handlePromptSubmit(data: PromptSubmitData) {
  if (stream.isLoading || isComplete.value) return
  // 直接 submit，不需要手动管理 isAnalyzing
  stream.submit(/* ... */)
  promptInputRef.value?.reset()
}
```

#### 2.3 修复消息清空问题（optimisticValues）

**核心问题**：`#historyValues` 永远不更新，`optimisticValues` 回调收到的参数是 `#historyValues`（初始值），而非当前的 `stream.values`。

**解决策略**：在调用 `submit` 之前，先从 `stream` 获取当前完整的消息列表，构造完整的 optimisticValues：

```typescript
async function handlePromptSubmit(data: PromptSubmitData) {
  if (stream.isLoading || isComplete.value) return

  const text = data.text || '开始分析'
  // 在 submit 前捕获当前消息（stream.messages 是 BaseMessage 实例数组）
  // 使用 toDict() 或直接序列化为字典格式
  const currentMessages = stream.messages.map((m: any) =>
    typeof m.toDict === 'function' ? m.toDict() : m
  )

  stream.submit(
    { messages: [{ type: 'human', content: text }] },
    {
      optimisticValues: () => ({
        messages: [
          ...currentMessages,
          { type: 'human', content: text },
        ],
      }),
    }
  )
  promptInputRef.value?.reset()
}
```

**注意**：`optimisticValues` 回调返回的值会与 `#historyValues` 合并（`{...#historyValues, ...optimisticValues()}`），由于我们的 optimisticValues 已包含完整消息列表，合并后 messages 字段会正确覆盖空值。后端的第一个 `values` 事件到达后会替换为最终的完整状态。

## 影响范围

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `server/api/v1/case/analysis/thread/[sessionId].get.ts` | 新建 | 获取线程历史状态 API |
| `app/pages/dashboard/analysis/[sessionId].vue` | 修改 | 加载历史、移除 isAnalyzing、修复多次发送 |

## 边界情况

1. **首次访问**（无历史）：checkpointer 返回 `undefined`，API 返回 `{ messages: [] }`，页面正常显示空状态
2. **快速连续提交**：`stream.isLoading` 作为 guard 阻止重复提交，StreamManager 内部的 queue 机制排队处理（`manager.js:474-478`）
3. **网络错误**：useApiFetch 失败时 `initialValues` 为 `undefined`，页面功能不受影响
4. **todo 列表历史恢复**：加载历史消息后 `watch(() => stream.messages)` 自动触发，会从历史中的 `write_todos` ToolMessage 提取 todo 数据
