/**
 * list.get 搜索日志写入测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const resError = (_event: any, code: number, message: string) => ({ code, success: false, message, data: null })
const resSuccess = (_event: any, message: string, data: any) => ({ code: 0, success: true, message, data })
;(globalThis as any).resError = resError
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).getQuery = (event: any) => event.__query ?? {}
;(globalThis as any).logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

const recordSearch = vi.fn()
vi.mock('~~/server/services/legal/trending.service', () => ({
    recordSearchService: (params: any) => recordSearch(params),
}))

const { default: listHandler } = await import('~~/server/api/v1/legal/list.get')

const prismaCount = vi.fn()
const prismaFindMany = vi.fn()
const realPrisma = (globalThis as any).prisma

function buildEvent(query: Record<string, string>, user = { id: 'u1' }) {
    return { context: { auth: { user } }, __query: query } as any
}

beforeEach(() => {
    recordSearch.mockReset()
    prismaCount.mockReset().mockResolvedValue(2)
    prismaFindMany.mockReset().mockResolvedValue([
        { id: 'L1', name: '民法典', code: 'A', type: 'law', category: null, issuingAuthority: null, documentNumber: null, publishDate: null, effectiveDate: null, invalidDate: null, lastEditedAt: null, lastEmbeddingAt: null, createdAt: null },
        { id: 'L2', name: '物权法', code: 'B', type: 'law', category: null, issuingAuthority: null, documentNumber: null, publishDate: null, effectiveDate: null, invalidDate: null, lastEditedAt: null, lastEmbeddingAt: null, createdAt: null },
    ])
    ;(globalThis as any).prisma = {
        legalMain: { count: prismaCount, findMany: prismaFindMany },
    }
})

afterEach(() => {
    ;(globalThis as any).prisma = realPrisma
})

describe('GET /api/v1/legal/list 搜索日志写入', () => {
    it('keyword 为空时不调 recordSearchService', async () => {
        await listHandler(buildEvent({}))
        expect(recordSearch).not.toHaveBeenCalled()
    })

    it('keyword 非空时调 recordSearchService，携带 resultCount 和前 20 条 id', async () => {
        await listHandler(buildEvent({ keyword: '民法典' }))
        expect(recordSearch).toHaveBeenCalledWith({
            scope: 'legal',
            rawKeyword: '民法典',
            userId: 'u1',
            resultCount: 2,
            resultIds: { ids: ['L1', 'L2'] },
        })
    })
})
