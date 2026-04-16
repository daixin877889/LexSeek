/**
 * 队列派发器
 *
 * 核心职责：
 * - watch(runStatus) → failed/cancelled 自动暂停；真正 completed 触发派发
 * - maybeDispatch：六个守卫（暂停 / interrupt / isLoading / currentChat / 队列空 / Web Lock）
 * - doDispatch：pop 队头 + 调用 sendMessage + 广播；同步抛错 → 显式暂停
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
import type { QueueItem, QueuePauseReason } from './chatQueueActions'
import type { useCaseChat } from './useCaseChat'

// 类型别名：currentChat.value 的类型与 useChatSessionManager 已有的 shallowRef 一致
// 注意：TS 不支持 `typeof import('...').fn` 语法，需分两行
type ChatInstance = ReturnType<typeof useCaseChat>

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
    if (typeof navigator !== 'undefined' && navigator.locks) {
      await navigator.locks.request(
        `chat-queue-dispatch:${sid}`,
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          if (!lock) return // 另一 tab 已拿到锁，本 tab 放弃派发
          await doDispatch(sid)
        },
      )
    }
    else {
      await doDispatch(sid)
    }
  }

  async function doDispatch(sid: string) {
    // 锁内再次读取最新队列（其他 tab 可能已 pop）
    const latest = deps.queuesBySession.get(sid) ?? []
    if (latest.length === 0) return

    const [head, ...rest] = latest
    if (!head) return

    try {
      // 【关键】必须在 sendMessage 之前自增 lastLocalSendSeq。
      // dispatcher 直接调用 currentChat.sendMessage（useCaseChat 原始方法），
      // 绕过了 useChatSessionManager 的 sendMessage wrapper，wrapper 中的 ++ 不生效。
      // 若缺失此行，派发第一条后 lastDispatchedSeq=1 会永远等于 lastLocalSendSeq=1，
      // watch 守卫 `seq > lastDispatchedSeq` 永远为 false，队列死锁。
      deps.lastLocalSendSeq.value++

      // await sendMessage：useCaseChat 把 stream.submit Promise 透传出来，
      // fetch 建立失败 / 4xx / 5xx 会 reject 进本 try/catch。
      // 成功只代表 SSE 已启动（后端执行失败走 watch(runStatus='failed') 自动暂停）。
      // 注意：files 字段在当前阶段不传递（见 spec §5.6）。
      await deps.currentChat.value?.sendMessage(head.text, { thinking: head.thinking })

      // 成功则 pop 并广播
      deps.queuesBySession.set(sid, rest)
      broadcastState(sid)
    }
    catch (err) {
      // sendMessage 抛错（同步或异步）：队头保留在 queue（set 未执行），
      // 显式标 paused='failed' 并广播，用户点"恢复队列"时从队头重试
      console.error('[chat-queue] dispatch failed', { sessionId: sid, itemId: head.id, err })
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
