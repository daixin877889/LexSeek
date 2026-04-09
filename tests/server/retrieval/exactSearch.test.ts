/**
 * 精确检索通道单元测试
 *
 * **Feature: retrieval**
 * **Validates: Requirements exactSearch**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IntentClassification } from '../../../server/services/retrieval/types'

// Mock prisma（Nuxt 自动导入全局变量）
const mockLegalMainFindFirst = vi.fn()
const mockLegalArticlesFindMany = vi.fn()

vi.stubGlobal('prisma', {
    legalMain: { findFirst: (...args: any[]) => mockLegalMainFindFirst(...args) },
    legalArticles: { findMany: (...args: any[]) => mockLegalArticlesFindMany(...args) },
})

// 在 mock 之后导入被测模块
import { exactSearchService } from '../../../server/services/retrieval/exactSearch.service'

/** 构造测试用法律记录 */
const makeLegal = (overrides = {}) => ({
    id: 'legal-001',
    name: '中华人民共和国民法典',
    code: 'MFDIAN',
    type: 'law',
    documentNumber: '主席令第45号',
    publishDate: new Date('2020-05-28'),
    effectiveDate: new Date('2021-01-01'),
    invalidDate: null,
    ...overrides,
})

/** 构造测试用条文记录 */
const makeArticle = (overrides = {}) => ({
    id: 'article-001',
    legalId: 'legal-001',
    type: 'l5',
    l1: '第一编',
    l1I: 1,
    l2: null,
    l2I: null,
    l3: '第一章',
    l3I: 1,
    l4: null,
    l4I: null,
    l5: '第一条',
    l5I: 1,
    order: 10,
    content: '中华人民共和国民法典第一条内容',
    publishDate: null,
    effectiveDate: null,
    invalidDate: null,
    deletedAt: null,
    ...overrides,
})


describe('exactSearchService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('法律名称匹配', () => {
        it('精确匹配法律名称时返回条文结果', async () => {
            const legal = makeLegal()
            const article = makeArticle()

            mockLegalMainFindFirst.mockResolvedValue(legal)
            // 第一次调用：命中条文；第二次调用：上下文扩展
            mockLegalArticlesFindMany
                .mockResolvedValueOnce([article])
                .mockResolvedValueOnce([article])

            const intent: IntentClassification = {
                intent: 'exact',
                legalName: '中华人民共和国民法典',
                articleRef: '第一条',
            }

            const results = await exactSearchService(intent)

            expect(results).toHaveLength(1)
            expect(results[0].score).toBe(1.0)
            expect(results[0].retrievalMode).toBe('exact')
            expect(results[0].content).toBe('中华人民共和国民法典第一条内容')
        })

        it('包含匹配时 "民法典" 可匹配到 "中华人民共和国民法典"', async () => {
            const legal = makeLegal()
            const article = makeArticle()

            // 精确匹配无命中，包含匹配命中
            mockLegalMainFindFirst
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(legal)
            mockLegalArticlesFindMany
                .mockResolvedValueOnce([article])
                .mockResolvedValueOnce([article])

            const intent: IntentClassification = {
                intent: 'exact',
                legalName: '民法典',
                articleRef: '第一条',
            }

            const results = await exactSearchService(intent)

            expect(results).toHaveLength(1)
            // 第一次调用：精确匹配
            expect(mockLegalMainFindFirst.mock.calls[0][0].where.name).toBe('民法典')
            // 第二次调用：包含匹配，按名称升序
            const secondCall = mockLegalMainFindFirst.mock.calls[1][0]
            expect(secondCall.where.name).toEqual({ contains: '民法典' })
            expect(secondCall.orderBy).toEqual({ name: 'asc' })
        })
    })

    describe('上下文扩展', () => {
        it('命中 1 条时扩展前后各 2 条', async () => {
            const legal = makeLegal()
            const hitArticle = makeArticle({ id: 'article-003', order: 10 })
            const contextArticles = [
                makeArticle({ id: 'article-001', order: 8 }),
                makeArticle({ id: 'article-002', order: 9 }),
                makeArticle({ id: 'article-003', order: 10 }),
                makeArticle({ id: 'article-004', order: 11 }),
                makeArticle({ id: 'article-005', order: 12 }),
            ]

            mockLegalMainFindFirst.mockResolvedValue(legal)
            // 命中条文
            mockLegalArticlesFindMany.mockResolvedValueOnce([hitArticle])
            // 上下文扩展返回 5 条
            mockLegalArticlesFindMany.mockResolvedValueOnce(contextArticles)

            const intent: IntentClassification = {
                intent: 'exact',
                legalName: '民法典',
                articleRef: '第三条',
            }

            const results = await exactSearchService(intent)

            expect(results).toHaveLength(5)
            // 验证上下文扩展查询传入了正确的 order 范围
            const expandCall = mockLegalArticlesFindMany.mock.calls[1][0]
            expect(expandCall.where.order).toEqual({ gte: 8, lte: 12 })
        })

        it('上下文扩展时传入同 l1 层级约束', async () => {
            const legal = makeLegal()
            const hitArticle = makeArticle({ l1: '第一编', order: 10 })

            mockLegalMainFindFirst.mockResolvedValue(legal)
            mockLegalArticlesFindMany.mockResolvedValueOnce([hitArticle])
            mockLegalArticlesFindMany.mockResolvedValueOnce([hitArticle])

            const intent: IntentClassification = {
                intent: 'exact',
                legalName: '民法典',
                articleRef: '第一条',
            }

            await exactSearchService(intent)

            const expandCall = mockLegalArticlesFindMany.mock.calls[1][0]
            expect(expandCall.where.l1).toBe('第一编')
        })
    })

    describe('无命中场景', () => {
        it('未找到法律时返回空数组', async () => {
            mockLegalMainFindFirst.mockResolvedValue(null)

            const intent: IntentClassification = {
                intent: 'exact',
                legalName: '不存在的法律',
                articleRef: '第一条',
            }

            const results = await exactSearchService(intent)

            expect(results).toEqual([])
            expect(mockLegalArticlesFindMany).not.toHaveBeenCalled()
        })

        it('找到法律但无命中条文时返回空数组', async () => {
            mockLegalMainFindFirst.mockResolvedValue(makeLegal())
            mockLegalArticlesFindMany.mockResolvedValue([])

            const intent: IntentClassification = {
                intent: 'exact',
                legalName: '民法典',
                articleRef: '第九百九十九条',
            }

            const results = await exactSearchService(intent)

            expect(results).toEqual([])
        })

        it('未提供 legalName 时直接返回空数组', async () => {
            const intent: IntentClassification = { intent: 'exact' }

            const results = await exactSearchService(intent)

            expect(results).toEqual([])
            expect(mockLegalMainFindFirst).not.toHaveBeenCalled()
        })
    })

    describe('返回格式', () => {
        it('返回结果 score=1.0, retrievalMode=exact, metadata 包含必要字段', async () => {
            const legal = makeLegal()
            const article = makeArticle()

            mockLegalMainFindFirst.mockResolvedValue(legal)
            mockLegalArticlesFindMany
                .mockResolvedValueOnce([article])
                .mockResolvedValueOnce([article])

            const intent: IntentClassification = {
                intent: 'exact',
                legalName: '民法典',
                articleRef: '第一条',
            }

            const results = await exactSearchService(intent)

            expect(results).toHaveLength(1)
            const result = results[0]

            expect(result.score).toBe(1.0)
            expect(result.retrievalMode).toBe('exact')
            expect(result.metadata).toMatchObject({
                legal_name: '中华人民共和国民法典',
                document_number: '主席令第45号',
                publish_date: '2020-05-28T00:00:00.000Z',
                effective_date: '2021-01-01T00:00:00.000Z',
                invalid_date: undefined,
                article_type: 'l5',
                articles_id: 'article-001',
                chapter_hierarchy: '第一编 > 第一章 > 第一条',
                retrieval_mode: 'exact',
            })
        })

        it('chapter_hierarchy 过滤 null 值正确拼接层级', async () => {
            const legal = makeLegal()
            // 只有 l3 和 l5，无 l1/l2/l4
            const article = makeArticle({
                l1: null,
                l2: null,
                l3: '总则',
                l4: null,
                l5: '第一条',
            })

            mockLegalMainFindFirst.mockResolvedValue(legal)
            mockLegalArticlesFindMany
                .mockResolvedValueOnce([article])
                .mockResolvedValueOnce([article])

            const intent: IntentClassification = {
                intent: 'exact',
                legalName: '民法典',
                articleRef: '第一条',
            }

            const results = await exactSearchService(intent)

            expect(results[0].metadata.chapter_hierarchy).toBe('总则 > 第一条')
        })
    })

    describe('去重', () => {
        it('多个命中条文的上下文重叠时去重后返回', async () => {
            const legal = makeLegal()
            // 两条命中条文 order=10 和 order=12，上下文会有重叠
            const hitArticle1 = makeArticle({ id: 'article-010', order: 10 })
            const hitArticle2 = makeArticle({ id: 'article-012', order: 12 })
            const context1 = [
                makeArticle({ id: 'article-008', order: 8 }),
                makeArticle({ id: 'article-009', order: 9 }),
                makeArticle({ id: 'article-010', order: 10 }),
                makeArticle({ id: 'article-011', order: 11 }),
                makeArticle({ id: 'article-012', order: 12 }), // 与第二条命中重叠
            ]
            const context2 = [
                makeArticle({ id: 'article-010', order: 10 }), // 与第一条命中重叠
                makeArticle({ id: 'article-011', order: 11 }), // 与第一条上下文重叠
                makeArticle({ id: 'article-012', order: 12 }),
                makeArticle({ id: 'article-013', order: 13 }),
                makeArticle({ id: 'article-014', order: 14 }),
            ]

            mockLegalMainFindFirst.mockResolvedValue(legal)
            // 命中条文
            mockLegalArticlesFindMany.mockResolvedValueOnce([hitArticle1, hitArticle2])
            // 第一条命中的上下文
            mockLegalArticlesFindMany.mockResolvedValueOnce(context1)
            // 第二条命中的上下文
            mockLegalArticlesFindMany.mockResolvedValueOnce(context2)

            const intent: IntentClassification = {
                intent: 'exact',
                legalName: '民法典',
                articleRef: '第十条',
            }

            const results = await exactSearchService(intent)

            // article-008 ~ article-014 共 7 条不重复
            expect(results).toHaveLength(7)
            const ids = results.map(r => r.metadata.articles_id)
            // 无重复
            expect(new Set(ids).size).toBe(7)
        })
    })
})
