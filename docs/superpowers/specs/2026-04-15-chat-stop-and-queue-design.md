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

- 队列跨**设备**持久化（localStorage 长期存储 / 数据库）
- 队列条目的编辑、拖拽排序、内容合并
- **FIFO 溢出丢弃策略**：当队列达到上限时**拒绝新入队**（向用户 toast 提示），而非丢弃最老一条。本次采用"拒绝新入队"策略，不实现"自动丢弃最老一条"
- 队列派发过程的独立进度条（队列 chip 本身即是进度可视化）

### 2.3 跨标签同步范围

- **同步**：跨浏览器标签的**同一 session**窗口（用户可能在两个 tab 打开同一个案件），队列状态与派发互斥
- **不同步**：跨设备、跨用户会话、不同 session 之间

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
// app/composables/chatQueueActions.ts（类型 + 常量与纯函数同文件）
import type { OssFileItem } from '~/store/file'

export interface QueueItem {
  id: string              // nanoid()，仅用于 UI key 和删除定位
  text: string            // 原始用户输入文本
  files?: OssFileItem[]   // 前瞻性字段：当前两个对话场景均 enable-file-upload=false，
                          // 队列结构先行支持，实际派发时暂不传递（见 §5.6）
  thinking: boolean       // 入队时的"深度思考"开关状态
  enqueuedAt: number      // Date.now()，用于排序与跨标签同步的时序校验
  originTabId: string     // 入队的 tab 唯一标识，跨标签审计用（见 §13）
}

export type QueuePauseReason = 'stopped' | 'failed' | null

export const QUEUE_MAX_SIZE = 5
```

`nanoid` 已在项目 package.json 中（`"nanoid": "^5.1.6"`），直接使用即可。

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

内部新增 `lastLocalSendSeq: Ref<number>`（默认 0），在封装后的 `sendMessage` 和 `doDispatch` 内 `++`，供 `useQueueDispatcher` 的溯源守卫读取。不暴露给外部。

### 4.5 文件结构

项目现有 `app/composables/` 下 35 个 composable 均为**扁平组织**，本次保持一致，不新建子目录：

```
app/composables/
├── useChatSessionManager.ts       已有，新增约 120~150 行队列逻辑 + 跨标签集成
├── chatQueueActions.ts            新建：纯函数 + 类型 + 常量（enqueue/remove/clear/pause/resume）
└── useQueueDispatcher.ts          新建：watch(runStatus) + Web Locks 互斥 + 跨标签广播
app/components/ai/
└── AiChatQueueChips.vue           新建：基于 ai-elements/queue 基元组件组合
```

**职责分工**：
- `chatQueueActions.ts`：纯函数 + `QueueItem` / `QueuePauseReason` / `QUEUE_MAX_SIZE` 类型与常量，零响应式依赖，100% 单元可测
- `useQueueDispatcher.ts`：响应式副作用收敛，watch `runStatus`（**非** `isLoading`）触发派发、watch 跨标签事件同步状态，用 `navigator.locks` 保证分布式互斥
- `useChatSessionManager.ts`：组合以上二者，向上暴露 `currentQueue` / `enqueueMessage` / `resumeQueue` 等 API

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
     │      │◀──────────│         │ runStatus=completed
     └──────┘  queue    └─────────┘ && 队列非空
        ▲     drained       │
        │     && !loading   │ 手动停止 / runStatus=failed|cancelled
        │                   ▼
        │                ┌────────┐
        └────────────────│ paused │
             resume &    └────────┘
             queue 空    ▲       │
                         │       │ enqueue（入队但不派发）
                         └───────┘
```

三种状态的派生规则（**`running` 与 `idle` 均为派生展示态；核心派发逻辑由 `runStatus`、`interruptData`、`isLoading`、`queuePausedBy` 四个源驱动**）：
- `idle` = 队列为空 且 `!isLoading.value` 且 `!isQueuePaused.value`
- `running` = `!isQueuePaused.value` 且（队列非空 或 `isLoading.value=true`）
- `paused` = `queuePausedBy.get(sid) !== null`

**只有 `paused` 需要显式存储**，其他状态由上面四个源派生。派发器（第 5.2 节）判断是否派发时只读源状态，不读 `running`/`idle` 这两个 UI 标签。

### 5.2 派发器逻辑

**核心设计决策（修订后 v2）**：派发器的触发源是 **`watch(runStatus)`** 而非 `watch(isLoading)`，**并叠加"本地发送溯源"守卫**避免 reconnect 重放的 `status_change: completed` 误触发。

**为什么叠加本地发送守卫**：`server/api/v1/case/analysis/chat.post.ts:270` 的 `replayEvents(runId)` 会在 reconnect 时补发 Redis Stream 历史事件，包括 `status_change: running/completed`。`useStreamChat.ts:52-55` 的 `onCustomEvent` 会把这些事件写入本地 `runStatus`。所以单靠 `watch(runStatus === 'completed')` 仍会在 reconnect 时误派发。**解决方案**：引入 `lastLocalSendSeq` / `lastDispatchedSeq` 两个计数器，只有"本 tab 曾本地调用过 `sendMessage`（序号大于上次派发的）"才允许派发下一条。reconnect 重放不经过本地 `sendMessage`，seq 不增长，守卫拒绝。

```typescript
// app/composables/useQueueDispatcher.ts
import { effectScope, nextTick, ref } from 'vue'
import { postCrossTabEvent, useCrossTabListener } from '~/composables/useCrossTabEvents'

function useQueueDispatcher(deps: {
  currentSessionId: Ref<string | null>
  currentChat: ShallowRef<ChatInstance | null>
  runStatus: ComputedRef<AgentRunStatus | 'idle'>
  isLoading: ComputedRef<boolean>
  interruptData: ComputedRef<unknown>
  queuesBySession: Map<string, QueueItem[]>       // 由 reactive(new Map()) 提供，见 §8.3
  queuePausedBy: Map<string, QueuePauseReason>
  tabId: string                                    // 由 onMounted 闭包生成（见 §5.7）
  /** 本 tab 本地发送过的累计次数，每次 sendMessage 前 ++ */
  lastLocalSendSeq: Ref<number>
}) {
  // 本 tab 已派发到的本地发送序号，用于溯源守卫
  let lastDispatchedSeq = 0

  // 触发器：watch runStatus 到终止态
  watch(deps.runStatus, (next, prev) => {
    const sid = deps.currentSessionId.value
    if (!sid) return

    // 暂停路径：failed / cancelled 自动暂停队列
    if (next === 'failed' || next === 'cancelled') {
      deps.queuePausedBy.set(sid, next === 'failed' ? 'failed' : 'stopped')
      broadcastState(sid)
      return
    }

    // 派发路径：仅真正 completed 才派发下一条
    if (next === 'completed' && prev !== 'completed') {
      // 溯源守卫：只有"本 tab 本地发送过新消息"才允许派发
      // reconnect 重放的 completed 不经过本地 sendMessage，seq 未增长，守卫拒绝
      if (deps.lastLocalSendSeq.value > lastDispatchedSeq) {
        lastDispatchedSeq = deps.lastLocalSendSeq.value
        nextTick(() => maybeDispatch())
      }
    }

    // interrupted：不暂停也不派发（Dialog 由 interruptData 驱动）
    // pending / running / idle：不做任何操作
  })

  async function maybeDispatch() {
    const sid = deps.currentSessionId.value
    if (!sid) return
    if (deps.queuePausedBy.get(sid)) return                 // 守卫 1：暂停态
    if (deps.interruptData.value) return                    // 守卫 2：等待 interrupt
    if (deps.isLoading.value) return                        // 守卫 3：仍在加载
    if (!deps.currentChat.value) return                     // 守卫 4：chat 实例尚未就绪

    const queue = deps.queuesBySession.get(sid) ?? []
    if (queue.length === 0) return                          // 守卫 5：队列空

    // 守卫 6：跨标签分布式互斥（Web Locks API）
    if (typeof navigator !== 'undefined' && navigator.locks) {
      await navigator.locks.request(
        `chat-queue-dispatch:${sid}`,
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          if (!lock) return // 另一 tab 已拿到锁，本 tab 放弃派发
          await doDispatch(sid)
        },
      )
    } else {
      await doDispatch(sid)
    }
  }

  async function doDispatch(sid: string) {
    // 锁内再次读取最新队列（其他 tab 可能已 pop）
    const latest = deps.queuesBySession.get(sid) ?? []
    if (latest.length === 0) return

    const [head, ...rest] = latest

    try {
      // 【关键】必须在 sendMessage 之前自增 lastLocalSendSeq。
      // 因为 dispatcher 直接调用 currentChat.sendMessage（useCaseChat 原始方法），
      // 绕过了 useChatSessionManager 的 sendMessage wrapper，wrapper 中的 ++ 不生效。
      // 若缺失此行，派发第一条后 lastDispatchedSeq=1 会永远等于 lastLocalSendSeq=1，
      // watch 守卫 `seq > lastDispatchedSeq` 永远为 false，队列死锁。
      deps.lastLocalSendSeq.value++

      // 先调 sendMessage：失败时下方 set 不执行，队头仍在 queue 中
      // 注意：files 字段在当前阶段不传递（见 §5.6）
      deps.currentChat.value?.sendMessage(head.text, { thinking: head.thinking })
      // 成功则 pop 并广播
      deps.queuesBySession.set(sid, rest)
      broadcastState(sid)
    } catch (err) {
      // sendMessage 同步抛错：显式暂停队列并广播
      // （队头仍在 queue 中，用户可"恢复队列"时重试）
      console.error('[chat-queue] dispatch failed', { sessionId: sid, itemId: head.id })
      deps.queuePausedBy.set(sid, 'failed')
      broadcastState(sid)
    }
  }

  function broadcastState(sid: string) {
    postCrossTabEvent('chat-queue:sync', {
      sessionId: sid,
      tabId: deps.tabId,
      queue: deps.queuesBySession.get(sid) ?? [],
      pauseReason: deps.queuePausedBy.get(sid) ?? null,
      version: performance.now() + Math.random(), // 双因子避免毫秒级碰撞
    })
  }

  return { maybeDispatch, broadcastState }
}
```

**关键要点**：
1. 派发器**必须在 manager 的 setup 顶层注册**（与 `sessions` ref 同级，自动绑定调用方 setup scope），**不**进 `switchSession` 内部新建的 inner `effectScope`。这样 session 切换不会 dispose dispatcher 的 watcher。
2. **溯源守卫**是 C1 真正的修复：`lastLocalSendSeq` 在**两处**都必须 `++`：
   - `useChatSessionManager.sendMessage` wrapper 内（用户直接发送路径）
   - `useQueueDispatcher.doDispatch` 内 `try` 块、`sendMessage` 调用之前（队列派发路径）

   **为何两处都要**：dispatcher 直接调 `deps.currentChat.value?.sendMessage`（`useCaseChat` 原始方法），**绕过**了 `useChatSessionManager` 的 wrapper。若 doDispatch 不自增，派发第一条后 `lastDispatchedSeq == lastLocalSendSeq == 1`，守卫 `seq > lastDispatchedSeq` 永假，队列死锁。
3. **`resumeQueue` 手动调用 `maybeDispatch` 时有意绕过 seq 守卫**（seq 守卫只存在于 `watch(runStatus)` 回调中，不在 `maybeDispatch` 入口）。这让"tab B 继承 tab A 留下的暂停队列后手动恢复"成为可能。**不要**将 seq 守卫下沉到 `maybeDispatch` 内——会破坏跨 tab 继承路径。
4. `doDispatch` 的 try/catch 确保 `sendMessage` 同步异常时**队头仍保留**（set 未执行）且**暂停态被显式写入**，避免"锁释放后其他 tab 看到旧队头重复派发"的双发。
5. `broadcastState` 在所有 Map 变化后调用，是跨标签同步的唯一出口；**listener 接收时不得再触发 broadcastState**（见 §5.7）。

### 5.3 入队决策放在组件层

UI 组件 `handleSubmit` 根据 `isLoading` **和** `isQueuePaused` 决定走入队还是直接发送，**不**把分派逻辑塞进 `sendMessage` 内部：

```typescript
// CaseDetailXiaosuo.vue 修改后
import { toast } from 'vue-sonner'
import { QUEUE_MAX_SIZE } from '~/composables/chatQueueActions'

function handleSubmit(data: { text: string; files?: OssFileItem[] }) {
  if (!data.text.trim() && !data.files?.length) return

  const shouldEnqueue = props.xiaosuoChat.isLoading.value || props.xiaosuoChat.isQueuePaused.value

  if (shouldEnqueue) {
    const ok = props.xiaosuoChat.enqueueMessage(data.text, data.files, thinking.value)
    if (!ok) toast.warning(`队列已满（最多 ${QUEUE_MAX_SIZE} 条）`)
    else aiPromptInputRef.value?.reset()
  } else {
    props.xiaosuoChat.sendMessage(data.text, { thinking: thinking.value })
  }
}
```

**关键补充**：
1. 暂停态下（`isQueuePaused === true`），即便 `isLoading === false`，用户新发的消息也应**进入队列尾部**而不是直接发送。否则会形成"用户直接发新消息 + 残留暂停队列"的错乱 UI。用户必须显式点击"恢复队列"或"清空"才能回到普通发送路径。
2. **`useChatSessionManager.sendMessage` 必须包装一层**，在实际调用 `currentChat.value?.sendMessage` 之前 `lastLocalSendSeq.value++`，为 dispatcher 的溯源守卫（§5.2）提供信号：
   ```typescript
   // 在 useChatSessionManager 内部
   function sendMessage(text: string, opts?: { thinking?: boolean }) {
     lastLocalSendSeq.value++
     currentChat.value?.sendMessage(text, opts)
   }
   ```
   `doDispatch` 内部也遵守这一不变式：在 catch 之外、`sendMessage` 之前 `lastLocalSendSeq.value++`，保证下一轮 completed 能正确派发下一条。
3. **暂停态 + 队列清空的死锁防护**：`clearQueue` 和最后一次 `removeQueueItem`（即移除后队列变空）的实现中，**自动** `queuePausedBy.delete(sid)` 并广播，避免"用户删光所有 chip 后仍锁在暂停态无法发送"的死锁（见 §8.1 场景 #17）：
   ```typescript
   function removeQueueItem(itemId: string) {
     const sid = currentSessionId.value
     if (!sid) return
     const current = queuesBySession.get(sid) ?? []
     const next = current.filter(i => i.id !== itemId)
     queuesBySession.set(sid, next)
     // 队列变空时自动清除暂停标记
     if (next.length === 0) queuePausedBy.delete(sid)
     broadcastState(sid)
   }

   function clearQueue() {
     const sid = currentSessionId.value
     if (!sid) return
     queuesBySession.set(sid, [])
     queuePausedBy.delete(sid)   // 清空同时重置暂停态
     broadcastState(sid)
   }
   ```

`enqueueMessage` 仍是纯状态操作，不需要判断"当前该发送还是入队"——**组件层**做这个决策。

### 5.4 `resumeQueue` 行为

```typescript
function resumeQueue() {
  const sid = currentSessionId.value
  if (!sid) return
  queuePausedBy.set(sid, null)
  broadcastState(sid)
  // 主动触发一次派发尝试（此时 isLoading 应为 false）。
  // 注意：此路径**有意**不经过 seq 守卫（seq 守卫仅存在于 watch(runStatus) 回调），
  // 用于支持"tab B 继承 tab A 留下的暂停队列后手动恢复"的跨 tab 场景。
  dispatcher.maybeDispatch()
}
```

### 5.5 竞态与守卫清单

| 竞态场景 | 守卫策略 |
|---------|---------|
| 用户快速连续按回车入队两条 | `enqueueMessage` 同步操作，按序执行 |
| **reconnect 重放后端历史事件误派发** | `server/api/v1/case/analysis/chat.post.ts:270` 的 `replayEvents` 会补发 `status_change: running/completed`。**派发器的溯源守卫**（`lastLocalSendSeq` / `lastDispatchedSeq`）确保只有本 tab 本地 `sendMessage` 调用后的 completed 才触发派发。reconnect replay 不经过本地 sendMessage，seq 不增长，守卫拒绝 |
| `loadHistory`（无活跃 run）假边沿 | 后端走 `isCompletedRun` 分支只发 values，不发 `status_change`，runStatus 保持 idle，watcher 不触发 |
| `interrupted` 状态下 isLoading 可能变 false | `maybeDispatch` 守卫 2：`if (interruptData.value) return`；`watch(runStatus)` 对 `'interrupted'` 不做任何操作 |
| 派发时 `currentChat.value === null` | `maybeDispatch` 守卫 4 提前 return，不会 pop 队头；避免数据丢失 |
| **`doDispatch` 内 `sendMessage` 同步抛错** | `try/catch` 捕获：set 未执行 → 队头保留；catch 分支显式 `queuePausedBy.set(sid, 'failed')` + `broadcastState`。避免"锁释放后其他 tab 看到旧队头重复派发" |
| 派发中组件 unmount | manager setup scope 销毁 dispatcher 的 watch；Map 随闭包 GC |
| **同一 session 多 tab 同时派发** | `navigator.locks.request(...ifAvailable: true)` 确保只有一个 tab 持锁派发，其他 tab 跳过；即便持锁 tab 抛错也通过上面的 try/catch 保持状态一致 |
| 派发的 chat 实例已被切换 | `switchSession` 先 dispose 旧 chat 的 inner scope；dispatcher 挂在**manager setup 顶层**不受影响，读 `currentSessionId.value` 永远是最新 sid |
| `deleteSession` 清理时序 | 顺序：①调用 delete API → ②`queuesBySession.delete(sid)` + `queuePausedBy.delete(sid)` → ③广播 `chat-queue:sync` with `queue: []` 通知其他 tab → ④`sessions.value.filter(...)` 从数组移除 → ⑤`switchSession` 到下一条或 `createSession` 新建。顺序 ②+③ 必须在 ⑤ switchSession 之前 |
| **跨标签 broadcast 风暴** | Listener 必须遵守 §5.7 硬约束：接收 `chat-queue:sync` 后**只写本地 Map**，**绝不**再调用 `broadcastState`；`tabId !== self` 守卫过滤自回；`version` 单调递增丢弃过期 |
| **late-join 多 tab 同时响应 hello** | `version = performance.now() + Math.random()` 双因子避免毫秒级碰撞；接收方 last-writer-wins 最终收敛 |
| 停止按钮快速连点 | 组件层 `isStopping` ref 守卫（见 §6.6），按下后置灰，`runStatus → cancelled` 或 3s 超时复位 |
| **暂停态下队列被清空后死锁** | `clearQueue` 和最后一次 `removeQueueItem` 实现中：若结果队列变空，自动 `queuePausedBy.delete(sid)` 清除暂停标记并广播（见 §8.1 场景 #17） |
| 暂停态下用户点击发送按钮 | `handleSubmit` 同时检查 `isLoading` 和 `isQueuePaused`，任一为真则入队而非发送 |

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

### 5.7 跨标签同步协议

复用项目已有的 `app/composables/useCrossTabEvents.ts`（基于 BroadcastChannel 的 fire-and-forget 事件总线），不新建通信层。

**与现有模式的差异**：项目现有的 6 个 `useCrossTabListener` 调用点（`useInitAnalysis.ts` / `useCaseDetail.ts` / `useModuleChatManager.ts` 等）均采用 **"收到事件 → refetch API"** 的模式。本 spec 的 `chat-queue:sync` **首次**采用 **"payload 作为 source of truth，接收方直接 merge 到本地 Map"** 的模式。**原因**：队列无服务端持久化（见 §2.2），接收方**无法 refetch**，只能信任 payload。此偏离是**必需而非错误**，后续维护者不应误以为"漏了 refetch"。

**新增事件**（扩展 `CrossTabEvents` interface）：

```typescript
// 在 app/composables/useCrossTabEvents.ts 的 CrossTabEvents interface 中新增
export interface CrossTabEvents {
  // ... 已有事件

  /** 队列状态完整快照（mutate 后广播） */
  'chat-queue:sync': {
    sessionId: string
    tabId: string                // 发送方 tab 标识，接收方用于自回过滤
    queue: QueueItem[]           // 完整队列快照
    pauseReason: QueuePauseReason
    version: number              // performance.now() + Math.random()，双因子避免毫秒级碰撞
  }

  /** 新 tab 打开 session 时请求状态 */
  'chat-queue:hello': {
    sessionId: string
    tabId: string
  }
}
```

**接收方实现（重要：必须严格按此模式，否则产生广播风暴）**：

```typescript
// 在 useChatSessionManager setup 顶层
const lastAppliedVersion = new Map<string, number>()

useCrossTabListener('chat-queue:sync', (payload) => {
  // 守卫 1：忽略自己广播的 echo
  if (payload.tabId === tabId) return
  // 守卫 2：忽略过期广播（version 小于等于已应用的）
  const sid = payload.sessionId
  const lastV = lastAppliedVersion.get(sid) ?? 0
  if (payload.version <= lastV) return
  lastAppliedVersion.set(sid, payload.version)

  // 应用到本地 Map（不再调用 broadcastState，避免风暴）
  queuesBySession.set(sid, payload.queue)
  if (payload.pauseReason === null) queuePausedBy.delete(sid)
  else queuePausedBy.set(sid, payload.pauseReason)
})

useCrossTabListener('chat-queue:hello', (payload) => {
  if (payload.tabId === tabId) return
  const sid = payload.sessionId
  // 仅当本 tab 持有该 session 的队列状态时回应
  if (queuesBySession.has(sid) || queuePausedBy.has(sid)) {
    postCrossTabEvent('chat-queue:sync', {
      sessionId: sid,
      tabId,
      queue: queuesBySession.get(sid) ?? [],
      pauseReason: queuePausedBy.get(sid) ?? null,
      version: performance.now() + Math.random(),
    })
  }
})
```

**硬约束（代码注释级）**：`useCrossTabListener('chat-queue:sync', ...)` 的回调**绝对不能**再调用 `broadcastState` 或 `postCrossTabEvent('chat-queue:sync', ...)`，否则形成死循环。接收路径纯粹是"写本地 Map"，不触发外广播。

**Tab ID 生成（重要：避免 SSR 陷阱）**：

```typescript
// 在 useChatSessionManager setup 顶层
import { nanoid } from 'nanoid'

let tabId = ''
onMounted(() => {
  // 必须在 onMounted 内生成，避免 Nuxt useState 在 SSR 阶段 hydration
  // 导致同一浏览器的所有 tab 共享同一个 tabId
  tabId = nanoid()
})
```

**不能使用** `useState('chat-tab-id', () => nanoid())`：Nuxt `useState` 在 SSR 时执行工厂并 hydration 到客户端，**同一浏览器所有 tab 共享同一个 tabId**，破坏"每 tab 独立"的前提。

**协议流程**：

| 动作 | 发起方 | 接收方行为 |
|-----|-------|-----------|
| enqueue / remove / clear / pause / resume / pop | 任一 tab 产生 Map 变化后调用 `broadcastState(sid)` | 其他 tab `useCrossTabListener('chat-queue:sync', ...)` 接收：先校验 `tabId !== self`、`version > lastAppliedVersion`，通过则用 payload 替换本地 Map。**不再二次广播** |
| 新 tab 初始化 session | tab `init()` 完成后 `postCrossTabEvent('chat-queue:hello', { sessionId, tabId })` | 持有该 session 状态的其他 tab 响应一次 `chat-queue:sync`（见上方接收方代码） |
| 派发（sendMessage 前） | 任一 tab `maybeDispatch` 持 Web Lock | 其他 tab 的 `navigator.locks.request({ ifAvailable: true })` 返回 null，放弃派发。派发成功后 `broadcastState` 同步队列 |
| deleteSession | 删除 session 的 tab 清理 Map 后广播一次 `chat-queue:sync` with `queue: []` | 其他 tab 应用空队列并清除 `queuePausedBy` |

**Web Locks API 环境**：Chrome 69+ / Firefox 96+ / Safari 15.4+（2022-03 之前版本不支持） / Edge 79+，项目目标是现代浏览器。不支持时降级为"无锁直接派发"，此时多 tab 可能双发，项目部署环境可接受。

**不做的事**：
- 不用 localStorage 做"离线队列"持久化（保持"仅内存"原则）
- 不用 SharedWorker（复杂度增加，BroadcastChannel 足够）
- 不对跨 tab 的 enqueue 做严格顺序保证（BroadcastChannel 本地递送已有序；last-writer-wins 足够）

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

### 6.6 停止按钮去抖

用户快速连点停止按钮可能导致两次调用 `stopActiveRun` API，后端 `agentRun.service.ts:109-132` 第二次收到时走 else 分支 warn。组件层引入 `isStopping` 守卫：

```typescript
// CaseDetailXiaosuo.vue / AnalysisModuleChat.vue 中
const isStopping = ref(false)

async function handleStop() {
  if (isStopping.value) return
  isStopping.value = true

  // 先注册 watch 再调 stopGeneration：避免 await 期间 cancelled 事件已经到达、
  // watch 未建立导致错过信号，只能靠 3s 超时复位
  const unwatch = watch(
    props.xiaosuoChat.runStatus,  // runStatus 已是 ref/computed，无需 getter 包装
    (s) => {
      if (s === 'cancelled' || s === 'completed' || s === 'failed') {
        isStopping.value = false
        unwatch()
      }
    },
    { immediate: true }, // 若调用时 runStatus 已是终止态则立即触发
  )
  setTimeout(() => { isStopping.value = false; unwatch() }, 3000)

  try {
    await props.xiaosuoChat.stopGeneration()
  } catch (err) {
    console.error('[chat-stop] stopGeneration failed', err)
    isStopping.value = false
    unwatch()
  }
}
```

停止按钮 `:disabled="isStopping"`，点击中为置灰 loading 态。

## 7. 队列 Chip UI

### 7.1 复用 `app/components/ai-elements/queue/*` 基元组件

项目已有完整的队列 UI 基元（`app/components/ai-elements/queue/`，16 个原子组件），并有成熟消费示例 `app/components/ai/AiTaskQueue.vue:47-54`。本次**必须复用**这些基元，不自绘 Tailwind 容器，遵守项目 CLAUDE.md"严禁重复造轮子"的终极规则。

可用的自动导入组件（通过 Nuxt 自动命名为 `AiElements*`）：

| 组件 | 用途 |
|-----|------|
| `<AiElementsQueue>` | 外壳容器：rounded border + bg-background + shadow-xs（已封装样式） |
| `<AiElementsQueueItem>` | 单项 `<li>`：group hover + px-3 py-1 + text-sm + hover:bg-muted |
| `<AiElementsQueueItemContent completed={bool}>` | 文本 slot：line-clamp-1 + grow + break-words（completed 时灰色删除线） |
| `<AiElementsQueueItemIndicator completed={bool}>` | 圆点指示器：size-2.5 圆形 |
| `<AiElementsQueueItemActions>` | 操作按钮组：flex gap-1 容器 |
| `<AiElementsQueueItemAction>` | 单个操作按钮：ghost Button，group-hover:opacity-100（hover 才显示） |

### 7.2 挂载位置

通过 `AiChat.vue:152, 188` 已有的 `<template #prompt-actions />` slot 挂载。不改动 `AiPromptInput.vue` 内部。

```vue
<!-- CaseDetailXiaosuo.vue 修改后（AnalysisModuleChat.vue 对称改造） -->
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

新建组件 `app/components/ai/AiChatQueueChips.vue`，与 `AiChat.vue / AiPromptInput.vue / AiTaskQueue.vue` 同级，供小索与模块对话复用。

### 7.3 `AiChatQueueChips.vue` 组件结构

组件整体分两层：**状态横幅**（运行中 / 暂停态）+ **基于 `AiElementsQueue` 的 chip 列表**。

```vue
<script setup lang="ts">
import { PauseIcon, PlayIcon, TrashIcon, Loader2Icon, PaperclipIcon, BrainIcon, XIcon } from 'lucide-vue-next'
import type { QueueItem, QueuePauseReason } from '~/composables/chatQueueActions'

interface Props {
  queue: readonly QueueItem[]
  max: number
  paused: boolean
  pauseReason: QueuePauseReason
}
const props = defineProps<Props>()
const emit = defineEmits<{
  remove: [itemId: string]
  resume: []
  clear: []
}>()

const pauseReasonText = computed(() => {
  if (props.pauseReason === 'stopped') return '已手动停止'
  if (props.pauseReason === 'failed') return '上一条执行失败'
  return ''
})

function truncate(text: string, max = 24) {
  return text.length > max ? `${text.slice(0, max)}…` : text
}
</script>

<template>
  <div v-if="queue.length > 0" class="border-t border-b">
    <!-- 状态横幅 -->
    <div
      :class="[
        'px-3 py-2 text-xs flex items-center gap-2',
        paused
          ? 'bg-amber-50 text-amber-700 border-b border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30'
          : 'text-muted-foreground bg-muted/30'
      ]"
    >
      <template v-if="paused">
        <PauseIcon class="size-3.5 shrink-0" />
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
        <Loader2Icon class="size-3.5 animate-spin shrink-0" />
        <span>排队中 ({{ queue.length }}/{{ max }})</span>
      </template>
    </div>

    <!-- 基于 ai-elements/queue 的列表 -->
    <div class="p-2 max-h-[180px] overflow-y-auto">
      <AiElementsQueue>
        <!-- 通过 class 覆盖 QueueItem 默认的 flex-col 为 flex-row，避免外套一层 div 破坏基元语义 -->
        <AiElementsQueueItem
          v-for="(item, index) in queue"
          :key="item.id"
          class="!flex-row items-center gap-2"
        >
          <!-- 序号 badge -->
          <Badge variant="secondary" class="shrink-0 text-[10px] h-5 px-1.5">#{{ index + 1 }}</Badge>

          <!-- 文本内容（复用 QueueItemContent 的 line-clamp） -->
          <Tooltip>
            <TooltipTrigger as-child>
              <AiElementsQueueItemContent>
                {{ truncate(item.text) }}
              </AiElementsQueueItemContent>
            </TooltipTrigger>
            <TooltipContent class="max-w-md">
              <div class="text-xs whitespace-pre-wrap">{{ item.text }}</div>
              <div v-if="item.files?.length" class="mt-1 text-[10px] text-muted-foreground">
                附件：{{ item.files.map(f => f.fileName).join('、') }}
              </div>
            </TooltipContent>
          </Tooltip>

          <!-- 附件数 -->
          <Badge v-if="item.files?.length" variant="outline" class="shrink-0 h-5 text-[10px]">
            <PaperclipIcon class="size-3" /> {{ item.files.length }}
          </Badge>

          <!-- thinking 标记 -->
          <BrainIcon v-if="item.thinking" class="size-3.5 text-primary shrink-0" />

          <!-- 删除按钮（hover 才显示） -->
          <AiElementsQueueItemActions class="shrink-0">
            <AiElementsQueueItemAction @click="emit('remove', item.id)">
              <XIcon class="size-3" />
            </AiElementsQueueItemAction>
          </AiElementsQueueItemActions>
        </AiElementsQueueItem>
      </AiElementsQueue>
    </div>
  </div>
</template>
```

### 7.4 视觉状态

```
───────────── 空队列（不渲染）─────────────
<无>

───────────── 运行中，2 条队列 ─────────────
┌────────────────────────────────────────────┐
│ ⏳ 排队中 (2/5)                            │
│ [AiElementsQueue]                          │
│   #1  帮我分析证据...            [📎2][🧠]│
│   #2  继续上面的话...                      │
└────────────────────────────────────────────┘

───────────── 已暂停，2 条队列 ─────────────
┌────────────────────────────────────────────┐
│ ⏸ 队列已暂停（上一条执行失败）             │
│                       [▶ 恢复] [🗑 清空]   │
│ [AiElementsQueue]                          │
│   #1  帮我分析证据...                      │
│   #2  继续上面的话...                      │
└────────────────────────────────────────────┘
```

### 7.5 交互细节

- 整 chip hover 显示 Tooltip，内容为完整文本 + 附件文件名列表（已内置 `<Tooltip>` 包裹 `AiElementsQueueItemContent`）
- `×` 按钮通过 `AiElementsQueueItemAction` 的 `group-hover:opacity-100` 自动 hover 才显示
- 点击 `×` → emit `remove(itemId)` → manager `removeQueueItem(itemId)` → 广播跨标签事件
- **不支持**拖拽重排序、编辑（YAGNI）
- 暂停态的横幅使用 `bg-amber-50 dark:bg-amber-500/10` 醒目色

### 7.6 队列满提示

队列满时：`toast.warning('队列已满（最多 5 条），请等待当前对话结束或清空队列')`，使用项目已引入的 `vue-sonner`。

## 8. 错误场景与边界处理

### 8.1 异常场景清单

| # | 场景 | 处理策略 |
|---|------|---------|
| 1 | 派发后 `sendMessage` 底层 fetch 抛错 | `useStreamChat` 的 `onError` 捕获并 `console.error`。Worker 最终推送 `status_change: failed` → `watch(runStatus)` 暂停队列 → 用户手动恢复 |
| 2 | 派发时 `currentChat.value === null` | `maybeDispatch` 守卫 4 提前 return，**不会 pop 队头**。队列保持完整，等下次 runStatus 切到 completed 再尝试 |
| 3 | 队列中某条消息的 files 已被后端删除 | 此场景仅在未来启用文件上传后才可能出现（当前 files 字段不被派发，见 §5.6）。届时后端 prompt 构造阶段报错 → 走场景 #1 的 `failed` 路径 → 自动暂停 |
| 4 | 队列有内容时删除当前 session | `deleteSession` 按以下顺序：①delete API → ②清理 `queuesBySession.delete(sid)` + `queuePausedBy.delete(sid)` → ③从 sessions 数组移除 → ④`switchSession` 到下一条或 `createSession`。清理必须在 switchSession **之前** |
| 5 | 派发中切换 session | `switchSession` 先 dispose 旧 chat 的 inner scope。dispatcher 挂在**manager setup 顶层**不受影响。新 session 即使 reconnect 重放 `status_change: completed`，溯源守卫（`lastLocalSendSeq` 未增长）也会拒绝派发 |
| 6 | 用户在已满队列再按回车 | `enqueueMessage` 返回 `false`，组件层 `handleSubmit` 显示 toast，输入框**不清空**（用户输入不丢失） |
| 7 | 用户刚 enqueue 未派发就点停止 | `stopGeneration` 触发，`runStatus='cancelled'` → 暂停队列。刚入队消息保留，等待恢复 |
| 8 | 派发的消息触发后端 interrupt | 后端 `agentWorker.ts:277-283` publish `status_change: interrupted`，`interruptData` 被设置 → 现有 `<Dialog>` 弹出。dispatcher 的 `maybeDispatch` 因守卫 2 `interruptData.value` 非 null 而 return，**即便此时 isLoading 已经变 false** 也不派发 |
| 9 | interrupt 确认后继续执行 | 用户在 Dialog 中 `resumeInterrupt` → 后端继续执行 → 最终 `status_change: completed` → `watch(runStatus)` 触发 `maybeDispatch` → 队列下一条派发。interrupt 本身**不**暂停队列 |
| 10 | 同一条队列消息派发失败后是否重试 | `maybeDispatch` 是 pop-then-send，一条消息只被 pop 一次。失败后已不在队列里，用户如想重试需要重新输入 |
| 11 | reconnect 场景（重进浮窗） | reconnect 走 `currentChat.reconnect()`，新 chat 实例的 runStatus 由后端真实事件决定。队列因上次 unmount 随 Map GC，是空的 |
| 12 | 跨标签 A 入队，标签 B 看不到 | 标签 A 的 `enqueueMessage` 后立即 `postCrossTabEvent('chat-queue:sync', ...)`；标签 B 的 `useCrossTabListener` 接收并应用到本地 Map |
| 13 | 跨标签同时派发同一条消息 | 两个标签都收到 `runStatus=completed` → 都调用 `maybeDispatch` → 都请求 `navigator.locks`。仅一个 tab 持锁成功，另一个 `lock === null` 直接 return，无副作用 |
| 14 | 新标签打开时已有其他 tab 持有队列状态 | 新 tab 在 `init()` 中 `postCrossTabEvent('chat-queue:hello', { sessionId, tabId })`；其他 tab 监听到 hello 后 `postCrossTabEvent('chat-queue:sync', ...)` 回应当前状态 |
| 15 | 用户在 tab A 清空队列，tab B 正巧派发中 | tab B 若已拿到 Web Lock 并在 sendMessage 中途，会先完成当前派发（因为 Web Lock 是在派发入口加锁）。A 的清空广播到 B 时，B 应用 `clearAction`，清空剩余条目。未清空"正在发送"的那一条是可接受的 |
| 16 | `doDispatch` 内 `sendMessage` 同步抛错 | try/catch 捕获 → `queuePausedBy.set(sid, 'failed')` + broadcast → 队头仍保留，用户可手动恢复重试 |
| 17 | **暂停态 + 队列被清空死锁** | `clearQueue` 和 `removeQueueItem`（移除后队列变空时）自动 `queuePausedBy.delete(sid)` 并广播。避免"用户删光所有 chip 后仍锁在暂停态"的永久性死锁 |

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

2. **Map 响应式方案**：采用 `reactive(new Map<string, QueueItem[]>())`。Vue 3 对 `reactive(Map)` 有专门的 CollectionHandlers（见 Vue 3 源码 `@vue/reactivity/src/collectionHandlers.ts`），`.set()` / `.delete()` 会正确触发 computed 重算。**不用** `shallowReactive` —— 后者不追踪 collection 方法。

3. **错误日志使用 `console.error` 而非 `logger`**：`logger` 仅在服务端自动导入（`.claude/rules/main.md`），前端需用 `console.error('[chat-queue] dispatch failed', { sessionId, itemId })`，不打印 `text` 内容以避免泄漏敏感信息。

4. **类型严格**：`QueueItem` 和 `QUEUE_MAX_SIZE` 定义在 `app/composables/chatQueueActions.ts`，组件通过 `import type { QueueItem } from '~/composables/chatQueueActions'` 引入。

5. **自动导入边界**：Nuxt 自动导入 `ref / computed / watch / watchEffect / nextTick / onScopeDispose / shallowRef / reactive` 等响应式 API 和 `onMounted` 等生命周期钩子；但 **`effectScope` 必须显式 `import { effectScope } from 'vue'`**（`useChatSessionManager.ts:14` 已是这个模式）。`toast` 从 `vue-sonner` 手动 import。

## 9. 测试策略

遵循项目 TDD 规范（`.claude/rules/main.md`）与测试规范（`.claude/rules/testing.md`）：先写测试，再写实现，覆盖率 80%+。

### 9.1 测试分层

```
┌─ 纯逻辑层（单元测试）────────────────────┐
│ chatQueueActions.ts 纯函数              │
│ maybeDispatch 守卫逻辑                  │
└──────────────────────────────────────────┘
┌─ 响应式副作用层（集成测试）──────────────┐
│ watch(runStatus) → 派发 / 自动暂停      │
│ reconnect 假边沿不误派发                │
│ interrupted 期间不派发                  │
│ switchSession 切换队列视图               │
└──────────────────────────────────────────┘
┌─ 跨标签同步层（单测 + BroadcastChannel mock）│
│ chat-queue:sync 状态同步                │
│ navigator.locks 分布式互斥              │
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

**文件**：`tests/app/components/ai/composables/chatQueueActions.test.ts`

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

**文件**：`tests/app/components/ai/composables/useChatSessionManager.test.ts`

Mock `useCaseChat` 返回可控实例：

```typescript
const mockChat = {
  messages: ref([]),
  isLoading: ref(false),
  runStatus: ref<AgentRunStatus | 'idle'>('idle'),
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
| 派发 happy path | enqueue 2 → `runStatus: running → completed` | `sendMessage` 调用一次，传队头 item |
| 连续 pop | `runStatus` 模拟 completed → running → completed 循环 | `sendMessage` 依次调用 2 次，队列最终空 |
| 暂停守卫（cancelled） | enqueue 2 → `runStatus: running → cancelled` | `sendMessage` 未被调用，队列保留，`isQueuePaused=true` |
| 失败守卫（failed） | enqueue 2 → `runStatus: running → failed` | 同上，`queuePauseReason='failed'` |
| **reconnect replay 不误派发** | 模拟 reconnect 时后端补发 `runStatus: idle → running → completed`（未调用过本地 sendMessage） | `sendMessage` **未**被调用（溯源守卫 `lastLocalSendSeq=0 ≤ lastDispatchedSeq=0`，覆盖 Critical 1） |
| **loadHistory 无 runStatus 变化** | 模拟 loadHistory：runStatus 保持 idle，isLoading: true→false | `sendMessage` **未**被调用（isLoading 守卫 + runStatus 未变化） |
| **interrupted 不派发** | enqueue 2 → `runStatus: running → interrupted` → `interruptData` 被设置 → 即使 isLoading 变 false | `sendMessage` **未**被调用（覆盖 Critical 2） |
| interrupt 后 completed 派发 | 同上 → 模拟 `interruptData=null` + `runStatus: interrupted → completed` | `sendMessage` 调用一次 |
| 手动恢复 | 暂停后 `resumeQueue()` | `sendMessage` 调用一次，暂停态清除 |
| 切换 session 不派发旧队列 | sess-A enqueue 2 → `switchSession('sess-B')` → sess-B 的 runStatus 正常变化 | sess-A 的 `sendMessage` 不被调用 |
| 切换回 session 看见原队列 | 同上 → 切换回 sess-A | `currentQueue.value` 长度为 2 |
| 删除 session 清理队列 | sess-A enqueue 2 → `deleteSession('sess-A')` | `queuesBySession.has('sess-A')` 为 false，switchSession 后新队列为空 |
| interrupt 期间 `isLoading` 变 false 的边界 | enqueue 1 → 模拟 `interruptData` 被设置 + `isLoading: true → false` | `sendMessage` **未**被调用（守卫 2 生效） |
| 队列满 | 已有 5 条再 enqueue | 返回 `false` |
| **暂停态下 handleSubmit 走 enqueue** | 暂停态 + isLoading=false + 组件层 handleSubmit | 调用的是 enqueueMessage，不是 sendMessage |

**时序控制**：用 `flushPromises()` 和 `await nextTick()` 精确控制 watch 执行顺序。

### 9.4 组件测试：`AiChatQueueChips.vue`

**文件**：`tests/app/components/ai/AiChatQueueChips.test.ts`

| 用例 | 断言 |
|-----|------|
| 空队列不渲染 | 容器不存在 |
| 2 条运行中 | 顶部 "排队中 (2/5)"，2 个 `AiElementsQueueItem` 实例 |
| 1 条暂停 stopped | "队列已暂停（已手动停止）" + 恢复 + 清空 按钮 |
| 1 条暂停 failed | "队列已暂停（上一条执行失败）" |
| 点 × 删除 chip | emit `remove` 携带正确 itemId |
| 点恢复按钮 | emit `resume` |
| 点清空按钮 | emit `clear` |
| chip 文本超长截断 + tooltip | chip 文本以 `…` 结尾，tooltip 显示完整 |
| 有附件显示 📎N badge | 数字正确 |
| thinking=true 显示 🧠 图标 | `BrainIcon` 存在 |

### 9.5 组件测试：`AiPromptInput.vue` 按钮改动

**文件**：`tests/app/components/ai/AiPromptInput.test.ts`（若已存在则扩展）

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
| isStopping=true 时停止按钮禁用 | `disabled` 属性生效（覆盖 M3） |

### 9.6 跨标签同步测试

**文件**：`tests/app/components/ai/composables/crossTabQueue.test.ts`

**Mock 基础设施**：项目此前没有 BroadcastChannel / Web Locks 的 mock 先例，需新建通用工具：

**文件**：`tests/app/utils/crossTabMocks.ts`（新建。注意：项目既有 `tests/app/utils/` 目录结构，不是 `tests/utils/`）

```typescript
import { vi } from 'vitest'

/** 建立 BroadcastChannel 的手工 pub/sub 实现 */
export function stubBroadcastChannel() {
  const listeners = new Map<string, Set<(ev: MessageEvent) => void>>()
  class MockChannel {
    constructor(public name: string) {
      if (!listeners.has(name)) listeners.set(name, new Set())
    }
    postMessage(data: unknown) {
      listeners.get(this.name)?.forEach(fn => fn({ data } as MessageEvent))
    }
    set onmessage(fn: (ev: MessageEvent) => void) {
      listeners.get(this.name)?.add(fn)
    }
    close() { /* no-op */ }
  }
  vi.stubGlobal('BroadcastChannel', MockChannel)
  return () => { listeners.clear(); vi.unstubAllGlobals() }
}

/** 建立 navigator.locks 的简单串行实现 */
export function stubNavigatorLocks() {
  const held = new Set<string>()
  vi.stubGlobal('navigator', {
    locks: {
      async request(
        name: string,
        opts: { ifAvailable?: boolean },
        cb: (lock: unknown) => Promise<void>,
      ) {
        if (held.has(name)) {
          if (opts.ifAvailable) return cb(null)
          throw new Error('lock held')
        }
        held.add(name)
        try { await cb({}) } finally { held.delete(name) }
      },
    },
  })
  return () => { held.clear(); vi.unstubAllGlobals() }
}
```

这两个工具后续可被任何跨标签功能测试复用，避免重复造轮子。

**测试用例**：

| 用例 | 断言 |
|-----|------|
| Tab A enqueue → Tab B 接收 | Tab B 的 `currentQueue` 包含新 item |
| Tab A remove → Tab B 接收 | Tab B 的队列同步减少 |
| Tab A pause → Tab B 接收 | Tab B 的 `isQueuePaused` 为 true |
| 新 tab hello → 旧 tab 响应 sync | 新 tab 收到旧 tab 的状态并应用 |
| 两 tab 同时 maybeDispatch | 只有一个拿到 Web Lock，另一个 `lock===null` 返回无副作用 |
| 持锁 tab `sendMessage` 抛错 | catch 分支写入 `queuePausedBy='failed'` 并 broadcast，队头保留 |
| Listener 自回过滤 | tabId 相同的 `chat-queue:sync` 事件被忽略（版本未更新） |
| 过期版本丢弃 | `version < lastApplied` 的 sync 事件被忽略 |
| 无 `navigator.locks` 环境降级 | 直接执行派发（单 tab 默认路径） |

### 9.7 E2E 测试（Playwright）

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

### 9.8 覆盖率目标

- 纯函数层：100%
- Manager + dispatcher：≥ 90%
- 组件层：关键交互 100%
- 项目总覆盖率门槛：保持 80%

### 9.9 类型检查与测试命令

所有新增 TS 文件完成后运行 `npx nuxi typecheck`（项目规范明确用 `nuxi typecheck` 而非 `tsc`），作为 PR 提交前硬门槛。

**测试命令规范**（`.claude/rules/commands.md`）：
- 单元 / 集成 / 组件测试：`npx vitest run tests/app/components/ai/composables/...`
- E2E 测试：`npx playwright test tests/e2e/xiaosuo-chat-queue.spec.ts`
- **不使用** `bun test`（Nuxt 自动导入在 vitest 环境下才能正确解析）

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
| `app/composables/useChatSessionManager.ts` | 扩展：新增队列状态 + API + 跨标签集成 |
| `app/composables/useCrossTabEvents.ts` | 扩展：`CrossTabEvents` interface 新增 `chat-queue:sync` 和 `chat-queue:hello` |
| `app/components/ai/AiPromptInput.vue` | 修复按钮交互 + 新增 props（`queueLength`, `queueFull`） |
| `app/components/caseDetail/CaseDetailXiaosuo.vue` | `handleSubmit` 分派（考虑 `isQueuePaused`） + 挂载 queue chips + `handleStop` 去抖 |
| `app/components/case/AnalysisModuleChat.vue` | 同上（对称改造） |

### 11.2 新建的文件

| 文件 | 说明 |
|-----|------|
| `app/composables/chatQueueActions.ts` | 纯函数 + 类型 + 常量（`QueueItem`, `QueuePauseReason`, `QUEUE_MAX_SIZE`, `enqueueAction`, `removeAction`, `clearAction`, `pauseAction`, `resumeAction`） |
| `app/composables/useQueueDispatcher.ts` | watcher 副作用 + 溯源守卫 + Web Locks 互斥 + 跨标签广播 |
| `app/components/ai/AiChatQueueChips.vue` | 队列 chip 组件（基于 `ai-elements/queue` 基元组合，使用 `!flex-row` class 覆盖） |
| `tests/app/utils/crossTabMocks.ts` | **新建通用测试基础设施**：`stubBroadcastChannel` + `stubNavigatorLocks`，后续跨标签功能可复用 |
| `tests/app/components/ai/composables/chatQueueActions.test.ts` | 纯函数单测 |
| `tests/app/components/ai/composables/useChatSessionManager.test.ts` | 响应式集成测试（含 reconnect 假边沿、interrupted、doDispatch 错误处理等用例） |
| `tests/app/components/ai/composables/crossTabQueue.test.ts` | 跨标签同步单测 |
| `tests/app/components/ai/AiChatQueueChips.test.ts` | 组件测试 |
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
| 溢出策略 | **拒绝新入队**，**不丢弃最老一条** | 保护已排队条目，对用户意图更尊重 |
| 停止后处理 | 保留已生成内容标记"已取消" | 符合 ChatGPT / Claude.ai 既有心智 |
| 失败后处理 | 自动暂停，等待手动恢复 | 与停止路径对称，避免故障连锁 |
| 暂停态 handleSubmit | 强制走 enqueue，用户必须显式恢复或清空 | 避免"暂停队列 + 绕过发送"的 UI 错乱 |
| 暂停态 + 空队列 | 自动清除暂停标记（clearQueue / 最后一次 removeQueueItem） | 避免用户删光 chip 后死锁 |
| 持久化范围 | 仅内存 + 跨 tab 同步，关闭所有 tab 即丢失 | 跨设备 YAGNI；跨 tab 复用现有 BroadcastChannel 基础设施 |
| files 字段 | 类型结构保留，运行时不传递 | 前瞻性设计，零成本 |
| `sendMessage` 签名 | 本次**不**扩展 | 当前 UI 不产生 files 数据，避免死代码 |
| 停止 vs 加入队列 UI | 两按钮并排 | 避免"单按钮两种模式"的认知负担 |
| 派发触发源 | `watch(runStatus === 'completed')` **+ 溯源守卫 `lastLocalSendSeq`** | 既规避 reconnect replay 的 `status_change` 重放，也规避 loadHistory 的 isLoading 假边沿 |
| 跨 tab 互斥 | `navigator.locks.request({ ifAvailable: true })` | 浏览器级分布式锁，无需自建协议 |
| Map 响应式方案 | `reactive(new Map())`（CollectionHandlers） | Vue 3 内置支持，无需 version counter 手动触发 |
| Chip UI 复用 | 基于 `ai-elements/queue/*` 基元 + `!flex-row` class 覆盖 | 项目已有 16 个原子组件 + `AiTaskQueue.vue` 参考实现，严禁重复造轮子；不外套 div 破坏基元语义 |
| Composable 文件结构 | 扁平（`chatQueueActions.ts` + `useQueueDispatcher.ts`） | 项目现有 35 个 composable 零子目录先例 |
| 停止按钮防抖 | 组件层 `isStopping` ref + 3s 超时复位 | 避免用户快速双击导致后端 cancel API 重复调用 |
| TabId 生成时机 | **`onMounted` 内**闭包生成 `nanoid()` | 避免 Nuxt `useState` SSR hydration 导致所有 tab 共享同一 ID |
| 跨 tab listener 模式 | **直接 merge payload 到本地 Map**（而非 refetch） | 队列无服务端持久化，无法 refetch；与项目现有 listener 模式的偏离是必需的 |
| broadcastState 调用约束 | 仅在本地 mutation 路径调用；listener 接收事件后**不得**二次广播 | 硬约束级，防止死循环 |
| `doDispatch` 错误处理 | `try/catch` 包裹 `sendMessage`，失败时显式 `queuePausedBy='failed'` + broadcast | 避免"Web Lock 释放后其他 tab 重复派发" |
| 测试 mock 基础设施 | 新建 `tests/utils/crossTabMocks.ts` 供所有跨标签功能复用 | 避免未来重复造轮子 |
