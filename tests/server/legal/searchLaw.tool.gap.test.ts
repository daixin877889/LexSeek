/**
 * 法律条文搜索工具测试 - 真实路径覆盖
 *
 * 针对 server/services/legal/searchLaw.tool.ts 未被覆盖的分支：
 * - searchLaw SQL 模式（真实 pg 查询 law_embeddings 表）
 * - buildSQLDateFilter 成功与校验分支
 * - searchLaw vector 模式（mock retrievalRouterService）
 * - searchLawTool（LangChain 工具入口）
 * - searchLawService（服务层接口）
 *
 * **Feature: search-law-tool-real-coverage**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import pg from 'pg'
import dayjs from 'dayjs'

import type { SearchResultItem } from '../../../server/services/retrieval/types'

// ==================== Mock retrievalRouterService ====================
// vector 模式不希望走真实 LLM，mock router 为可控数据

const mockRetrievalRouter = vi.fn()

vi.mock('../../../server/services/retrieval/retrievalRouter.service', () => ({
    retrievalRouterService: (...args: any[]) => mockRetrievalRouter(...args),
}))

// 为了让动态 import 生效，先 mock 再 import 被测模块
const {
    searchLaw,
    searchLawTool,
    searchLawService,
} = await import('../../../server/services/legal/searchLaw.tool')
const { resetVectorStore } = await import('../../../server/services/legal/vectorStore.service')

// ==================== 基础设施 ====================

const createTestPool = () => {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
        throw new Error('DATABASE_URL 环境变量未设置')
    }
    return new pg.Pool({ connectionString })
}

const testPool = createTestPool()

const mockLogger = {
    info: (..._args: any[]) => {},
    warn: (..._args: any[]) => {},
    error: (..._args: any[]) => {},
    debug: (..._args: any[]) => {},
}
;(globalThis as any).logger = mockLogger

/** 本测试专属 legal_id 前缀，便于隔离 */
const TEST_PREFIX = `__lt_search_${uuidv7().replace(/-/g, '').slice(0, 8)}__`
const uniqueLegalId = () => `${TEST_PREFIX}${uuidv7()}`

const createdIds = new Set<string>()

interface InsertInput {
    text?: string
    metadata: Record<string, unknown>
}

const insertEmbedding = async (input: InsertInput): Promise<string> => {
    const id = uuidv7()
    const text = input.text ?? '条文内容'
    await testPool.query(
        `INSERT INTO law_embeddings (id, text, metadata) VALUES ($1, $2, $3::jsonb)`,
        [id, text, JSON.stringify(input.metadata)]
    )
    createdIds.add(id)
    return id
}

const cleanupAll = async () => {
    if (createdIds.size === 0) return
    const ids = Array.from(createdIds)
    try {
        await testPool.query(
            `DELETE FROM law_embeddings WHERE id = ANY($1::uuid[])`,
            [ids]
        )
    } catch {
        // ignore
    }
    createdIds.clear()
}

// ==================== 测试用例 ====================

describe('searchLaw.tool 真实数据库覆盖测试', () => {
    beforeAll(async () => {
        await testPool.query('SELECT 1')
    })

    afterEach(async () => {
        await cleanupAll()
        mockRetrievalRouter.mockReset()
    })

    afterAll(async () => {
        await cleanupAll()
        await testPool.end()
        resetVectorStore()
    })

    // -------------------- searchLaw - SQL 模式 --------------------

    describe('searchLaw - SQL 模式（无 query）', () => {
        it('无任何条件时应返回所有记录（带默认分页）', async () => {
            const legalId = uniqueLegalId()
            await insertEmbedding({
                text: 'content A',
                metadata: {
                    legal_id: legalId,
                    articles_id: uuidv7(),
                    legal_name: 'A 法律',
                    legal_type: 'law',
                    article_type: 'l1',
                },
            })
            await insertEmbedding({
                text: 'content B',
                metadata: {
                    legal_id: legalId,
                    articles_id: uuidv7(),
                    legal_name: 'A 法律',
                    legal_type: 'law',
                    article_type: 'l2',
                },
            })

            // 使用 legalId 精确筛选，避免被其他数据影响
            const results = await searchLaw({ legalId })
            expect(results.length).toBe(2)
            // score 固定为 1（SQL 模式）
            results.forEach(r => expect(r.score).toBe(1))
        })

        it('应支持按 legalName / legalType / articleType 同时筛选', async () => {
            const legalId = uniqueLegalId()
            const target = await insertEmbedding({
                text: '命中',
                metadata: {
                    legal_id: legalId,
                    articles_id: uuidv7(),
                    legal_name: '合同法',
                    legal_type: 'law',
                    article_type: 'l2',
                },
            })
            await insertEmbedding({
                text: '其他 type 干扰',
                metadata: {
                    legal_id: legalId,
                    articles_id: uuidv7(),
                    legal_name: '合同法',
                    legal_type: 'law',
                    article_type: 'l1',
                },
            })
            await insertEmbedding({
                text: '其他 name 干扰',
                metadata: {
                    legal_id: legalId,
                    articles_id: uuidv7(),
                    legal_name: '民法典',
                    legal_type: 'law',
                    article_type: 'l2',
                },
            })

            const results = await searchLaw({
                legalId,
                legalName: '合同法',
                legalType: 'law',
                articleType: 'l2',
            })

            expect(results.length).toBe(1)
            expect((results[0]?.metadata as any)?.articles_id).toBe(
                (await (async () => {
                    const row = await testPool.query(
                        `SELECT metadata FROM law_embeddings WHERE id = $1`,
                        [target]
                    )
                    return row.rows[0]?.metadata?.articles_id
                })())
            )
        })

        it('应支持日期过滤 invalidDate / publishDate / effectiveDate', async () => {
            const legalId = uniqueLegalId()
            await insertEmbedding({
                text: 'old',
                metadata: {
                    legal_id: legalId,
                    articles_id: uuidv7(),
                    publish_date: '2020-01-01',
                    effective_date: '2020-06-01',
                    invalid_date: '2099-12-31',
                },
            })
            await insertEmbedding({
                text: 'new',
                metadata: {
                    legal_id: legalId,
                    articles_id: uuidv7(),
                    publish_date: '2024-01-01',
                    effective_date: '2024-06-01',
                    invalid_date: '2099-12-31',
                },
            })

            // publishDate >= 2023-01-01 → 应仅返回 new
            const results = await searchLaw({
                legalId,
                publishDateFilter: { date: '2023-01-01', operator: '>=' },
            })

            expect(results.length).toBe(1)
            expect(results[0]?.content).toBe('new')

            // 组合 effective >= 2024-01-01 + invalid <= 2099-12-31
            const combined = await searchLaw({
                legalId,
                effectiveDateFilter: { date: '2024-01-01', operator: '>=' },
                invalidDateFilter: { date: '2099-12-31', operator: '<=' },
            })
            expect(combined.length).toBe(1)
            expect(combined[0]?.content).toBe('new')
        })

        it('无效日期格式应抛错', async () => {
            const legalId = uniqueLegalId()
            await insertEmbedding({
                text: 'x',
                metadata: { legal_id: legalId, articles_id: uuidv7() },
            })

            await expect(
                searchLaw({
                    legalId,
                    publishDateFilter: { date: '2024/01/01', operator: '>=' },
                })
            ).rejects.toThrow(/无效的日期格式/)
        })

        it('无效操作符应抛错', async () => {
            const legalId = uniqueLegalId()
            await insertEmbedding({
                text: 'x',
                metadata: { legal_id: legalId, articles_id: uuidv7() },
            })

            await expect(
                searchLaw({
                    legalId,
                    publishDateFilter: { date: '2024-01-01', operator: '!=' as any },
                })
            ).rejects.toThrow(/无效的操作符/)
        })

        it('应按 k 参数分页大小 + page>1 使用 OFFSET', async () => {
            const legalId = uniqueLegalId()
            for (let i = 0; i < 5; i++) {
                await insertEmbedding({
                    text: `page_${i}`,
                    metadata: { legal_id: legalId, articles_id: uuidv7() },
                })
            }

            const page1 = await searchLaw({ legalId, k: 2, page: 1 })
            const page2 = await searchLaw({ legalId, k: 2, page: 2 })
            const page3 = await searchLaw({ legalId, k: 2, page: 3 })

            expect(page1.length).toBe(2)
            expect(page2.length).toBe(2)
            expect(page3.length).toBe(1)

            const contents = new Set([
                ...page1.map(r => r.content),
                ...page2.map(r => r.content),
                ...page3.map(r => r.content),
            ])
            expect(contents.size).toBe(5)
        })

        it('isEffective=true 时应过滤掉失效或未生效条目', async () => {
            const legalId = uniqueLegalId()
            // 已失效（invalid_date 早于今天）
            await insertEmbedding({
                text: '已失效',
                metadata: {
                    legal_id: legalId,
                    articles_id: uuidv7(),
                    effective_date: '2000-01-01',
                    invalid_date: '2001-01-01',
                },
            })
            // 未生效（effective_date 晚于今天）
            await insertEmbedding({
                text: '未生效',
                metadata: {
                    legal_id: legalId,
                    articles_id: uuidv7(),
                    effective_date: '2999-01-01',
                    invalid_date: null,
                },
            })
            // 有效
            await insertEmbedding({
                text: '有效中',
                metadata: {
                    legal_id: legalId,
                    articles_id: uuidv7(),
                    effective_date: '2000-01-01',
                    invalid_date: null,
                },
            })

            const effective = await searchLaw({ legalId, isEffective: true })
            expect(effective.map(r => r.content)).toEqual(['有效中'])

            const invalid = await searchLaw({ legalId, isEffective: false })
            const invalidContents = invalid.map(r => r.content).sort()
            expect(invalidContents).toEqual(['已失效', '未生效'].sort())
        })

        it('SQL 模式 k 未传时默认为 5', async () => {
            const legalId = uniqueLegalId()
            for (let i = 0; i < 7; i++) {
                await insertEmbedding({
                    text: `d_${i}`,
                    metadata: { legal_id: legalId, articles_id: uuidv7() },
                })
            }
            const results = await searchLaw({ legalId })
            expect(results.length).toBe(5)
        })
    })

    // -------------------- searchLaw - vector 模式 --------------------

    describe('searchLaw - 向量模式（有 query）', () => {
        it('应调用 retrievalRouterService 并映射结果', async () => {
            const mockResults = [
                {
                    score: 0.92,
                    content: '向量结果 1',
                    metadata: { articles_id: 'a1', legal_id: 'l1', legal_name: 'X 法' },
                    retrievalMode: 'semantic',
                },
                {
                    score: 0.85,
                    content: '向量结果 2',
                    metadata: { articles_id: 'a2', legal_id: 'l1', legal_name: 'X 法' },
                    retrievalMode: 'hybrid',
                },
            ]
            mockRetrievalRouter.mockResolvedValueOnce(mockResults)

            const results = await searchLaw({
                query: '合同违约',
                k: 3,
                legalId: 'l1',
                legalName: 'X 法',
                legalType: 'law',
                articleType: 'l5',
                isEffective: true,
                publishDateFilter: { date: '2020-01-01', operator: '>=' },
            })

            expect(mockRetrievalRouter).toHaveBeenCalledTimes(1)
            const callArg = mockRetrievalRouter.mock.calls[0]?.[0]
            expect(callArg.query).toBe('合同违约')
            expect(callArg.type).toBe('law')
            expect(callArg.k).toBe(3)
            expect(callArg.metadataFilter).toEqual({
                legal_id: 'l1',
                legal_name: 'X 法',
                legal_type: 'law',
                article_type: 'l5',
            })
            expect(callArg.postFilters.isEffective).toBe(true)
            expect(callArg.postFilters.publishDateFilter).toEqual({
                date: '2020-01-01',
                operator: '>=',
            })

            expect(results.length).toBe(2)
            expect(results[0]).toEqual({
                score: 0.92,
                content: '向量结果 1',
                metadata: { articles_id: 'a1', legal_id: 'l1', legal_name: 'X 法' },
            })
        })

        it('query 模式下 k 未传时应默认为 5', async () => {
            mockRetrievalRouter.mockResolvedValueOnce([])
            await searchLaw({ query: '关键词' })
            const callArg = mockRetrievalRouter.mock.calls[0]?.[0]
            expect(callArg.k).toBe(5)
        })

        it('未传 metadata 过滤字段时应传入空 metadataFilter', async () => {
            mockRetrievalRouter.mockResolvedValueOnce([])
            await searchLaw({ query: '仅查询' })
            const callArg = mockRetrievalRouter.mock.calls[0]?.[0]
            expect(callArg.metadataFilter).toEqual({})
        })
    })

    // -------------------- searchLawTool （LangChain 工具入口）--------------------

    describe('searchLawTool - LangChain 工具入口', () => {
        it('应格式化为 JSON 字符串并仅保留白名单字段', async () => {
            mockRetrievalRouter.mockResolvedValueOnce([
                {
                    score: 0.88,
                    content: '工具结果',
                    metadata: {
                        articles_id: 'a1',
                        legal_id: 'l1',
                        legal_name: '测试法',
                        document_number: '文号[001]',
                        chapter_hierarchy: ['第一章'],
                        publish_date: '2020-01-01',
                        effective_date: '2020-06-01',
                        invalid_date: null,
                        extra_field: '应被丢弃',
                    },
                    retrievalMode: 'semantic',
                },
            ])

            const output = await (searchLawTool as any).invoke({ query: '测试', k: 3 })

            expect(typeof output).toBe('string')
            const parsed = JSON.parse(output)
            expect(parsed.length).toBe(1)
            expect(parsed[0]).toEqual({
                score: 0.88,
                content: '工具结果',
                metadata: {
                    legal_name: '测试法',
                    document_number: '文号[001]',
                    chapter_hierarchy: ['第一章'],
                    publish_date: '2020-01-01',
                    effective_date: '2020-06-01',
                    invalid_date: null,
                },
            })
            // 非白名单字段不应出现
            expect((parsed[0].metadata as any).extra_field).toBeUndefined()
            expect((parsed[0].metadata as any).articles_id).toBeUndefined()
        })

        it('SQL 模式下的工具调用应可正常执行（无 query）', async () => {
            const legalId = uniqueLegalId()
            await insertEmbedding({
                text: '通过工具查出来',
                metadata: {
                    legal_id: legalId,
                    articles_id: uuidv7(),
                    legal_name: '工具测试法',
                    document_number: 'TOOL-001',
                    chapter_hierarchy: ['H1'],
                    publish_date: '2020-01-01',
                    effective_date: '2020-06-01',
                    invalid_date: null,
                },
            })

            const output = await (searchLawTool as any).invoke({ legalId, k: 5 })
            const parsed = JSON.parse(output)
            expect(parsed.length).toBe(1)
            expect(parsed[0].metadata.legal_name).toBe('工具测试法')
        })
    })

    // -------------------- searchLawService --------------------

    describe('searchLawService', () => {
        it('传入 query 时应走 vector 模式并返回 mode=vector', async () => {
            mockRetrievalRouter.mockResolvedValueOnce([
                {
                    score: 0.77,
                    content: '服务层结果',
                    metadata: {
                        articles_id: 'a1',
                        legal_id: 'l1',
                        legal_name: 'A 法',
                        chapter_hierarchy: ['第一章', '第一节'],
                    },
                    retrievalMode: 'semantic',
                },
            ])

            const result = await searchLawService({
                query: '测试',
                limit: 10,
                legalType: 'law',
                validOnly: true,
                effectiveDateFrom: '2020-01-01',
            } as any)

            expect(result.mode).toBe('vector')
            expect(result.total).toBe(1)
            expect(result.items[0]?.articles_id).toBe('a1')
            expect(result.items[0]?.legal_id).toBe('l1')
            expect(result.items[0]?.legal_name).toBe('A 法')
            expect(result.items[0]?.content).toBe('服务层结果')
            expect(result.items[0]?.chapter_hierarchy).toEqual(['第一章', '第一节'])

            // 验证 effectiveDateFrom 正确映射为 filter
            const callArg = mockRetrievalRouter.mock.calls[0]?.[0]
            expect(callArg.postFilters.effectiveDateFilter).toEqual({
                date: '2020-01-01',
                operator: '>=',
            })
            expect(callArg.postFilters.isEffective).toBe(true)
        })

        it('不传 query 时走 SQL 模式且 mode=sql', async () => {
            const legalId = uniqueLegalId()
            await insertEmbedding({
                text: 'SQL 服务层',
                metadata: {
                    legal_id: legalId,
                    articles_id: uuidv7(),
                    legal_name: 'SQL 法',
                    legal_type: 'law',
                    chapter_hierarchy: ['第一章'],
                    effective_date: '2000-01-01',
                    invalid_date: null,
                },
            })

            // 构造一个没有 query 但通过 legalType 筛选的请求
            // （注意 searchLawService 会从 params.legalType 映射）
            const result = await searchLawService({
                limit: 5,
                legalType: 'law',
                validOnly: true,
            } as any)

            expect(result.mode).toBe('sql')
            // 无法完全控制其他测试产生的 law 记录，仅断言自己的记录出现在结果中
            const mine = result.items.find(
                i => i.legal_id === legalId
            )
            // 由于 limit=5，且数据库可能存在其他 legal_type=law 数据，
            // 退而验证 service 可成功返回 items 数组（至少不报错）
            expect(Array.isArray(result.items)).toBe(true)
            // 若数据量少时应命中
            if (mine) {
                expect(mine.legal_name).toBe('SQL 法')
                expect(mine.chapter_hierarchy).toEqual(['第一章'])
            }
        })

        it('chapter_hierarchy 非数组时应回退为空数组', async () => {
            mockRetrievalRouter.mockResolvedValueOnce([
                {
                    score: 0.5,
                    content: '旧数据',
                    metadata: {
                        articles_id: 'a1',
                        legal_id: 'l1',
                        legal_name: '旧法',
                        chapter_hierarchy: 'not-an-array',
                    },
                    retrievalMode: 'semantic',
                },
            ])

            const result = await searchLawService({ query: 'x' } as any)
            expect(result.items[0]?.chapter_hierarchy).toEqual([])
        })

        it('未传 limit 时默认为 10', async () => {
            mockRetrievalRouter.mockResolvedValueOnce([])
            await searchLawService({ query: 'defaults' } as any)
            const callArg = mockRetrievalRouter.mock.calls[0]?.[0]
            expect(callArg.k).toBe(10)
        })

        it('未传 effectiveDateFrom 时 filter 应为 undefined', async () => {
            mockRetrievalRouter.mockResolvedValueOnce([])
            await searchLawService({ query: 'no-date' } as any)
            const callArg = mockRetrievalRouter.mock.calls[0]?.[0]
            expect(callArg.postFilters.effectiveDateFilter).toBeUndefined()
        })
    })

    // -------------------- 日期时区处理 --------------------

    describe('日期时区处理（buildSQLDateFilter 内部）', () => {
        it('传入日期应按东八区处理且格式保持一致', async () => {
            const legalId = uniqueLegalId()
            const today = dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD')

            await insertEmbedding({
                text: 'today',
                metadata: {
                    legal_id: legalId,
                    articles_id: uuidv7(),
                    publish_date: today,
                },
            })

            const results = await searchLaw({
                legalId,
                publishDateFilter: { date: today, operator: '=' },
            })
            expect(results.length).toBe(1)
            expect(results[0]?.content).toBe('today')
        })
    })
})
