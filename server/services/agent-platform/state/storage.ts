/**
 * Agent 状态存储
 *
 * 用于在 middleware 和 tool 之间共享状态（如 token 消耗）
 * 使用 Redis 存储，支持多实例部署下的状态共享
 */

import { getRedisClient } from '~~/server/lib/redis'

/** Redis key 前缀 */
const STORAGE_PREFIX = 'session_state:'

/** 过期时间：2 小时 */
const STORAGE_TTL = 3600 * 2

/**
 * 获取 session 状态
 *
 * @param sessionId 会话 ID
 * @returns 状态对象，不存在时返回 null
 */
export async function getSessionState(sessionId: string): Promise<Record<string, any> | null> {
    const redis = getRedisClient()
    const raw = await redis.get(`${STORAGE_PREFIX}${sessionId}`)
    if (!raw) return null
    try {
        return JSON.parse(raw)
    } catch {
        logger.warn(`session 状态 JSON 解析失败: ${sessionId}`)
        return null
    }
}

/**
 * 更新 session 状态（部分更新，read-modify-write 合并）
 *
 * @param sessionId 会话 ID
 * @param partialState 部分状态
 */
export async function updateSessionState(sessionId: string, partialState: Record<string, any>): Promise<void> {
    const redis = getRedisClient()
    const key = `${STORAGE_PREFIX}${sessionId}`
    const current = await getSessionState(sessionId)
    const merged = { ...current, ...partialState }
    await redis.set(key, JSON.stringify(merged), 'EX', STORAGE_TTL)
}
