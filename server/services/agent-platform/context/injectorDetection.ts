/**
 * 上下文注入消息检测
 *
 * 中间件向 LangGraph state 注入的 context 消息（ModuleContext / CaseMaterial /
 * SubAgentContext / CaseContextMiddleware / CaseContextSyncMiddleware）不应
 * 回传给前端，否则用户会看到"案件素材摘要"等系统消息。agentWorker（worker
 * 提取过滤）和 agentSseStream（SSE 转发过滤）都需要这套判定，集中在此避免
 * 任一新增 injector 时漏改一处。
 */

const INJECTOR_PREFIXES = ['ModuleContext', 'CaseMaterial', 'SubAgentContext'] as const
const INJECTOR_EXACT = new Set([
    'CaseContextMiddleware',           // 旧 tag，保留兼容历史 checkpoint
    'CaseContextSyncMiddleware',       // 新 tag（2026-05-05 改造）
])

export function isInjectorFromContextMiddleware(injector: string | undefined | null): boolean {
    if (!injector) return false
    if (INJECTOR_EXACT.has(injector)) return true
    return INJECTOR_PREFIXES.some(p => injector.startsWith(p))
}

/**
 * 从消息对象提取 injectedBy。
 * 双轨字段：优先 response_metadata.injectedBy；fallback 到 additional_kwargs.injectedBy。
 *
 * 双轨原因：项目记忆 feedback_message_metadata_first.md 指出 LangGraph SDK
 * plain object 序列化路径会丢 additional_kwargs；checkpoint 反序列化也可能仅
 * 还原其中一边，双轨写 + 双轨读保证兜底。
 */
export function getMessageInjector(msg: unknown): string | undefined {
    if (!msg || typeof msg !== 'object') return undefined
    const m = msg as Record<string, unknown>

    const topMeta = m.response_metadata as Record<string, unknown> | undefined
    const topInjector = topMeta?.injectedBy
    if (typeof topInjector === 'string') return topInjector

    const ak = m.additional_kwargs as Record<string, unknown> | undefined
    const akInjector = ak?.injectedBy
    if (typeof akInjector === 'string') return akInjector

    const inner = m.data as Record<string, unknown> | undefined
    if (inner && typeof inner === 'object') {
        const innerMeta = inner.response_metadata as Record<string, unknown> | undefined
        const innerInjector = innerMeta?.injectedBy
        if (typeof innerInjector === 'string') return innerInjector
        const innerAk = inner.additional_kwargs as Record<string, unknown> | undefined
        const innerAkInjector = innerAk?.injectedBy
        if (typeof innerAkInjector === 'string') return innerAkInjector
    }
    return undefined
}

/** 一步到位：判断消息是否由上下文注入中间件产生 */
export function isInjectedContextMessage(msg: unknown): boolean {
    return isInjectorFromContextMiddleware(getMessageInjector(msg))
}
