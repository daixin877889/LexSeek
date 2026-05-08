/**
 * 跨标签页事件通信（基于 BroadcastChannel）
 *
 * 提供类型安全的事件发布/订阅机制，用于同源多标签页间的实时状态同步。
 * 不支持 BroadcastChannel 的环境（如 SSR）自动静默降级。
 *
 * @example
 * // 发布事件
 * postCrossTabEvent('analysis:updated', { caseId: 123 })
 *
 * // 订阅事件（在 setup 或 effectScope 内调用，自动清理）
 * useCrossTabListener('analysis:updated', (data) => {
 *   if (data.caseId === currentCaseId.value) refreshAnalysis()
 * })
 */

import type { QueueItem, QueuePauseReason } from './chatQueueActions'

const CHANNEL_NAME = 'lexseek:cross-tab'

/** 跨标签页事件类型定义，新增事件在此扩展 */
export interface CrossTabEvents {
    /** 分析结果更新（init-analysis 模块完成 / 模块对话保存结果） */
    'analysis:updated': { caseId: number }
    /** 模块对话生成状态变化（案件详情页 → init-analysis 页面） */
    'module:generating': { caseId: number; modules: string[] }
    /** 积分余额变化（预留） */
    'points:changed': Record<string, never>
    /** 登出（预留） */
    'auth:logout': Record<string, never>
    /** 队列状态完整快照（mutate 后广播） */
    'chat-queue:sync': {
        sessionId: string
        /** 发送方 tab 标识，接收方用于自回过滤 */
        tabId: string
        /** 完整队列快照 */
        queue: QueueItem[]
        pauseReason: QueuePauseReason
        /** performance.now() + Math.random()，双因子避免毫秒级碰撞 */
        version: number
    }
    /** 新 tab 打开 session 时请求状态 */
    'chat-queue:hello': {
        sessionId: string
        tabId: string
    }
}

type EventType = keyof CrossTabEvents

/**
 * 发送跨标签页事件（fire-and-forget）
 */
export function postCrossTabEvent<T extends EventType>(type: T, data: CrossTabEvents[T]) {
    if (typeof window === 'undefined') return
    try {
        const ch = new BroadcastChannel(CHANNEL_NAME)
        ch.postMessage({ type, ...data })
        ch.close()
    } catch {
        // BroadcastChannel 不支持时静默降级
    }
}

/**
 * 监听跨标签页事件
 *
 * 在 setup 或 effectScope 内调用，通过 onScopeDispose 自动清理。
 */
export function useCrossTabListener<T extends EventType>(
    type: T,
    callback: (data: CrossTabEvents[T]) => void,
) {
    if (typeof window === 'undefined') return

    let ch: BroadcastChannel | null = null
    try {
        ch = new BroadcastChannel(CHANNEL_NAME)
        ch.onmessage = (e: MessageEvent) => {
            if (e.data?.type === type) callback(e.data)
        }
    } catch {
        // 静默降级
    }

    onScopeDispose(() => {
        ch?.close()
    })
}
