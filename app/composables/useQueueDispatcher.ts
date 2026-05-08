/**
 * 队列派发器
 *
 * 核心职责：
 * - watch(runStatus) → failed/cancelled 自动暂停；真正 completed 触发派发
 * - maybeDispatch：六个守卫 + 出队（锁内同步）+ sendMessage（锁外 await）
 * - broadcastState：跨标签同步的唯一对外出口
 *
 * 必须在 manager 的 setup 顶层注册（自动绑定调用方 setup scope），
 * 不进 switchSession 的 inner effectScope，否则 session 切换会 dispose watcher。
 *
 * 详见 spec §5.2 / §5.7。
 */

import type { Ref, ShallowRef, ComputedRef } from 'vue'
import type { AgentRunStatus } from '#shared/types/agentRun'
import { postCrossTabEvent } from './useCrossTabEvents'
import { buildAttachmentsPayload, type QueueItem, type QueuePauseReason } from './chatQueueActions'
import type { WrappedChat } from './agent-platform/types'

// 类型别名：currentChat.value 与工厂内 currentChat 共用同一类型（agent-platform/types.ts）
type ChatInstance = WrappedChat

export interface QueueDispatcherDeps {
  currentSessionId: Ref<string | null>
  currentChat: ShallowRef<ChatInstance | null>
  runStatus: ComputedRef<AgentRunStatus | 'idle'>
  isLoading: ComputedRef<boolean>
  interruptData: ComputedRef<unknown>
  /** 由 reactive(new Map()) 提供，见 spec §8.3 */
  queuesBySession: Map<string, QueueItem[]>
  queuePausedBy: Map<string, Exclude<QueuePauseReason, null>>
  /** Tab 标识（getter，因为 tabId 在 onMounted 才赋值） */
  tabId: string
  /** 本 tab 本地发送过的累计次数，每次 sendMessage 前 ++ */
  lastLocalSendSeq: Ref<number>
}

export function useQueueDispatcher(deps: QueueDispatcherDeps) {
  // 本 tab 已派发到的本地发送序号，用于溯源守卫
  // reconnect 重放的 completed 不经过本地 sendMessage，seq 不增长，守卫拒绝
  let lastDispatchedSeq = 0

  // ── 暂停路径：failed / cancelled 自动暂停队列 ──
  watch(deps.runStatus, (next) => {
    const sid = deps.currentSessionId.value
    if (!sid) return
    if (next === 'failed' || next === 'cancelled') {
      // 死锁防护：队列为空时不设暂停标记
      // 否则用户在无队列时仅是"取消一次生成"却会让下一条直接输入的消息被
      // AiPromptInput 的 shouldEnqueue 误判入队，等"继续"才派发（spec §5.3 /
      // useChatSessionManager.removeQueueItem 已在 remove 路径做了对称防护）
      const queueLen = (deps.queuesBySession.get(sid) ?? []).length
      if (queueLen === 0) return
      deps.queuePausedBy.set(sid, next === 'failed' ? 'failed' : 'stopped')
      broadcastState(sid)
    }
    // interrupted：不暂停也不派发（Dialog 由 interruptData 驱动）
    // pending / running / idle：不做任何操作
  })

  // ── 派发路径：等 completed && !isLoading && !interruptData 三者都 ready 才派发 ──
  // 早期方案只 watch(runStatus='completed') 在 isLoading 尚未 false 时会被守卫 3 拦截，
  // 随后 isLoading 变 false 时没有新的 runStatus 事件重新触发 watch，导致队列卡住永不派发。
  // 用 computed 聚合三个条件，watch 只在它从 false→true 时触发，保证 isLoading 彻底 settle。
  const canDispatch = computed(() =>
    deps.runStatus.value === 'completed'
    && !deps.isLoading.value
    && !deps.interruptData.value,
  )
  watch(canDispatch, (ready) => {
    if (!ready) return
    // 溯源守卫：只有"本 tab 本地发送过新消息"才允许派发
    // reconnect 重放不经过本地 sendMessage，seq 未增长，守卫拒绝
    if (deps.lastLocalSendSeq.value > lastDispatchedSeq) {
      lastDispatchedSeq = deps.lastLocalSendSeq.value
      nextTick(() => maybeDispatch())
    }
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
    // 锁的范围仅覆盖"出队"这一瞬间操作，不持有到 sendMessage 结束。
    // 原因：stream.submit 在整个 SSE 流结束后才 resolve，若锁覆盖 await sendMessage，
    // 则 watch(canDispatch) 触发的 nextTick(maybeDispatch) 会因 ifAvailable=null 放弃，
    // 导致下一条队列消息永远无法派发（锁释放时没有任何东西重新触发 maybeDispatch）。
    let popped: QueueItem | undefined

    const tryPop = () => {
      const latest = deps.queuesBySession.get(sid) ?? []
      const [h, ...rest] = latest
      if (!h) return
      popped = h
      deps.lastLocalSendSeq.value++
      deps.queuesBySession.set(sid, rest)
      broadcastState(sid)
    }

    if (typeof navigator !== 'undefined' && navigator.locks) {
      await navigator.locks.request(
        `chat-queue-dispatch:${sid}`,
        { mode: 'exclusive', ifAvailable: true },
        (lock) => {
          if (!lock) return // 另一 tab 已拿到锁，本 tab 放弃派发
          tryPop()
        },
      )
    }
    else {
      tryPop()
    }

    if (!popped) return

    // sendMessage 在锁释放后执行，避免锁持有期间 nextTick(maybeDispatch) 无法获锁。
    // fetch 建立失败 / 4xx / 5xx 会 reject 进 catch；后端执行失败走 watch(runStatus='failed')。
    //
    // 与顶层 useDomainAgentSession.sendMessage 走完全相同的 buildAttachmentsPayload，
    // 让"立即发"和"队列发"的 sentinel + additional_kwargs.attachments 口径一致，
    // 避免用户在 loading 中入队的"文本+附件"消息派发时丢失附件元数据。
    try {
      const { content, additionalKwargs } = buildAttachmentsPayload(popped.text, popped.files)
      await deps.currentChat.value?.sendMessage(content, {
        thinking: popped.thinking,
        additional_kwargs: additionalKwargs,
      })
    }
    catch (err) {
      console.error('[chat-queue] dispatch failed', { sessionId: sid, itemId: popped.id, err })
      // 用当前队列头部合并而非 rest 快照，避免覆盖 sendMessage 期间新入队的消息
      const current = deps.queuesBySession.get(sid) ?? []
      deps.queuesBySession.set(sid, [popped, ...current])
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
