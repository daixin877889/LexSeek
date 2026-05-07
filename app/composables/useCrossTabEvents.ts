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
 * 应用 lifetime 单例 BroadcastChannel
 *
 * 旧实现每次 postCrossTabEvent 都 `new BroadcastChannel + postMessage + close`，
 * 实测跨 Tab 同步失效（A Tab 启动模块对话、A Tab 完成保存，B Tab 都不刷新）。
 * 根因：BroadcastChannel.close() 让该 channel 实例进入 closed 状态，浏览器可能
 * 在已 postMessage 的消息真正派送给其他 channel 实例之前就清理掉，导致 B Tab
 * 的 listener 收不到事件。BroadcastChannel 的标准用法是**应用全局单例 + 不
 * close**（页面卸载时浏览器自动 GC），多个 listener 用 addEventListener 共存。
 *
 * 同时把 useCrossTabListener 从 `ch.onmessage = handler`（只能一个 handler）
 * 改成 `ch.addEventListener('message', handler)`，避免多次调用 listener 互相覆盖。
 */
let _channel: BroadcastChannel | null = null
function getChannel(): BroadcastChannel | null {
    if (typeof window === 'undefined') return null
    if (_channel === null) {
        try {
            _channel = new BroadcastChannel(CHANNEL_NAME)
        }
        catch {
            // BroadcastChannel 不支持（罕见环境）静默降级
            return null
        }
    }
    return _channel
}

/**
 * 发送跨标签页事件（fire-and-forget）
 */
export function postCrossTabEvent<T extends EventType>(type: T, data: CrossTabEvents[T]) {
    const ch = getChannel()
    if (!ch) return
    try {
        ch.postMessage({ type, ...data })
    }
    catch {
        // BroadcastChannel postMessage 抛错时静默降级
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
    const ch = getChannel()
    if (!ch) return

    const handler = (e: MessageEvent) => {
        if (e.data?.type === type) callback(e.data)
    }
    ch.addEventListener('message', handler)

    onScopeDispose(() => {
        ch.removeEventListener('message', handler)
    })
}
