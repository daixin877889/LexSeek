/**
 * server/api/v1/legal/** handler 单元覆盖（5 文件）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../_helpers/handler-test'
import { makeEvent, expectSuccess, expectError } from '../_helpers/handler-test'

vi.mock('../../../server/services/legal/searchLaw.tool', () => ({
    searchLawService: vi.fn(),
}))

;(globalThis as any).prisma = {
    legalMain: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        groupBy: vi.fn(),
    },
    legalArticles: {
        findMany: vi.fn(),
    },
}

import { searchLawService } from '../../../server/services/legal/searchLaw.tool'
const mSearchLaw = vi.mocked(searchLawService)

const { default: detailHandler } = await import('../../../server/api/v1/legal/[id].get')
const { default: authoritiesHandler } = await import('../../../server/api/v1/legal/issuing-authorities.get')
const { default: searchHandler } = await import('../../../server/api/v1/legal/search-articles.post')
const { default: statsHandler } = await import('../../../server/api/v1/legal/statistics.get')
const { default: listHandler } = await import('../../../server/api/v1/legal/list.get')

const VALID_UUID = '11111111-1111-4111-8111-111111111111'

describe('GET /api/v1/legal/:id', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path', async () => {
        ;(globalThis as any).prisma.legalMain.findUnique.mockResolvedValue({
            id: VALID_UUID, name: 'L1', code: 'C', type: 'law', category: 'X',
            content: '...', issuingAuthority: 'A', documentNumber: 'D',
            publishDate: new Date('2026-01-01'),
            effectiveDate: new Date('2026-02-01'),
            invalidDate: null,
        })
        ;(globalThis as any).prisma.legalArticles.findMany.mockResolvedValue([
            {
                id: 'art-1', legalId: VALID_UUID, type: 'article', l1: '1', l1I: 1,
                l2: null, l2I: null, l3: null, l3I: null, l4: null, l4I: null, l5: null, l5I: null,
                order: 1, content: 'C',
                publishDate: new Date('2026-01-01'),
                effectiveDate: new Date('2026-02-01'),
                invalidDate: null,
                lastEditedAt: new Date('2026-03-01'),
                lastEmbeddingAt: null,
                createdAt: new Date('2026-01-01'),
            },
        ])
        const res: any = await detailHandler(makeEvent({ userId: 100, params: { id: VALID_UUID } }) as any)
        expectSuccess(res, d => {
            expect(d.publishDate).toBe('2026-01-01')
            expect(d.articles).toHaveLength(1)
        })
    })

    it('未登录 → 401', async () => {
        const res: any = await detailHandler(makeEvent({ params: { id: VALID_UUID } }) as any)
        expectError(res, 401)
    })

    it('id 非 uuid → 400', async () => {
        const res: any = await detailHandler(makeEvent({ userId: 100, params: { id: 'bad' } }) as any)
        expectError(res, 400)
    })

    it('法规不存在 → 404', async () => {
        ;(globalThis as any).prisma.legalMain.findUnique.mockResolvedValue(null)
        const res: any = await detailHandler(makeEvent({ userId: 100, params: { id: VALID_UUID } }) as any)
        expectError(res, 404)
    })

    it('prisma 抛错 → 500', async () => {
        ;(globalThis as any).prisma.legalMain.findUnique.mockRejectedValueOnce(new Error('db'))
        const res: any = await detailHandler(makeEvent({ userId: 100, params: { id: VALID_UUID } }) as any)
        expectError(res, 500)
    })
})

describe('GET /api/v1/legal/issuing-authorities', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path → 按全角/半角逗号拆分去重排序', async () => {
        ;(globalThis as any).prisma.legalMain.findMany.mockResolvedValue([
            { issuingAuthority: '全国人大常委会, 国务院' },
            { issuingAuthority: '最高人民法院，最高人民检察院' },
            { issuingAuthority: '国务院' }, // 重复
            { issuingAuthority: null },
            { issuingAuthority: '   ' }, // 空白
        ])
        const res: any = await authoritiesHandler(makeEvent({ userId: 100 }) as any)
        expectSuccess(res, d => {
            expect(d.items).toContain('国务院')
            expect(d.items).toContain('最高人民法院')
            // 去重
            expect(d.items.filter((x: string) => x === '国务院')).toHaveLength(1)
        })
    })

    it('未登录 → 401', async () => {
        const res: any = await authoritiesHandler(makeEvent({}) as any)
        expectError(res, 401)
    })

    it('prisma 抛错 → 500', async () => {
        ;(globalThis as any).prisma.legalMain.findMany.mockRejectedValueOnce(new Error('db'))
        const res: any = await authoritiesHandler(makeEvent({ userId: 100 }) as any)
        expectError(res, 500)
    })
})

describe('POST /api/v1/legal/search-articles', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mSearchLaw.mockResolvedValue({ items: [{ id: 'a', score: 0.9 }], total: 1 } as any)
    })

    it('happy path（默认 valid → validOnly=true）', async () => {
        const res: any = await searchHandler(makeEvent({
            userId: 100, body: { query: '违约金' },
        }) as any)
        expectSuccess(res)
        expect(mSearchLaw).toHaveBeenCalledWith(expect.objectContaining({ validOnly: true }))
    })

    it('未登录 → 401', async () => {
        const res: any = await searchHandler(makeEvent({ body: { query: 'x' } }) as any)
        expectError(res, 401)
    })

    it('Zod 校验失败 → 400', async () => {
        const res: any = await searchHandler(makeEvent({ userId: 100, body: { query: '' } }) as any)
        expectError(res, 400)
    })

    it('validityStatus=invalid → validOnly=false', async () => {
        await searchHandler(makeEvent({
            userId: 100, body: { query: 'x', validityStatus: 'invalid' },
        }) as any)
        expect(mSearchLaw).toHaveBeenCalledWith(expect.objectContaining({ validOnly: false }))
    })

    it('validityStatus=all → validOnly=undefined', async () => {
        await searchHandler(makeEvent({
            userId: 100, body: { query: 'x', validityStatus: 'all' },
        }) as any)
        expect(mSearchLaw).toHaveBeenCalledWith(expect.objectContaining({ validOnly: undefined }))
    })

    it('validityStatus=pending → validOnly=undefined', async () => {
        await searchHandler(makeEvent({
            userId: 100, body: { query: 'x', validityStatus: 'pending' },
        }) as any)
        expect(mSearchLaw).toHaveBeenCalledWith(expect.objectContaining({ validOnly: undefined }))
    })

    it('search 抛错 → 500', async () => {
        mSearchLaw.mockRejectedValueOnce(new Error('boom'))
        const res: any = await searchHandler(makeEvent({ userId: 100, body: { query: 'x' } }) as any)
        expectError(res, 500)
    })
})

describe('GET /api/v1/legal/statistics', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path', async () => {
        ;(globalThis as any).prisma.legalMain.groupBy.mockResolvedValue([
            { type: 'law', _count: { id: 5 } },
            { type: 'regulation', _count: { id: 3 } },
            { type: 'unknown_type', _count: { id: 1 } }, // 不在 byType 里 → 跳过
        ])
        ;(globalThis as any).prisma.legalMain.count
            .mockResolvedValueOnce(7) // valid
            .mockResolvedValueOnce(2) // invalid
        const res: any = await statsHandler(makeEvent({ userId: 100 }) as any)
        expectSuccess(res, d => {
            expect(d.total).toBe(8)
            expect(d.byStatus.valid).toBe(7)
        })
    })

    it('未登录 → 401', async () => {
        const res: any = await statsHandler(makeEvent({}) as any)
        expectError(res, 401)
    })

    it('prisma 抛错 → 500', async () => {
        ;(globalThis as any).prisma.legalMain.groupBy.mockRejectedValueOnce(new Error('db'))
        const res: any = await statsHandler(makeEvent({ userId: 100 }) as any)
        expectError(res, 500)
    })
})

describe('GET /api/v1/legal/list', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ;(globalThis as any).prisma.legalMain.count.mockResolvedValue(0)
        ;(globalThis as any).prisma.legalMain.findMany.mockResolvedValue([])
    })

    it('happy path 默认参数', async () => {
        const res: any = await listHandler(makeEvent({ userId: 100, query: {} }) as any)
        expectSuccess(res, d => {
            expect(d.page).toBe(1)
            expect(d.pageSize).toBe(20)
        })
    })

    it('未登录 → 401', async () => {
        const res: any = await listHandler(makeEvent({ query: {} }) as any)
        expectError(res, 401)
    })

    it('参数非法 → 400', async () => {
        const res: any = await listHandler(makeEvent({ userId: 100, query: { pageSize: '999' } }) as any)
        expectError(res, 400)
    })

    it('keyword 注入 OR 模糊匹配', async () => {
        await listHandler(makeEvent({ userId: 100, query: { keyword: '民法' } }) as any)
        const where = (globalThis as any).prisma.legalMain.findMany.mock.calls[0][0].where
        expect(where.OR).toBeDefined()
    })

    it('validityStatus=valid → 注入 AND', async () => {
        await listHandler(makeEvent({ userId: 100, query: { validityStatus: 'valid' } }) as any)
        const where = (globalThis as any).prisma.legalMain.findMany.mock.calls[0][0].where
        expect(where.AND).toBeDefined()
    })

    it('validityStatus=pending → effectiveDate 在未来', async () => {
        await listHandler(makeEvent({ userId: 100, query: { validityStatus: 'pending' } }) as any)
        const where = (globalThis as any).prisma.legalMain.findMany.mock.calls[0][0].where
        expect(where.effectiveDate?.gt).toBeInstanceOf(Date)
    })

    it('validityStatus=invalid → invalidDate 已过', async () => {
        await listHandler(makeEvent({ userId: 100, query: { validityStatus: 'invalid' } }) as any)
        const where = (globalThis as any).prisma.legalMain.findMany.mock.calls[0][0].where
        expect(where.invalidDate?.lte).toBeInstanceOf(Date)
    })

    it('日期范围与发文机关筛选', async () => {
        await listHandler(makeEvent({
            userId: 100,
            query: {
                publishDateFrom: '2026-01-01',
                publishDateTo: '2026-12-31',
                issuingAuthority: '国务院',
            },
        }) as any)
        const where = (globalThis as any).prisma.legalMain.findMany.mock.calls[0][0].where
        expect(where.publishDate.gte).toBeInstanceOf(Date)
        expect(where.publishDate.lte).toBeInstanceOf(Date)
        expect(where.issuingAuthority?.contains).toBe('国务院')
    })

    it('prisma 抛错 → 500', async () => {
        ;(globalThis as any).prisma.legalMain.count.mockRejectedValueOnce(new Error('db'))
        const res: any = await listHandler(makeEvent({ userId: 100, query: {} }) as any)
        expectError(res, 500)
    })
})
