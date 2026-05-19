/**
 * 限流工具 checkRateLimit 测试
 *
 * Redis Sorted Set 滑动窗口限流：Redis 客户端打桩，覆盖窗口计数、
 * 拒绝判定、resetAt 推算、key 续期，以及 Redis 故障降级。
 *
 * **Feature: rate-limit**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../server/lib/redis', () => ({
    getRedisClient: vi.fn(),
}))

import { getRedisClient } from '../../../server/lib/redis'
import { checkRateLimit } from '../../../server/utils/rateLimit'

const mGetRedis = vi.mocked(getRedisClient)

/** Redis pipeline 桩：链式调用返回自身，exec 由各用例设置 */
const mockPipeline = {
    zremrangebyscore: vi.fn(),
    zcard: vi.fn(),
    zrangebyscore: vi.fn(),
    exec: vi.fn(),
}
const mockRedis = {
    pipeline: vi.fn(),
    zadd: vi.fn(),
    expire: vi.fn(),
}
/** 测试窗口：60 秒内最多 5 次 */
const WINDOW = { windowMs: 60_000, maxRequests: 5 }

describe('checkRateLimit · Redis 滑动窗口限流', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mGetRedis.mockReturnValue(mockRedis as never)
        mockRedis.pipeline.mockReturnValue(mockPipeline)
        mockPipeline.zremrangebyscore.mockReturnValue(mockPipeline)
        mockPipeline.zcard.mockReturnValue(mockPipeline)
        mockPipeline.zrangebyscore.mockReturnValue(mockPipeline)
        mockRedis.zadd.mockResolvedValue(1)
        mockRedis.expire.mockResolvedValue(1)
    })

    it('窗口内未超限 → 放行，剩余次数按已用量递减', async () => {
        // 窗口内已有 2 条记录
        mockPipeline.exec.mockResolvedValue([
            [null, 0],
            [null, 2],
            [null, ['100', '200']],
        ])
        const r = await checkRateLimit('rl:test', 100, WINDOW)
        expect(r.allowed).toBe(true)
        expect(r.limit).toBe(5)
        // remaining = max(0, 5 - 2 - 1)
        expect(r.remaining).toBe(2)
    })

    it('放行时写入本次请求并对 key 续期', async () => {
        mockPipeline.exec.mockResolvedValue([[null, 0], [null, 0], [null, []]])
        await checkRateLimit('rl:test', 100, WINDOW)
        expect(mockRedis.zadd).toHaveBeenCalledOnce()
        // 续期秒数 = ceil(windowMs / 1000) + 1
        expect(mockRedis.expire).toHaveBeenCalledWith('rl:test:100', 61)
    })

    it('达到上限 → 拒绝，resetAt 按最早一条记录推算', async () => {
        const earliest = Date.now() - 40_000
        const later = Date.now() - 10_000
        mockPipeline.exec.mockResolvedValue([
            [null, 0],
            [null, 5],
            [null, [String(later), String(earliest)]],
        ])
        const r = await checkRateLimit('rl:test', 100, WINDOW)
        expect(r.allowed).toBe(false)
        expect(r.remaining).toBe(0)
        expect(r.resetAt).toBe(earliest + WINDOW.windowMs)
        // 拒绝时不写入新记录
        expect(mockRedis.zadd).not.toHaveBeenCalled()
    })

    it('超过上限（count > max）同样拒绝；无时间戳时 resetAt 用当前时刻兜底', async () => {
        const before = Date.now()
        mockPipeline.exec.mockResolvedValue([[null, 0], [null, 8], [null, []]])
        const r = await checkRateLimit('rl:test', 100, WINDOW)
        expect(r.allowed).toBe(false)
        expect(r.resetAt).toBeGreaterThanOrEqual(before + WINDOW.windowMs)
    })

    it('用到最后一个名额（count = max-1）→ 放行且剩余为 0', async () => {
        mockPipeline.exec.mockResolvedValue([
            [null, 0],
            [null, 4],
            [null, ['1', '2', '3', '4']],
        ])
        const r = await checkRateLimit('rl:test', 100, WINDOW)
        expect(r.allowed).toBe(true)
        expect(r.remaining).toBe(0)
    })

    it('滑动窗口：每次检查先清理窗口外的旧记录', async () => {
        mockPipeline.exec.mockResolvedValue([[null, 0], [null, 0], [null, []]])
        const before = Date.now()
        await checkRateLimit('rl:test', 100, WINDOW)
        expect(mockPipeline.zremrangebyscore).toHaveBeenCalledOnce()
        const [, low, high] = mockPipeline.zremrangebyscore.mock.calls[0]!
        expect(low).toBe(0)
        // 清理上界 = now - windowMs，落在合理范围
        expect(high).toBeLessThanOrEqual(before)
        expect(high).toBeGreaterThan(before - WINDOW.windowMs - 1000)
    })

    it('Redis key 由前缀与限流主体标识拼接', async () => {
        mockPipeline.exec.mockResolvedValue([[null, 0], [null, 0], [null, []]])
        await checkRateLimit('ratelimit:open:searchLaw:minute', 'user-42', WINDOW)
        expect(mockPipeline.zcard).toHaveBeenCalledWith('ratelimit:open:searchLaw:minute:user-42')
    })

    it('Redis 故障 → 降级放行，不阻断业务', async () => {
        mockPipeline.exec.mockRejectedValue(new Error('redis down'))
        const r = await checkRateLimit('rl:test', 100, WINDOW)
        expect(r.allowed).toBe(true)
        expect(r.remaining).toBe(WINDOW.maxRequests - 1)
    })

    it('pipeline.exec 返回 null → 计数兜底为 0，正常放行', async () => {
        mockPipeline.exec.mockResolvedValue(null)
        const r = await checkRateLimit('rl:test', 100, WINDOW)
        expect(r.allowed).toBe(true)
        expect(r.remaining).toBe(WINDOW.maxRequests - 1)
    })
})
