/**
 * agent-platform/state/storage 单测
 *
 * 验证：
 * - getSessionState：null 数据返回 null / JSON 解析失败返回 null + warn / 正常解析
 * - updateSessionState：read-modify-write 合并 + 调用 redis.set 含 TTL
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { redisGet, redisSet, warnSpy } = vi.hoisted(() => ({
    redisGet: vi.fn(),
    redisSet: vi.fn().mockResolvedValue('OK'),
    warnSpy: vi.fn(),
}))

vi.mock('~~/server/lib/redis', () => ({
    getRedisClient: () => ({ get: redisGet, set: redisSet }),
}))
vi.mock('#shared/utils/logger', () => ({
    logger: { info: vi.fn(), error: vi.fn(), warn: warnSpy, debug: vi.fn() },
}))
;(globalThis as any).logger = { info: vi.fn(), error: vi.fn(), warn: warnSpy, debug: vi.fn() }

import {
    getSessionState,
    updateSessionState,
} from '~~/server/services/agent-platform/state/storage'

beforeEach(() => {
    vi.clearAllMocks()
})

describe('getSessionState', () => {
    it('redis 返回 null 时返回 null', async () => {
        redisGet.mockResolvedValueOnce(null)
        const out = await getSessionState('s-1')
        expect(out).toBeNull()
        expect(redisGet).toHaveBeenCalledWith('session_state:s-1')
    })

    it('redis 返回有效 JSON 时解析后返回对象', async () => {
        redisGet.mockResolvedValueOnce(JSON.stringify({ tokenCost: 100, lastTool: 'search' }))
        const out = await getSessionState('s-1')
        expect(out).toEqual({ tokenCost: 100, lastTool: 'search' })
    })

    it('redis 返回非法 JSON 时返回 null 并 warn', async () => {
        redisGet.mockResolvedValueOnce('not json {{{')
        const out = await getSessionState('s-1')
        expect(out).toBeNull()
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('s-1'))
    })
})

describe('updateSessionState', () => {
    it('current 为 null 时直接写入 partialState', async () => {
        redisGet.mockResolvedValueOnce(null)
        await updateSessionState('s-1', { tokenCost: 50 })
        expect(redisSet).toHaveBeenCalledOnce()
        const [key, value, mode, ttl] = redisSet.mock.calls[0]
        expect(key).toBe('session_state:s-1')
        expect(JSON.parse(value)).toEqual({ tokenCost: 50 })
        expect(mode).toBe('EX')
        expect(ttl).toBe(7200) // 2 小时
    })

    it('current 有值时进行浅合并', async () => {
        redisGet.mockResolvedValueOnce(JSON.stringify({ tokenCost: 100, lastTool: 'search' }))
        await updateSessionState('s-1', { tokenCost: 200, newField: 'x' })
        const [, value] = redisSet.mock.calls[0]
        expect(JSON.parse(value)).toEqual({
            tokenCost: 200,
            lastTool: 'search',
            newField: 'x',
        })
    })

    it('partialState 为空对象时仍写入 current 数据', async () => {
        redisGet.mockResolvedValueOnce(JSON.stringify({ a: 1 }))
        await updateSessionState('s-1', {})
        const [, value] = redisSet.mock.calls[0]
        expect(JSON.parse(value)).toEqual({ a: 1 })
    })
})
