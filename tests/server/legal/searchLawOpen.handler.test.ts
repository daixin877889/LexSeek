/**
 * 对外法条搜索接口 handler 测试
 * POST /api/open/legal/search-law
 *
 * 覆盖：限流双窗口与 429、鉴权缺失、参数校验、生效状态映射、
 * 结果缓存命中与降级、搜索异常。searchLawService / checkRateLimit /
 * Redis 均打桩，聚焦 handler 自身逻辑。
 *
 * **Feature: legal-open-api**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../_helpers/handler-test'
import { makeEvent, expectSuccess, expectError } from '../_helpers/handler-test'

vi.mock('../../../server/services/legal/searchLaw.tool', () => ({
    searchLawService: vi.fn(),
}))
vi.mock('../../../server/utils/rateLimit', () => ({
    checkRateLimit: vi.fn(),
}))
vi.mock('../../../server/lib/redis', () => ({
    getRedisClient: vi.fn(),
}))

import { searchLawService } from '../../../server/services/legal/searchLaw.tool'
import { checkRateLimit } from '../../../server/utils/rateLimit'
import { getRedisClient } from '../../../server/lib/redis'

const mSearchLaw = vi.mocked(searchLawService)
const mCheckRateLimit = vi.mocked(checkRateLimit)
const mGetRedis = vi.mocked(getRedisClient)

const mockRedis = { get: vi.fn(), set: vi.fn() }

const { default: handler } = await import('../../../server/api/open/legal/search-law.post')

/** 构造一个限流检查结果 */
function rlResult(
    allowed: boolean,
    overrides: Partial<{ remaining: number; limit: number; resetAt: number }> = {},
) {
    return {
        allowed,
        remaining: allowed ? 59 : 0,
        limit: 60,
        resetAt: Date.now() + 60_000,
        ...overrides,
    }
}

describe('POST /api/open/legal/search-law · 对外法条搜索', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mGetRedis.mockReturnValue(mockRedis as never)
        mCheckRateLimit.mockResolvedValue(rlResult(true))
        mSearchLaw.mockResolvedValue({ items: [{ articles_id: 'a1' }], total: 1 } as never)
        mockRedis.get.mockResolvedValue(null)
        mockRedis.set.mockResolvedValue('OK')
    })

    it('happy path → 200 返回 items/total 并写入限流响应头', async () => {
        const event = makeEvent({ userId: 100, body: { query: '违约金' } })
        const res = await handler(event as never)
        expectSuccess(res, d => {
            expect(d.items).toHaveLength(1)
            expect(d.total).toBe(1)
        })
        expect(event.__responseHeaders?.['X-RateLimit-Limit']).toBe('60')
        expect(event.__responseHeaders).toHaveProperty('X-RateLimit-Remaining')
        expect(event.__responseHeaders).toHaveProperty('X-RateLimit-Reset')
    })

    it('未提供用户上下文（鉴权未通过）→ 401', async () => {
        const res = await handler(makeEvent({ body: { query: 'x' } }) as never)
        expectError(res, 401)
    })

    // ---- 限流 ----
    it('分钟 + 小时双窗口都会被检查，按用户 ID 计数', async () => {
        await handler(makeEvent({ userId: 100, body: { query: 'x' } }) as never)
        expect(mCheckRateLimit).toHaveBeenCalledTimes(2)
        expect(mCheckRateLimit.mock.calls[0]?.[0]).toContain('minute')
        expect(mCheckRateLimit.mock.calls[0]?.[1]).toBe(100)
        expect(mCheckRateLimit.mock.calls[1]?.[0]).toContain('hour')
    })

    it('分钟窗口超限 → 429，写 Retry-After，且不再查后续窗口与搜索', async () => {
        mCheckRateLimit.mockResolvedValueOnce(rlResult(false, { resetAt: Date.now() + 30_000 }))
        const event = makeEvent({ userId: 100, body: { query: 'x' } })
        const res = await handler(event as never)
        expectError(res, 429)
        expect(event.__responseHeaders).toHaveProperty('Retry-After')
        expect(mCheckRateLimit).toHaveBeenCalledTimes(1)
        expect(mSearchLaw).not.toHaveBeenCalled()
    })

    it('小时窗口超限 → 429（分钟窗口已放行）', async () => {
        mCheckRateLimit
            .mockResolvedValueOnce(rlResult(true))
            .mockResolvedValueOnce(rlResult(false))
        const res = await handler(makeEvent({ userId: 100, body: { query: 'x' } }) as never)
        expectError(res, 429)
        expect(mCheckRateLimit).toHaveBeenCalledTimes(2)
    })

    // ---- 参数校验 ----
    it('query 为空 → 400', async () => {
        const res = await handler(makeEvent({ userId: 100, body: { query: '' } }) as never)
        expectError(res, 400)
    })

    it('query 超长（>500 字）→ 400', async () => {
        const res = await handler(makeEvent({ userId: 100, body: { query: 'x'.repeat(501) } }) as never)
        expectError(res, 400)
    })

    it('limit 超出上限（>100）→ 400', async () => {
        const res = await handler(makeEvent({ userId: 100, body: { query: 'x', limit: 101 } }) as never)
        expectError(res, 400)
    })

    it('limit 小于 1 → 400', async () => {
        const res = await handler(makeEvent({ userId: 100, body: { query: 'x', limit: 0 } }) as never)
        expectError(res, 400)
    })

    it('limit 非整数 → 400', async () => {
        const res = await handler(makeEvent({ userId: 100, body: { query: 'x', limit: 2.5 } }) as never)
        expectError(res, 400)
    })

    it('legalType 非法值 → 400', async () => {
        const res = await handler(makeEvent({ userId: 100, body: { query: 'x', legalType: 'not-a-type' } }) as never)
        expectError(res, 400)
    })

    it('validityStatus 非法值 → 400', async () => {
        const res = await handler(makeEvent({ userId: 100, body: { query: 'x', validityStatus: 'unknown' } }) as never)
        expectError(res, 400)
    })

    it('请求体缺失 → 400', async () => {
        const res = await handler(makeEvent({ userId: 100 }) as never)
        expectError(res, 400)
    })

    // ---- 生效状态映射 ----
    it('validityStatus 缺省 → 默认 valid → validOnly=true', async () => {
        await handler(makeEvent({ userId: 100, body: { query: 'x' } }) as never)
        expect(mSearchLaw).toHaveBeenCalledWith(expect.objectContaining({ validOnly: true }))
    })

    it('validityStatus=invalid → validOnly=false', async () => {
        await handler(makeEvent({ userId: 100, body: { query: 'x', validityStatus: 'invalid' } }) as never)
        expect(mSearchLaw).toHaveBeenCalledWith(expect.objectContaining({ validOnly: false }))
    })

    it('validityStatus=all → validOnly=undefined', async () => {
        await handler(makeEvent({ userId: 100, body: { query: 'x', validityStatus: 'all' } }) as never)
        expect(mSearchLaw).toHaveBeenCalledWith(expect.objectContaining({ validOnly: undefined }))
    })

    it('validityStatus=pending → validOnly=undefined', async () => {
        await handler(makeEvent({ userId: 100, body: { query: 'x', validityStatus: 'pending' } }) as never)
        expect(mSearchLaw).toHaveBeenCalledWith(expect.objectContaining({ validOnly: undefined }))
    })

    it('limit 缺省 → 默认 10 传入搜索服务', async () => {
        await handler(makeEvent({ userId: 100, body: { query: 'x' } }) as never)
        expect(mSearchLaw).toHaveBeenCalledWith(expect.objectContaining({ limit: 10 }))
    })

    // ---- 结果缓存 ----
    it('缓存命中 → 直接返回缓存内容，不调用搜索服务', async () => {
        mockRedis.get.mockResolvedValueOnce(JSON.stringify({ items: [{ articles_id: 'cached' }], total: 9 }))
        const res = await handler(makeEvent({ userId: 100, body: { query: 'x' } }) as never)
        expectSuccess(res, d => expect(d.total).toBe(9))
        expect(mSearchLaw).not.toHaveBeenCalled()
    })

    it('缓存未命中 → 调用搜索服务并以 1 小时 TTL 写入缓存', async () => {
        await handler(makeEvent({ userId: 100, body: { query: 'x' } }) as never)
        expect(mSearchLaw).toHaveBeenCalledOnce()
        expect(mockRedis.set).toHaveBeenCalledOnce()
        const setArgs = mockRedis.set.mock.calls[0]!
        expect(setArgs[2]).toBe('EX')
        expect(setArgs[3]).toBe(3600)
    })

    it('缓存读取失败 → 降级继续查询，结果正常返回', async () => {
        mockRedis.get.mockRejectedValueOnce(new Error('redis down'))
        const res = await handler(makeEvent({ userId: 100, body: { query: 'x' } }) as never)
        expectSuccess(res)
        expect(mSearchLaw).toHaveBeenCalledOnce()
    })

    it('缓存写入失败 → 不影响结果正常返回', async () => {
        mockRedis.set.mockRejectedValueOnce(new Error('redis down'))
        const res = await handler(makeEvent({ userId: 100, body: { query: 'x' } }) as never)
        expectSuccess(res)
    })

    // ---- 异常 ----
    it('搜索服务抛错 → 500', async () => {
        mSearchLaw.mockRejectedValueOnce(new Error('boom'))
        const res = await handler(makeEvent({ userId: 100, body: { query: 'x' } }) as never)
        expectError(res, 500)
    })
})
