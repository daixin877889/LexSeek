# 小索/模块对话停止按钮与消息队列设计

**日期**：2026-04-15
**作者**：戴鑫（与 Claude 协作）
**状态**：待评审
**影响范围**：前端（`app/composables/useChatSessionManager.ts`、`app/components/caseDetail/CaseDetailXiaosuo.vue`、模块对话组件、`app/components/ai/AiPromptInput.vue`、新增 `app/components/ai/AiChatQueueChips.vue`）

## 1. 问题背景

小索对话和分析模块对话共享同一套前端基础设施（`useChatSessionManager`），目前存在两个用户体验问题：

1. **停止按钮 UI 失灵**：基础设施层面的 `stopGeneration`（前端 SSE 断开 + 后端 Redis pub/sub 触发 LangGraph AbortController）完整存在，但 `AiPromptInput.vue` 的提交按钮在 loading 态下无法正确切换为停止按钮、无法触发 `stop` 事件。相关具体 bug 见第 4.1 节。

2. **无消息队列**：用户在 AI 回复过程中无法继续输入新消息，必须等到当前轮次结束才能提问。工作流体验被"逐句轮询"式交互中断。

## 2. 目标与非目标

### 2.1 目标

- **停止按钮可用**：进行中的对话可以通过点击停止按钮立即中断，已生成的部分内容作为"已取消"消息保留在对话历史中。
- **消息队列**：用户可以在当前轮次进行中时继续输入新消息，最多 5 条 FIFO 队列；上一轮结束后自动派发下一条。
- **异常自动暂停**：当前轮次被手动停止或因错误失败时，队列自动进入暂停态，等待用户手动恢复，避免用户不期望的连锁触发。
- **统一双端生效**：小索对话（`CaseDetailXiaosuo.vue`）与模块对话（`AnalysisModuleChat.vue`）通过共享基类 `useChatSessionManager` 获得两项能力，修改点最少。

### 2.2 非目标（显式 YAGNI）

- 队列跨 session 持久化（localStorage/数据库）
- 队列条目的编辑、拖拽排序、内容合并
- 队列满时的"自动丢弃最老一条"策略
- 跨标签页/跨设备同步队列状态
- 队列派发过程的独立进度条（队列 chip 本身即是进度可视化）

## 3. 用户决策摘要

以下决策在设计阶段与用户确认：

| 决策项 | 选择 |
|-------|------|
| 停止后已生成内容的处理 | 保留并标记"已取消"，写入 LangGraph checkpoint |
| 队列容量 | 最多 N=5 条，FIFO |
| 手动停止后队列行为 | 自动暂停，等待手动恢复 |
| 失败后队列行为 | 自动暂停，等待手动恢复 |
| 队列持久化范围 | 仅内存队列，组件 unmount 即丢失 |
| 队列 UI 呈现 | 输入框上方的 chip 列表 |
| 队列条目内容 | 文本 + 附件文件 + thinking 开关状态 |

## 4. 架构概览与数据结构

### 4.1 当前 bug 精确定位

基础设施已就绪但 UI 层存在三个问题：

1. **图标被 slot 覆盖**：`AiPromptInput.vue:135-140` 在 `<PromptInputSubmit>` 内用 `<SendHorizontal />` 作为 slot 内容，覆盖了 `PromptInputSubmit.vue:56-58` 中基于 `status` 切换的图标逻辑，导致 loading 态下仍显示发送图标。
2. **`stop` emit 未声明**：`PromptInputSubmit.vue` 仅声明了 `InputGroupButton` 继承的 props，**未**声明 `stop` emit。当前 `AiPromptInput.vue:136` 的 `@stop="emit('stop')"` 是无效监听。
3. **按钮被禁用**：`AiPromptInput.vue:270-281` 的 `isSubmitDisabled` 在 `!hasText && !hasAttachments` 时返回 `true`，即使修好图标也无法点击。

已有链路（不需修改）：
- `CaseDetailXiaosuo.vue:111` 已绑定 `@stop="xiaosuoChat.stopGeneration()"`
- `AiChat.vue:155` 已转发 `@stop`
- `useChatSessionManager.ts:165-169` 的 `stopGeneration` 双重取消（SSE + Worker）完整存在
- `server/services/agent/agentRun.service.ts:101-132` 的 Redis pub/sub → Worker AbortController 路径完整存在

### 4.2 状态归属

```
useChatSessionManager（共享基类）
├── 已有状态（不变）
│   ├── sessions / currentSessionId / isSessionLoading
│   └── currentChat 代理：messages, isLoading, runStatus, runError, interruptData
└── 新增状态
    ├── queuesBySession:   Map<sessionId, QueueItem[]>     全量队列（per-session 隔离）
    ├── queuePausedBy:     Map<sessionId, PauseReason>     暂停原因（per-session）
    └── 派生代理
        ├── currentQueue:    computed QueueItem[]
        ├── currentQueueLen: computed number
        ├── isQueuePaused:   computed boolean
        └── queuePauseReason:computed 'stopped' | 'failed' | null
```

### 4.3 数据结构

```typescript
// app/composables/chatQueue/types.ts
import type { OssFileItem } from '~/store/file'

export interface QueueItem {
  id: string              // nanoid()，仅用于 UI key 和删除定位
  text: string            // 原始用户输入文本
  files?: OssFileItem[]   // 前瞻性字段：当前两个对话场景均 enable-file-upload=false，
                          // 队列结构先行支持，实际派发时暂不传递（见 §5.6）
  thinking: boolean       // 入队时的"深度思考"开关状态
  enqueuedAt: number      // Date.now()
}

export type QueuePauseReason = 'stopped' | 'failed' | null

export const QUEUE_MAX_SIZE = 5
```

### 4.4 API 表面

`useChatSessionManager` 新增返回：

```typescript
return {
  // ... 已有返回值
  currentQueue,          // computed<QueueItem[]>
  currentQueueLen,       // computed<number>
  isQueuePaused,         // computed<boolean>
  queuePauseReason,      // computed<QueuePauseReason>
  enqueueMessage,        // (text, files?, thinking) => boolean
  removeQueueItem,       // (itemId: string) => void
  clearQueue,            // () => void
  resumeQueue,           // () => void
}
```

### 4.5 文件结构

```
app/composables/
├── useChatSessionManager.ts       已有，新增约 80~100 行队列逻辑
└── chatQueue/
    ├── types.ts                   新建：QueueItem / QUEUE_MAX_SIZE
    ├── queueActions.ts            新建：enqueue/remove/clear/pause/resume 的纯函数
    └── useQueueDispatcher.ts      新建：watch(isLoading) + watch(runStatus) 副作用收敛
app/components/ai/
└── AiChatQueueChips.vue           新建：队列 chip 列表组件
```

将 watcher 抽到 `useQueueDispatcher.ts` 的原因：它是整个队列机制中唯一有副作用的部分，与 manager 分离便于单测。

### 4.6 为什么使用 `Map<sessionId, QueueItem[]>` 而非单一 `ref<QueueItem[]>`

- 切换 session 时无需清空队列：A session 队列暂停时用户切到 B session 发送新话题、再切回 A 应看到原队列仍在
- 组件只读 `currentQueue` computed（基于 `currentSessionId.value` 派生），实际读取是 O(1)
- 组件 unmount 时 `effectScope.stop()` 销毁闭包，`Map` 随之被 GC，符合"仅内存"约束

## 5. 状态机与派发时序

### 5.1 状态机

```
                         ┌─────────────────┐
                         │                 │
                         ▼                 │
     ┌──────┐  enqueue  ┌─────────┐       │
     │ idle │──────────▶│ running │───────┘
     │      │◀──────────│         │ isLoading → false
     └──────┘  queue    └─────────┘ && 队列非空
        ▲     drained       │
        │     && 非loading  │ 手动停止 / runStatus=failed
        │                   ▼
        │                ┌────────┐
        └────────────────│ paused │
             resume &    └────────┘
             queue 空    ▲       │
                         │       │ enqueue（入队但不派发）
                         └───────┘
```

三种状态的派生规则（**`running` 与 `idle` 均为派生展示态，核心逻辑只依赖 `isLoading` / `queuePausedBy` / `currentQueue.length` 三个源**）：
- `idle` = 队列为空 且 `!isLoading.value` 且 `!isQueuePaused.value`
- `running` = `!isQueuePaused.value` 且（队列非空 或 `isLoading.value=true`）
- `paused` = `queuePausedBy.get(sid) !== null`

**只有 `paused` 需要显式存储**，其他状态由上面三个源派生。派发器（第 5.2 节）判断是否派发时，只读源状态，不读 `running`/`idle` 这两个标签。

### 5.2 派发器逻辑

所有副作用收敛在 `app/composables/chatQueue/useQueueDispatcher.ts`：

```typescript
// 伪代码
function useQueueDispatcher(deps: {
  currentSessionId: Ref<string | null>
  currentChat: ShallowRef<ChatInstance | null>
  isLoading: ComputedRef<boolean>
  runStatus: ComputedRef<AgentRunStatus>
  queuesBySession: Map<string, QueueItem[]>
  queuePausedBy: Map<string, QueuePauseReason>
  triggerReactivity: () => void
}) {
  // 触发器 1：isLoading true → false
  watch(isLoading, (next, prev) => {
    if (prev === true && next === false) {
      nextTick(() => maybeDispatch())
    }
  })

  // 触发器 2：runStatus 进入 failed/cancelled 自动暂停
  watch(runStatus, (status) => {
    if (status === 'failed' || status === 'cancelled') {
      const sid = currentSessionId.value
      if (!sid) return
      queuePausedBy.set(sid, status === 'failed' ? 'failed' : 'stopped')
      triggerReactivity()
    }
  })

  function maybeDispatch() {
    const sid = currentSessionId.value
    if (!sid) return
    if (queuePausedBy.get(sid)) return         // 守卫 1：暂停态
    if (isLoading.value) return                  // 守卫 2：仍在加载
    const queue = queuesBySession.get(sid) ?? []
    if (queue.length === 0) return               // 守卫 3：队列空

    const [head, ...rest] = queue
    queuesBySession.set(sid, rest)
    triggerReactivity()

    // 注意：files 字段在当前阶段不传递（见 §5.6）
    currentChat.value?.sendMessage(head.text, {
      thinking: head.thinking,
    })
  }

  return { maybeDispatch }
}
```

### 5.3 入队决策放在组件层

UI 组件 `handleSubmit` 根据 `isLoading` 决定走入队还是直接发送，**不**把分派逻辑塞进 `sendMessage` 内部：

```typescript
// CaseDetailXiaosuo.vue 修改后
function handleSubmit(data: { text: string; files?: OssFileItem[] }) {
  if (!data.text.trim() && !data.files?.length) return

  if (props.xiaosuoChat.isLoading.value) {
    const ok = props.xiaosuoChat.enqueueMessage(data.text, data.files, thinking.value)
    if (!ok) toast.warning(`队列已满（最多 ${QUEUE_MAX_SIZE} 条）`)
    else aiPromptInputRef.value?.reset()
  } else {
    props.xiaosuoChat.sendMessage(data.text, { thinking: thinking.value, files: data.files })
  }
}
```

好处：`enqueueMessage` 是纯状态操作，不需要判断"当前该发送还是入队"。

### 5.4 `resumeQueue` 行为

```typescript
function resumeQueue() {
  const sid = currentSessionId.value
  if (!sid) return
  queuePausedBy.set(sid, null)
  triggerReactivity()
  dispatcher.maybeDispatch()
}
```

### 5.5 竞态与守卫清单

| 竞态场景 | 守卫策略 |
|---------|---------|
| 用户快速连续按回车入队两条 | `enqueueMessage` 同步操作，按序执行 |
| `isLoading` true → false 瞬间用户点发送 | 组件层根据 `isLoading=false` 走 send 路径；dispatcher 的 `maybeDispatch` 会被守卫 2 拒绝 |
| 派发中用户切换 session | 旧 session 的 `effectScope.stop()` 销毁 watch，新 session 的 dispatcher 读新 sid 的队列 |
| 派发中组件 unmount | `effectScope.stop()` 销毁一切；Map 随闭包 GC |
| `runStatus='failed'` 与 `isLoading=false` 时序不一致 | `watch(isLoading)` 内 `nextTick(() => maybeDispatch())`，让 `watch(runStatus)` 先写 `queuePausedBy`，maybeDispatch 再读就能看到 |
| 派发的 chat 实例已被切换 | `currentChat.value` 是响应式读，switchSession 已 dispose 旧 chat；新 chat 实例的 `isLoading` 触发新的 watcher |

### 5.6 `useCaseChat.sendMessage` 现状与前瞻性决策

**Phase 0 已核对**（`app/composables/useCaseChat.ts:23-28`）：

```typescript
sendMessage: (message: string, opts?: { thinking?: boolean }) => {
    stream.submit({
        messages: [{ type: 'human', content: message }],
        thinking: opts?.thinking,
    } as any)
}
```

签名**仅接受** `text` 和 `thinking`，不支持 files。同时两个上层对话组件均硬编码 `:enable-file-upload="false"`（`CaseDetailXiaosuo.vue:108` 和 `AnalysisModuleChat.vue:108`），即现阶段 UI 根本不会产生 `files` 数据。

**决策**：
- `QueueItem.files` 字段**保留**在类型定义中（零成本的前瞻性设计）
- 派发器调用 `sendMessage` 时**不传递 files**，等同于队列目前只处理文本 + thinking
- **不扩展** `sendMessage` 签名，避免引入未使用的代码路径
- 当未来某个对话场景启用 `:enable-file-upload="true"` 时，届时一并扩展 `sendMessage` 签名和 dispatcher 传参（预计 <10 行改动）

此决策兼顾了用户"结构上支持文本+文件+thinking"的意图与当前代码现实，无需在本次实现中动 `useCaseChat`。

## 6. 按钮交互设计

### 6.1 按钮布局

```
非 loading 态（保持现状）:
[📎 上传] [🧠 深度思考]      ... [→ 发送]

loading 态（新增）:
[📎 上传] [🧠 深度思考]      ... [⏹ 停止] [→ 加入队列 +N]
```

**两个按钮的启用规则**：

| 按钮 | 图标 | 启用条件 | 点击行为 |
|-----|------|---------|---------|
| 停止 | `SquareIcon` | loading=true 时总是启用 | emit `stop` |
| 加入队列 | `SendHorizontal` + 角标 `+N` | loading=true 且 有文本或附件 且 队列未满 | emit `submit`（组件层 handleSubmit 分派到 `enqueueMessage`） |

细节：
- 队列满（`currentQueueLen >= QUEUE_MAX_SIZE`）时"加入队列"按钮置灰，tooltip "队列已满（最多 5 条）"
- 队列有内容时按钮右上角显示 `+N` badge，用户直观感知已排队数量
- 停止与加入队列之间 `gap-1` 视觉分组

### 6.2 回车键行为

回车键保持原 `@submit` 行为，由组件层 `handleSubmit` 根据 `isLoading` 分派（与点击按钮同逻辑）。**AiPromptInput 不处理入队语义**，仍是一个"输入 → 触发 submit"的纯 UI 组件。

### 6.3 AiPromptInput 改动清单

| 修改点 | 文件 | 说明 |
|-------|------|------|
| 新增 props `queueLength` / `queueFull` | `AiPromptInput.vue` | 由父组件传入 `:queue-length="xiaosuoChat.currentQueueLen"` |
| 重写 `isSubmitDisabled` | `AiPromptInput.vue:270-281` | 拆分为 `isEnqueueDisabled` / `isSendDisabled` |
| 按钮区域条件渲染 | `AiPromptInput.vue:134-141` | `v-if="loading"` 下渲染独立 `<Button>` 停止 + 加入队列；否则保持 `<PromptInputSubmit>` |
| 停止按钮 `@click="emit('stop')"` | `AiPromptInput.vue` | 绕开 `PromptInputSubmit` 缺失的 `stop` emit |
| 角标组件 | inline | `absolute -top-1 -right-1` + `Badge` 显示 `+N` |

### 6.4 不改动 `PromptInputSubmit.vue` 的理由

`PromptInputSubmit.vue` 属于 shadcn-vue `ai-elements` 生成的组件。虽不在 `app/components/ui/` 下，但沿用"不改第三方生成组件"原则，通过 `AiPromptInput.vue` 内部条件渲染绕开其限制。

### 6.5 可访问性

- 停止按钮 `aria-label="停止当前对话"`
- 加入队列按钮 `aria-label="加入发送队列（当前已有 N 条）"`
- 两按钮支持 Tab 聚焦
- 队列满时 `disabled + aria-disabled="true"`

## 7. 队列 Chip UI

### 7.1 挂载位置

通过 `AiChat.vue:152, 188` 已有的 `<template #prompt-actions />` slot 挂载。不改动 `AiPromptInput.vue` 内部。

```vue
<!-- CaseDetailXiaosuo.vue 修改后 -->
<AiChat ...>
  <template #prompt-actions>
    <div v-if="showRetryButton" class="...">...</div>
    <AiChatQueueChips
      :queue="xiaosuoChat.currentQueue"
      :max="QUEUE_MAX_SIZE"
      :paused="xiaosuoChat.isQueuePaused"
      :pause-reason="xiaosuoChat.queuePauseReason"
      @remove="xiaosuoChat.removeQueueItem"
      @resume="xiaosuoChat.resumeQueue"
      @clear="xiaosuoChat.clearQueue"
    />
  </template>
</AiChat>
```

> 注意：Vue 3 template 对 ref/computed 会自动解包，模板中**不写** `.value`。

新建组件 `app/components/ai/AiChatQueueChips.vue`，与 `AiChat.vue / AiPromptInput.vue` 同级，供小索与模块对话复用。

### 7.2 三种可视状态

**空队列**：组件整体 `v-if="queue.length > 0"` 不渲染。

**运行中**（例：2 条队列）：
```
┌────────────────────────────────────────────────┐
│ ⏳ 排队中 (2/5)                                │
│ ┌────────────────┐ ┌────────────────┐          │
│ │#1 帮我分析…× │ │#2 继续…  ×     │          │
│ └────────────────┘ └────────────────┘          │
└────────────────────────────────────────────────┘
```

**已暂停**（例：2 条队列因失败被暂停）：
```
┌────────────────────────────────────────────────┐
│ ⏸ 队列已暂停（上一条执行失败）[▶ 恢复] [🗑 清空] │
│ ┌────────────────┐ ┌────────────────┐          │
│ │#1 帮我分析…× │ │#2 继续…  ×     │          │
│ └────────────────┘ └────────────────┘          │
└────────────────────────────────────────────────┘
```

### 7.3 单个 Chip 的组成

参考 `AiPromptInput.vue:26-68` 文件 chip 样式保持视觉一致：

```
┌─────────────────────────────────────────┐
│ #1  帮我分析这个证据...  [📎2] [🧠] [×]  │
└─────────────────────────────────────────┘
  ↑    ↑                  ↑      ↑    ↑
  │    │                  │      │    └─ 删除按钮（hover 显示）
  │    │                  │      └──── thinking 图标
  │    │                  └──────────── 附件数量
  │    └─────────────────────────────── 文本前 24 字符 + ellipsis
  └──────────────────────────────────── 队列序号 badge
```

交互细节：
- 整 chip hover 显示 Tooltip，内容为完整文本 + 附件文件名列表
- `×` 按钮 hover 时显示
- 点击 `×` → emit `remove(itemId)` → manager `removeQueueItem(itemId)`
- **不支持**拖拽重排序、编辑（YAGNI）

### 7.4 暂停态可视化

```vue
<div :class="[
  'px-3 py-2 text-xs flex items-center gap-2',
  paused ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-b border-amber-200 dark:border-amber-500/30'
          : 'text-muted-foreground'
]">
  <template v-if="paused">
    <PauseIcon class="size-3.5" />
    <span>队列已暂停（{{ pauseReasonText }}）</span>
    <div class="ml-auto flex gap-1">
      <Button size="xs" variant="outline" @click="emit('resume')">
        <PlayIcon class="size-3 mr-1" /> 恢复队列
      </Button>
      <Button size="xs" variant="ghost" @click="emit('clear')">
        <TrashIcon class="size-3 mr-1" /> 清空
      </Button>
    </div>
  </template>
  <template v-else>
    <Loader2Icon class="size-3.5 animate-spin" />
    <span>排队中 ({{ queue.length }}/{{ max }})</span>
  </template>
</div>
```

`pauseReasonText` 映射：
- `stopped` → `"已手动停止"`
- `failed` → `"上一条执行失败"`

### 7.5 容器样式

```vue
<div v-if="queue.length > 0"
  class="border-t border-b bg-muted/30 flex flex-col max-h-[180px] overflow-y-auto">
  <!-- 顶部状态栏 -->
  <div class="flex flex-wrap gap-1.5 p-2">
    <!-- chips -->
  </div>
</div>
```

- 上下边框与 AiChat 分段视觉对齐
- `max-h-[180px]` 保护，N=5 基本不会触发滚动
- 空队列 `v-if` 完全不渲染

### 7.6 提示气泡

队列满时：`toast.warning('队列已满（最多 5 条），请等待当前对话结束或清空队列')`，使用项目已引入的 `vue-sonner`。

## 8. 错误场景与边界处理

### 8.1 异常场景清单

| # | 场景 | 处理策略 |
|---|------|---------|
| 1 | 派发后 `sendMessage` 底层 fetch 抛错 | `sendMessage` 已有 try-catch，写入 `runError` 并设 `runStatus='failed'`。`watch(runStatus)` 捕获 `failed` → 暂停队列 → 用户手动恢复 |
| 2 | 派发时 `currentChat.value === null` | `maybeDispatch` 用可选链 `currentChat.value?.sendMessage(...)`，null 时 silently 跳过。此时 `isLoading` watch 不会触发，因为新 chat 尚未启动 |
| 3 | 队列中某条消息的 files 已被后端删除 | 此场景仅在未来启用文件上传后才可能出现（当前 files 字段不被派发，见 §5.6）。届时后端 prompt 构造阶段报错 → 走场景 #1 的 `failed` 路径 → `watch(runStatus)` 自动暂停队列 |
| 4 | 队列有内容时删除当前 session | `deleteSession` 额外清理 `queuesBySession.delete(sessionId)` 和 `queuePausedBy.delete(sessionId)` |
| 5 | 派发中切换 session | 旧 session 的 effectScope 被 dispose → watch 停止，即使 isLoading 变 false 也不触发派发。剩余 queue 保留在 Map 中，切回即见 |
| 6 | 用户在已满队列再按回车 | `enqueueMessage` 返回 `false`，组件层 `handleSubmit` 显示 toast，输入框**不清空**（用户输入不丢失） |
| 7 | 用户刚 enqueue 未派发就点停止 | `stopGeneration` 触发，`runStatus='cancelled'` → 暂停队列。刚入队消息保留，等待恢复 |
| 8 | 派发的消息触发后端 interrupt | `interruptData` 被设置 → 现有 `<Dialog>` 弹出。**interrupt 开启期间 `isLoading` 仍为 true**，派发器不会提前 pop 下一条 |
| 9 | interrupt 确认后继续执行 | `isLoading` 保持 true 直到流式结束；正常结束后派发器检查暂停态决定是否 pop。interrupt 本身**不**暂停队列 |
| 10 | 同一条队列消息派发失败后是否重试 | `maybeDispatch` 是 pop-then-send，一条消息只被 pop 一次。失败后已不在队列里，用户如想重试需要重新输入 |
| 11 | reconnect 场景（重进浮窗） | reconnect 走 `currentChat.reconnect()`，新 chat 的 `isLoading` 由后端 run 状态决定。队列因上次 unmount 随 Map GC，是空的，符合"仅内存"设计 |

### 8.2 用户预期边界

- **"已取消的消息仍会计入对话历史"**：已生成部分由 LangGraph checkpoint 保存，队列派发的下一条看到的 context 包含这条残缺消息。属于期望行为。
- **"队列不是发送队列而是派发队列"**：每条独立发送、独立回复、独立计费，不会被合并。
- **"暂停态不自动解除"**：即便 AI 因其他原因进入 idle，暂停态只能由 `resumeQueue` 显式清除。
- **"删除 chip 不撤销已派发"**：当队列头派发后已不在 queue 中，删除操作只能作用于剩余条目。

### 8.3 防御性编程原则

1. **所有队列写操作走纯函数式更新**（符合项目 TypeScript coding-style 的 immutability 规则）
   ```typescript
   // ✅ 正确
   queuesBySession.set(sid, [...existing, newItem])
   // ❌ 禁止
   queuesBySession.get(sid)!.push(newItem)
   ```

2. **Map 响应式触发**：Vue 对 Map mutation 不敏感。采用 `shallowReactive(new Map())` + 显式替换值的策略，使 computed 能正确感知变化。

3. **错误日志不泄漏敏感信息**：派发失败时 `logger.error('[chat-queue] dispatch failed', { sessionId, itemId })`，不打印 `text` 内容。

4. **类型严格**：`QueueItem` 定义在 `app/composables/chatQueue/types.ts`，组件通过 `import type` 引入；`QUEUE_MAX_SIZE` 作为 `const` 导出便于测试替换。

## 9. 测试策略

遵循项目 TDD 规范（`.claude/rules/main.md`）与测试规范（`.claude/rules/testing.md`）：先写测试，再写实现，覆盖率 80%+。

### 9.1 测试分层

```
┌─ 纯逻辑层（单元测试）────────────────────┐
│ queueActions.ts 纯函数                  │
│ maybeDispatch 守卫逻辑                  │
└──────────────────────────────────────────┘
┌─ 响应式副作用层（集成测试）──────────────┐
│ watch(isLoading) → 派发时序              │
│ watch(runStatus) → 自动暂停              │
│ switchSession 切换队列视图               │
└──────────────────────────────────────────┘
┌─ 组件层（组件测试）─────────────────────┐
│ AiChatQueueChips 三态渲染                │
│ AiPromptInput 停止/加入队列按钮          │
└──────────────────────────────────────────┘
┌─ E2E 层（Playwright）────────────────────┐
│ 小索浮窗停止 + 入队 + 恢复关键路径       │
└──────────────────────────────────────────┘
```

### 9.2 单元测试：纯队列逻辑

**文件**：`tests/unit/composables/chatQueue/queueActions.test.ts`

要覆盖的纯函数：
- `enqueueAction`：未满成功 / 已满失败 / 新 session 自动创建空队列 / immutable 保证
- `removeAction`：按 id 删除 / id 不存在不报错 / 删除后 length 正确
- `clearAction`：只清当前 session / 其他 session 不受影响
- `pauseAction` / `resumeAction`：状态切换 / 原因透传

示例：

```typescript
describe('enqueueAction', () => {
  it('队列未满时添加成功', () => {
    const before = new Map([['sess-a', []]])
    const { next, ok } = enqueueAction(before, 'sess-a', makeItem('你好'))
    expect(ok).toBe(true)
    expect(next.get('sess-a')).toHaveLength(1)
    expect(before.get('sess-a')).toHaveLength(0) // 旧 Map 未被 mutate
  })

  it('队列满时返回 false 且 Map 不变', () => {
    const full = new Map([['sess-a', Array.from({ length: 5 }, makeItem)]])
    const { next, ok } = enqueueAction(full, 'sess-a', makeItem('第六'))
    expect(ok).toBe(false)
    expect(next).toBe(full)
  })

  it('不同 session 的队列相互隔离', () => { /* ... */ })
})
```

### 9.3 集成测试：响应式派发

**文件**：`tests/unit/composables/useChatSessionManager.test.ts`

Mock `useCaseChat` 返回可控实例：

```typescript
const mockChat = {
  messages: ref([]),
  isLoading: ref(false),
  runStatus: ref<AgentRunStatus>('idle'),
  runError: ref(''),
  interruptData: ref(null),
  sendMessage: vi.fn(),
  stopGeneration: vi.fn(),
  loadHistory: vi.fn(),
  reconnect: vi.fn(),
}
vi.mock('~/composables/useCaseChat', () => ({ useCaseChat: () => mockChat }))
```

要覆盖的用例：

| 用例 | 步骤 | 断言 |
|-----|------|------|
| 派发 happy path | enqueue 2 → `isLoading: true → false` | `sendMessage` 调用一次，传队头 item |
| 连续 pop | `isLoading` 来回切换两次 | `sendMessage` 依次调用 2 次，队列最终空 |
| 暂停守卫（cancelled） | enqueue 2 → `runStatus='cancelled'` → `isLoading: true → false` | `sendMessage` 未被调用，队列保留，`isQueuePaused=true` |
| 失败守卫（failed） | enqueue 2 → `runStatus='failed'` → `isLoading: true → false` | 同上，`queuePauseReason='failed'` |
| 手动恢复 | 暂停后 `resumeQueue()` | `sendMessage` 调用一次，暂停态清除 |
| 切换 session 不派发旧队列 | sess-A enqueue 2 → `switchSession('sess-B')` → 模拟 sess-A `isLoading` 变化 | `sendMessage` 不被调用（因 effectScope dispose） |
| 切换回 session 看见原队列 | 同上 → 切换回 sess-A | `currentQueue.value` 长度为 2 |
| 删除 session 清理队列 | sess-A enqueue 2 → `deleteSession('sess-A')` | `queuesBySession.has('sess-A')` 为 false |
| interrupt 期间不派发 | enqueue 1 → `interruptData` 设置但 `isLoading` 保持 true | `sendMessage` 未被调用 |
| 队列满 | 已有 5 条再 enqueue | 返回 `false` |

**时序控制**：用 `flushPromises()` 和 `await nextTick()` 精确控制 watch 执行顺序，验证"runStatus 先于 isLoading false"的时序用例。

### 9.4 组件测试：`AiChatQueueChips.vue`

**文件**：`tests/unit/components/AiChatQueueChips.test.ts`

| 用例 | 断言 |
|-----|------|
| 空队列不渲染 | 容器不存在 |
| 2 条运行中 | 顶部 "排队中 (2/5)"，2 个 chip |
| 1 条暂停 stopped | "队列已暂停（已手动停止）" + 恢复 + 清空 按钮 |
| 1 条暂停 failed | "队列已暂停（上一条执行失败）" |
| 点 × 删除 chip | emit `remove` 携带正确 itemId |
| 点恢复按钮 | emit `resume` |
| 点清空按钮 | emit `clear` |
| chip 文本超长截断 + tooltip | chip 文本以 `...` 结尾，tooltip 显示完整 |
| 有附件显示 📎N badge | 数字正确 |
| thinking=true 显示 🧠 图标 | `BrainIcon` 存在 |

### 9.5 组件测试：`AiPromptInput.vue` 按钮改动

**文件**：`tests/unit/components/AiPromptInput.test.ts`（若已存在则扩展）

| 用例 | 断言 |
|-----|------|
| loading=false 时只有发送按钮 | 无停止按钮，发送按钮可见 |
| loading=true 输入为空 | 停止按钮可用，加入队列按钮禁用 |
| loading=true 输入有内容 | 停止 + 加入队列 都可点击 |
| loading=true 队列满 | 加入队列按钮禁用，tooltip "队列已满" |
| 有队列内容时角标 `+N` | Badge 文字正确 |
| 点击停止按钮 | emit `stop` |
| 点击加入队列按钮 | emit `submit` |
| 回车键 submit 行为不变 | emit `submit` |

### 9.6 E2E 测试（Playwright）

**文件**：`tests/e2e/xiaosuo-chat-queue.spec.ts`

**前置**：测试数据库 `ls_new_testing` + mock LLM provider（echo 模式）

```typescript
test('小索对话停止按钮和队列关键路径', async ({ page }) => {
  await loginAs(page, 'test-user')
  await openCaseDetail(page, 'test-case-id')
  await page.click('[data-testid="xiaosuo-icon"]')

  // 1. 发送第一条，开始生成
  await page.fill('[data-testid="ai-prompt-input"]', '第一个问题')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-testid="ai-message-assistant"]')).toBeVisible()

  // 2. 在生成中输入第二条入队
  await page.fill('[data-testid="ai-prompt-input"]', '第二个问题')
  await page.click('[data-testid="enqueue-button"]')
  await expect(page.locator('[data-testid="queue-chip"]')).toHaveCount(1)

  // 3. 点停止
  await page.click('[data-testid="stop-button"]')
  await expect(page.locator('text=队列已暂停')).toBeVisible()

  // 4. 点恢复
  await page.click('[data-testid="queue-resume"]')
  await expect(page.locator('[data-testid="queue-chip"]')).toHaveCount(0)
  await expect(page.locator('[data-testid="ai-message-assistant"]').nth(1)).toBeVisible()
})
```

E2E 命令：`npx playwright test tests/e2e/xiaosuo-chat-queue.spec.ts`

### 9.7 覆盖率目标

- 纯函数层：100%
- Manager + dispatcher：≥ 90%
- 组件层：关键交互 100%
- 项目总覆盖率门槛：保持 80%

### 9.8 类型检查

所有新增 TS 文件完成后运行 `npx nuxi typecheck`（项目规范明确用 `nuxi typecheck` 而非 `tsc`），作为 PR 提交前硬门槛。

## 10. 实现阶段的前置验证结果

**Phase 0 已在 spec 阶段完成**，规划阶段无需重复核对：

- **`useCaseChat.sendMessage` 签名**：`app/composables/useCaseChat.ts:23-28`，当前仅接受 `(text, { thinking })`，不支持 files。决策见 §5.6：本次实现**不扩展**此签名。
- **模块对话组件入口**：`app/components/case/AnalysisModuleChat.vue`
  - `handleSubmit`：line 67
  - `@stop` 绑定：line 111
  - `:enable-file-upload="false"`：line 108
  - 结构与 `CaseDetailXiaosuo.vue` 完全对称，改造逻辑可 1:1 复用
- **文件上传的现状**：小索对话（line 108）和模块对话（line 108）均硬编码 `:enable-file-upload="false"`，`files` 字段是前瞻性设计，当前不会产生数据

## 11. 影响评估

### 11.1 修改的文件

| 文件 | 修改类型 |
|-----|---------|
| `app/composables/useChatSessionManager.ts` | 扩展：新增队列状态 + API |
| `app/components/ai/AiPromptInput.vue` | 修复按钮交互 + 新增 props |
| `app/components/caseDetail/CaseDetailXiaosuo.vue` | `handleSubmit` 分派 + 挂载 queue chips |
| `app/components/case/AnalysisModuleChat.vue` | `handleSubmit` 分派 + 挂载 queue chips（与小索对称改造） |

### 11.2 新建的文件

| 文件 | 说明 |
|-----|------|
| `app/composables/chatQueue/types.ts` | QueueItem / QueuePauseReason / QUEUE_MAX_SIZE |
| `app/composables/chatQueue/queueActions.ts` | 纯函数：enqueue / remove / clear / pause / resume |
| `app/composables/chatQueue/useQueueDispatcher.ts` | watcher 副作用 |
| `app/components/ai/AiChatQueueChips.vue` | 队列 chip 组件 |
| `tests/unit/composables/chatQueue/queueActions.test.ts` | 纯函数单测 |
| `tests/unit/composables/useChatSessionManager.test.ts` | 响应式集成测试 |
| `tests/unit/components/AiChatQueueChips.test.ts` | 组件测试 |
| `tests/e2e/xiaosuo-chat-queue.spec.ts` | E2E 测试 |

### 11.3 不修改的文件

- `app/components/ai-elements/prompt-input/PromptInputSubmit.vue`（shadcn 生成组件，绕开而非修改）
- `app/composables/useCaseChat.ts`（签名本次不扩展，见 §5.6）
- `server/services/agent/*`（后端取消机制已完整存在）
- 数据库 schema（无持久化需求）

## 12. 决策日志

Spec 阶段确认的关键决策，规划与实现阶段无需重新争论：

| 决策点 | 决定 | 理由 |
|-------|-----|------|
| 队列归属层 | `useChatSessionManager` 基类 | 双端一次修改生效，与 session 切换天然协同 |
| 队列容量 | 5 条 FIFO | 够用且避免用户"连发 10 条"式 UX 混乱 |
| 停止后处理 | 保留已生成内容标记"已取消" | 符合 ChatGPT / Claude.ai 既有心智 |
| 失败后处理 | 自动暂停，等待手动恢复 | 与停止路径对称，避免故障连锁 |
| 持久化范围 | 仅内存，unmount 即丢 | YAGNI，避免跨标签页冲突 |
| files 字段 | 类型结构保留，运行时不传递 | 前瞻性设计，零成本，未来启用文件上传时扩展简单 |
| `sendMessage` 签名 | 本次**不**扩展 | 当前 UI 不产生 files 数据，避免死代码 |
| 停止 vs 加入队列 UI | 两按钮并排 | 避免"单按钮两种模式"的认知负担 |
