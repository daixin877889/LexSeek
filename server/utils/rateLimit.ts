import { getRedisClient } from '~~/server/lib/redis'

/** 单个时间窗口的限流配置 */
export interface RateLimitWindow {
  /** 窗口大小（毫秒） */
  windowMs: number
  /** 窗口内最大请求数 */
  maxRequests: number
}

/** 限流检查结果 */
export interface RateLimitResult {
  /** 是否放行 */
  allowed: boolean
  /** 剩余可用次数 */
  remaining: number
  /** 窗口上限 */
  limit: number
  /** 窗口重置时间（毫秒时间戳） */
  resetAt: number
}

/**
 * Redis Sorted Set 滑动窗口限流。移植自旧项目 rateLimitMiddleware。
 *
 * 每个请求把当前时间戳写入 Sorted Set，统计窗口内数量判断是否超限，
 * 并清理过期记录。Redis 故障时降级放行，不阻断业务。
 *
 * @param keyPrefix Redis key 前缀，区分不同限流场景
 * @param identifier 限流主体标识（一般是用户 ID）
 * @param window 窗口配置
 */
export async function checkRateLimit(
  keyPrefix: string,
  identifier: string | number,
  window: RateLimitWindow,
): Promise<RateLimitResult> {
  const { windowMs, maxRequests } = window
  const key = `${keyPrefix}:${identifier}`
  const now = Date.now()
  const windowStart = now - windowMs

  try {
    const redis = getRedisClient()
    // 原子地：清理窗口外旧记录 → 统计窗口内数量 → 取窗口内时间戳
    const results = await redis
      .pipeline()
      .zremrangebyscore(key, 0, windowStart)
      .zcard(key)
      .zrangebyscore(key, windowStart, now)
      .exec()

    const currentCount = (results?.[1]?.[1] as number) ?? 0
    const timestamps = (results?.[2]?.[1] as string[]) ?? []

    // 已达上限：拒绝，并按最早一条记录推算窗口重置时间
    if (currentCount >= maxRequests) {
      const earliest = timestamps.length > 0
        ? Math.min(...timestamps.map(t => parseFloat(t)))
        : now
      return { allowed: false, remaining: 0, limit: maxRequests, resetAt: earliest + windowMs }
    }

    // 记录本次请求并续期 key
    await redis.zadd(key, now, `${now}:${Math.random().toString(36).slice(2, 9)}`)
    await redis.expire(key, Math.ceil(windowMs / 1000) + 1)

    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - currentCount - 1),
      limit: maxRequests,
      resetAt: now + windowMs,
    }
  } catch (error) {
    // Redis 故障降级：放行，不因限流设施不可用而阻断正常请求
    logger.error('[rateLimit] 限流检查失败，降级放行', error)
    return { allowed: true, remaining: maxRequests - 1, limit: maxRequests, resetAt: now + windowMs }
  }
}
