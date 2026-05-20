/**
 * search-articles 搜索日志写入测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const resError = (_event: any, code: number, message: string) => ({ code, success: false, message, data: null })
const resSuccess = (_event: any, message: string, data: any) => ({ code: 0, success: true, message, data })
;(globalThis as any).resError = resError
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).readBody = async (event: any) => event.__body
;(globalThis as any).logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

const recordSearch = vi.fn()
vi.mock('~~/server/services/legal/trending.service', () => ({
    recordSearchService: (params: any) => recordSearch(params),
}))

const searchLaw = vi.fn()
vi.mock('~~/server/services/legal/searchLaw.tool', () => ({
    searchLawService: (params: any) => searchLaw(params),
}))

const { default: articlesHandler } = await import('~~/server/api/v1/legal/search-articles.post')

function buildEvent(body: Record<string, any>, user = { id: 'u9' }) {
    return { context: { auth: { user } }, __body: body } as any
}

beforeEach(() => {
    recordSearch.mockReset()
    searchLaw.mockReset().mockResolvedValue({
        items: [
            { articles_id: 'A1', score: 0.92, content: '...', legal_id: 'L', legal_name: 'X', chapter_hierarchy: [], metadata: {} },
            { articles_id: 'A2', score: 0.81, content: '...', legal_id: 'L', legal_name: 'X', chapter_hierarchy: [], metadata: {} },
        ],
        total: 2,
        mode: 'vector',
    })
})

describe('POST /api/v1/legal/search-articles 搜索日志写入', () => {
    it('总是调 recordSearchService，scope=article 且携带 ids+scores', async () => {
        await articlesHandler(buildEvent({ query: '违约金调整' }))
        expect(recordSearch).toHaveBeenCalledWith({
            scope: 'article',
            rawKeyword: '违约金调整',
            userId: 'u9',
            resultCount: 2,
            resultIds: { ids: ['A1', 'A2'], scores: [0.92, 0.81] },
        })
    })
})
