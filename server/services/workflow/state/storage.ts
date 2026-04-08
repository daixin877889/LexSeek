/**
 * Agent 状态存储
 *
 * 用于在 middleware 和 tool 之间共享状态（如 token 消耗）
 * 使用 per-session 的 Map 存储，避免 Redis 依赖
 *
 * 注意：这是内存存储，适用于单实例部署。多实例部署需改用 Redis。
 */

/** per-session 状态存储 */
const sessionStateMap = new Map<string, Record<string, any>>()

/**
 * 获取 session 状态
 *
 * @param sessionId 会话 ID
 * @returns 状态对象，不存在时返回 null
 */
export function getSessionState(sessionId: string): Record<string, any> | null {
    return sessionStateMap.get(sessionId) ?? null
}

/**
 * 更新 session 状态（部分更新）
 *
 * @param sessionId 会话 ID
 * @param partialState 部分状态
 */
export function updateSessionState(sessionId: string, partialState: Record<string, any>): void {
    const existing = sessionStateMap.get(sessionId) ?? {}
    sessionStateMap.set(sessionId, { ...existing, ...partialState })
}
