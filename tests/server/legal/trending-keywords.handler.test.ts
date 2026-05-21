/**
 * trending-keywords handler 测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const resError = (_event: any, code: number, message: string) => ({ code, success: false, message, data: null })
const resSuccess = (_event: any, message: string, data: any) => ({ code: 0, success: true, message, data })
;(globalThis as any).resError = resError
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).getQuery = (event: any) => event.__query ?? {}

const getTrending = vi.fn()
vi.mock('~~/server/services/legal/trending.service', () => ({
    getTrendingKeywordsService: (scope: any, limit: any) => getTrending(scope, limit),
}))

const { default: trendingHandler } = await import('~~/server/api/v1/legal/trending-keywords.get')

interface MockEvent {
    context: { auth?: { user: { id: string } } }
    __query?: Record<string, any>
}

function buildEvent(query: Record<string, string>, user: { id: string } | null = { id: 'u1' }): MockEvent {
    return {
        context: user ? { auth: { user } } : {},
        __query: query,
    }
}

beforeEach(() => {
    getTrending.mockReset()
})

describe('GET /api/v1/legal/trending-keywords', () => {
    it('未登录返回 401', async () => {
        const res: any = await trendingHandler(buildEvent({ scope: 'legal' }, null))
        expect(res.code).toBe(401)
    })

    it('scope 缺失返回 400', async () => {
        const res: any = await trendingHandler(buildEvent({}))
        expect(res.code).toBe(400)
    })

    it('scope=legal 时调 service 并返回 items', async () => {
        getTrending.mockResolvedValueOnce([{ keyword: '民法典', count: 7 }])
        const res: any = await trendingHandler(buildEvent({ scope: 'legal' }))
        expect(getTrending).toHaveBeenCalledWith('legal', 5)
        expect(res.data).toEqual({ items: [{ keyword: '民法典', count: 7 }] })
    })

    it('limit 参数被透传到 service', async () => {
        getTrending.mockResolvedValueOnce([])
        await trendingHandler(buildEvent({ scope: 'article', limit: '10' }))
        expect(getTrending).toHaveBeenCalledWith('article', 10)
    })
})
