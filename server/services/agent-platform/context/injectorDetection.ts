/**
 * 上下文注入消息检测
 *
 * 中间件向 LangGraph state 注入的 context 消息（ModuleContext / CaseMaterial /
 * SubAgentContext / CaseContextMiddleware）不应回传给前端，否则用户会看到
 * "案件素材摘要"等系统消息。agentWorker（worker 提取过滤）和 agentSseStream
 * （SSE 转发过滤）都需要这套判定，集中在此避免任一新增 injector 时漏改一处。
 */

const INJECTOR_PREFIXES = ['ModuleContext', 'CaseMaterial', 'SubAgentContext'] as const
const INJECTOR_EXACT = new Set(['CaseContextMiddleware'])

export function isInjectorFromContextMiddleware(injector: string | undefined | null): boolean {
    if (!injector) return false
    if (INJECTOR_EXACT.has(injector)) return true
    return INJECTOR_PREFIXES.some(p => injector.startsWith(p))
}

/**
 * 从消息对象提取 injectedBy（兼容顶层 response_metadata 与嵌套 data.response_metadata）
 */
export function getMessageInjector(msg: unknown): string | undefined {
    if (!msg || typeof msg !== 'object') return undefined
    const m = msg as Record<string, unknown>
    const topMeta = m.response_metadata as Record<string, unknown> | undefined
    const topInjector = topMeta?.injectedBy
    if (typeof topInjector === 'string') return topInjector
    const inner = m.data as Record<string, unknown> | undefined
    if (inner && typeof inner === 'object') {
        const innerMeta = inner.response_metadata as Record<string, unknown> | undefined
        const innerInjector = innerMeta?.injectedBy
        if (typeof innerInjector === 'string') return innerInjector
    }
    return undefined
}

/** 一步到位：判断消息是否由上下文注入中间件产生 */
export function isInjectedContextMessage(msg: unknown): boolean {
    return isInjectorFromContextMiddleware(getMessageInjector(msg))
}
