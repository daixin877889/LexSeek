/**
 * 法律法规检索热门词 service 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// logger 是 server 自动导入，测试侧需要 stub
;(globalThis as any).logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

const redisSet = vi.fn()
const redisZincrby = vi.fn()
const redisExpire = vi.fn()
const redisGet = vi.fn()
const redisZunionstore = vi.fn()
const redisZrevrange = vi.fn()
const redisDel = vi.fn()

vi.mock('~~/server/lib/redis', () => ({
    getRedisClient: () => ({
        set: redisSet,
        zincrby: redisZincrby,
        expire: redisExpire,
        get: redisGet,
        zunionstore: redisZunionstore,
        zrevrange: redisZrevrange,
        del: redisDel,
    }),
}))

const prismaCreate = vi.fn()
vi.mock('~~/server/utils/db', () => ({
    prisma: {
        legal_search_logs: {
            create: (...args: any[]) => prismaCreate(...args),
        },
    },
}))

import {
    normalizeKeywordService,
    recordSearchService,
} from '~~/server/services/legal/trending.service'

beforeEach(() => {
    redisSet.mockReset()
    redisZincrby.mockReset()
    redisExpire.mockReset()
    redisGet.mockReset()
    redisZunionstore.mockReset()
    redisZrevrange.mockReset()
    redisDel.mockReset()
    prismaCreate.mockReset()
})

describe('normalizeKeywordService', () => {
    it('去除首尾空白并合并连续空格', () => {
        expect(normalizeKeywordService('  民法典   合同   ')).toBe('民法典 合同')
    })

    it('长度 < 2 返回 null', () => {
        expect(normalizeKeywordService('a')).toBeNull()
        expect(normalizeKeywordService(' ')).toBeNull()
        expect(normalizeKeywordService('')).toBeNull()
    })

    it('长度 > 50 返回 null', () => {
        expect(normalizeKeywordService('民'.repeat(51))).toBeNull()
    })

    it('纯标点 / 纯空白返回 null', () => {
        expect(normalizeKeywordService('!!!???')).toBeNull()
        expect(normalizeKeywordService(',,。 ')).toBeNull()
    })

    it('混合中文 + 字母数字正常返回', () => {
        expect(normalizeKeywordService('民法典 2026')).toBe('民法典 2026')
        expect(normalizeKeywordService('Labor Law')).toBe('Labor Law')
    })
})

describe('recordSearchService', () => {
    it('归一化失败时直接返回，不调任何后端', async () => {
        await recordSearchService({ scope: 'legal', rawKeyword: 'a', userId: 'u1' })
        expect(redisSet).not.toHaveBeenCalled()
        expect(prismaCreate).not.toHaveBeenCalled()
    })

    it('NX 命中防刷时不计数也不写日志', async () => {
        redisSet.mockResolvedValueOnce(null) // NX 失败
        await recordSearchService({ scope: 'legal', rawKeyword: '民法典', userId: 'u1' })
        expect(redisSet).toHaveBeenCalledWith(
            'dedupe:trending:u1:legal:民法典',
            '1',
            'EX',
            30,
            'NX',
        )
        expect(redisZincrby).not.toHaveBeenCalled()
        expect(prismaCreate).not.toHaveBeenCalled()
    })

    it('NX 未命中时并行写 Redis 桶 + Prisma 日志', async () => {
        redisSet.mockResolvedValueOnce('OK')
        redisZincrby.mockResolvedValueOnce(1)
        redisExpire.mockResolvedValueOnce(1)
        prismaCreate.mockResolvedValueOnce({ id: 'log-1' })

        await recordSearchService({
            scope: 'article',
            rawKeyword: '  违约金 调整  ',
            userId: 'u2',
            resultCount: 12,
            resultIds: { ids: ['a1', 'a2'], scores: [0.9, 0.85] },
        })

        expect(redisZincrby).toHaveBeenCalledWith(
            expect.stringMatching(/^trending:bucket:article:\d{8}$/),
            1,
            '违约金 调整',
        )
        expect(redisExpire).toHaveBeenCalledWith(
            expect.stringMatching(/^trending:bucket:article:\d{8}$/),
            60 * 60 * 24 * 8,
        )
        expect(prismaCreate).toHaveBeenCalledWith({
            data: {
                scope: 'article',
                keyword: '违约金 调整',
                userId: 'u2',
                resultCount: 12,
                resultIds: { ids: ['a1', 'a2'], scores: [0.9, 0.85] },
            },
        })
    })

    it('Redis / Prisma 抛错时不抛给调用方', async () => {
        redisSet.mockRejectedValueOnce(new Error('redis down'))
        await expect(
            recordSearchService({ scope: 'legal', rawKeyword: '民法典', userId: 'u1' }),
        ).resolves.toBeUndefined()
    })
})

describe('getTrendingKeywordsService', () => {
    it('缓存命中时直接返回，不打 Redis 聚合', async () => {
        redisGet.mockResolvedValueOnce(JSON.stringify([
            { keyword: '民法典', count: 5 },
            { keyword: '劳动合同法', count: 3 },
        ]))
        const { getTrendingKeywordsService } = await import('~~/server/services/legal/trending.service')
        const out = await getTrendingKeywordsService('legal', 5)
        expect(out).toEqual([
            { keyword: '民法典', count: 5 },
            { keyword: '劳动合同法', count: 3 },
        ])
        expect(redisZunionstore).not.toHaveBeenCalled()
    })

    it('缓存未命中时 ZUNIONSTORE 合并 7 个桶并 ZREVRANGE 取 top N', async () => {
        redisGet.mockResolvedValueOnce(null)
        redisZunionstore.mockResolvedValueOnce(2)
        redisZrevrange.mockResolvedValueOnce(['民法典', '7', '公司法', '4'])
        redisDel.mockResolvedValueOnce(1)
        redisSet.mockResolvedValueOnce('OK')

        const { getTrendingKeywordsService } = await import('~~/server/services/legal/trending.service')
        const out = await getTrendingKeywordsService('legal', 5)

        expect(redisZunionstore).toHaveBeenCalledWith(
            expect.stringMatching(/^trending:tmp:legal:/),
            7,
            ...Array.from({ length: 7 }, () => expect.stringMatching(/^trending:bucket:legal:\d{8}$/)),
            'AGGREGATE',
            'SUM',
        )
        expect(redisZrevrange).toHaveBeenCalledWith(
            expect.stringMatching(/^trending:tmp:legal:/),
            0,
            4,
            'WITHSCORES',
        )
        expect(redisDel).toHaveBeenCalled()
        expect(redisSet).toHaveBeenCalledWith(
            'trending:cache:legal',
            JSON.stringify([
                { keyword: '民法典', count: 7 },
                { keyword: '公司法', count: 4 },
            ]),
            'EX',
            60,
        )
        expect(out).toEqual([
            { keyword: '民法典', count: 7 },
            { keyword: '公司法', count: 4 },
        ])
    })

    it('Redis 抛错时返回空数组', async () => {
        redisGet.mockRejectedValueOnce(new Error('redis down'))
        const { getTrendingKeywordsService } = await import('~~/server/services/legal/trending.service')
        const out = await getTrendingKeywordsService('legal', 5)
        expect(out).toEqual([])
    })
})
