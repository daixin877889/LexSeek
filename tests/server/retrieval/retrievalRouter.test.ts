/**
 * 统一检索路由器单元测试
 *
 * **Feature: retrieval**
 * **Validates: Requirements retrievalRouter**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
    IntentClassification,
    RetrievalRequest,
    RetrievalResult,
    SearchResultItem,
} from '../../../server/services/retrieval/types'

// --- Mock 所有依赖服务 ---
const mocks = vi.hoisted(() => ({
    classifyIntentService: vi.fn(),
    exactSearchService: vi.fn(),
    hybridSearchService: vi.fn(),
    semanticSearchService: vi.fn(),
    rerankAndFilterService: vi.fn(),
}))

vi.mock('../../../server/services/retrieval/intentClassifier.service', () => ({
    classifyIntentService: mocks.classifyIntentService,
}))
vi.mock('../../../server/services/retrieval/exactSearch.service', () => ({
    exactSearchService: mocks.exactSearchService,
}))
vi.mock('../../../server/services/retrieval/hybridSearch.service', () => ({
    hybridSearchService: mocks.hybridSearchService,
}))
vi.mock('../../../server/services/retrieval/semanticSearch.service', () => ({
    semanticSearchService: mocks.semanticSearchService,
}))
vi.mock('../../../server/services/retrieval/rerank.service', () => ({
    rerankAndFilterService: mocks.rerankAndFilterService,
}))

// 模拟 Nuxt 自动导入的 logger
vi.stubGlobal('logger', { info: vi.fn(), error: vi.fn(), warn: vi.fn() })

// 在 mock 设置之后导入被测模块
import { retrievalRouterService } from '../../../server/services/retrieval/retrievalRouter.service'
import { applyPostFiltersService, isLawEffective, applyDateFilter } from '../../../server/services/retrieval/postFilter.service'

// --- 测试辅助工厂 ---

function makeRetrievalResult(overrides: Partial<RetrievalResult> = {}): RetrievalResult {
    return {
        content: '默认法律条文内容',
        score: 0.8,
        metadata: {
            legal_name: '中华人民共和国民法典',
            effective_date: '2021-01-01T00:00:00.000Z',
            invalid_date: undefined,
        },
        retrievalMode: 'exact',
        ...overrides,
    }
}

function makeSearchItem(overrides: Partial<SearchResultItem> = {}): SearchResultItem {
    return {
        content: '搜索结果内容',
        score: 0.7,
        metadata: { legal_name: '测试法律' },
        ...overrides,
    }
}

function makeRequest(overrides: Partial<RetrievalRequest> = {}): RetrievalRequest {
    return {
        query: '合同违约的法律规定',
        type: 'law',
        k: 5,
        ...overrides,
    }
}

// --- 测试套件 ---

describe('retrievalRouterService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('intent=exact + 命中', () => {
        it('精确通道有结果时直接返回，不经 Rerank', async () => {
            const exactResults: RetrievalResult[] = [
                makeRetrievalResult({ retrievalMode: 'exact', score: 1.0 }),
                makeRetrievalResult({ retrievalMode: 'exact', score: 1.0, content: '第二条内容' }),
            ]

            mocks.classifyIntentService.mockResolvedValue({
                intent: 'exact',
                legalName: '中华人民共和国民法典',
                articleRef: '第五百七十七条',
            } satisfies IntentClassification)
            mocks.exactSearchService.mockResolvedValue(exactResults)

            const result = await retrievalRouterService(makeRequest())

            expect(mocks.exactSearchService).toHaveBeenCalledOnce()
            expect(mocks.rerankAndFilterService).not.toHaveBeenCalled()
            expect(result).toEqual(exactResults)
        })
    })

    describe('intent=exact + 未命中降级', () => {
        it('精确通道无结果时降级到 hybrid，并经 Rerank', async () => {
            const hybridSearchItems: SearchResultItem[] = [
                makeSearchItem({ content: '民法典违约条款', score: 0.75 }),
            ]
            const rerankedItems: SearchResultItem[] = [
                makeSearchItem({ content: '民法典违约条款', score: 0.9 }),
            ]

            mocks.classifyIntentService.mockResolvedValue({
                intent: 'exact',
                legalName: '民法典',
                articleRef: '第五条',
            } satisfies IntentClassification)
            mocks.exactSearchService.mockResolvedValue([])
            mocks.hybridSearchService.mockResolvedValue(hybridSearchItems)
            mocks.rerankAndFilterService.mockResolvedValue(rerankedItems)

            const result = await retrievalRouterService(makeRequest())

            expect(mocks.exactSearchService).toHaveBeenCalledOnce()
            expect(mocks.hybridSearchService).toHaveBeenCalledOnce()
            expect(mocks.rerankAndFilterService).toHaveBeenCalledOnce()
            // 验证降级后 retrievalMode 为 hybrid
            expect(result[0].retrievalMode).toBe('hybrid')
        })

        it('降级时 fallbackIntent 包含原意图的 legalName 和 articleRef 作为 keywords', async () => {
            mocks.classifyIntentService.mockResolvedValue({
                intent: 'exact',
                legalName: '公司法',
                articleRef: '第三条',
                keywords: undefined,
            } satisfies IntentClassification)
            mocks.exactSearchService.mockResolvedValue([])
            mocks.hybridSearchService.mockResolvedValue([makeSearchItem()])
            mocks.rerankAndFilterService.mockResolvedValue([makeSearchItem()])

            await retrievalRouterService(makeRequest())

            const fallbackIntentArg = mocks.hybridSearchService.mock.calls[0][0] as IntentClassification
            expect(fallbackIntentArg.intent).toBe('hybrid')
            expect(fallbackIntentArg.keywords).toContain('公司法')
            expect(fallbackIntentArg.keywords).toContain('第三条')
        })
    })

    describe('intent=hybrid', () => {
        it('混合检索通道调用 hybridSearch + Rerank，retrievalMode=hybrid', async () => {
            const hybridItems: SearchResultItem[] = [
                makeSearchItem({ content: '劳动法相关规定', score: 0.8 }),
                makeSearchItem({ content: '劳动合同解除条件', score: 0.75 }),
            ]
            const rerankedItems: SearchResultItem[] = [hybridItems[0]]

            mocks.classifyIntentService.mockResolvedValue({
                intent: 'hybrid',
                keywords: ['劳动', '合同', '解除'],
                rewrittenQuery: '劳动合同解除的法律规定',
            } satisfies IntentClassification)
            mocks.hybridSearchService.mockResolvedValue(hybridItems)
            mocks.rerankAndFilterService.mockResolvedValue(rerankedItems)

            const result = await retrievalRouterService(makeRequest())

            expect(mocks.exactSearchService).not.toHaveBeenCalled()
            expect(mocks.hybridSearchService).toHaveBeenCalledOnce()
            expect(mocks.rerankAndFilterService).toHaveBeenCalledOnce()
            expect(result[0].retrievalMode).toBe('hybrid')
        })
    })

    describe('intent=semantic', () => {
        it('语义检索通道调用 semanticSearch + Rerank，retrievalMode=semantic', async () => {
            const semanticItems: SearchResultItem[] = [
                makeSearchItem({ content: '侵权责任法条文', score: 0.85 }),
            ]

            mocks.classifyIntentService.mockResolvedValue({
                intent: 'semantic',
                rewrittenQuery: '侵权赔偿的法律依据',
            } satisfies IntentClassification)
            mocks.semanticSearchService.mockResolvedValue(semanticItems)
            mocks.rerankAndFilterService.mockResolvedValue(semanticItems)

            const result = await retrievalRouterService(makeRequest())

            expect(mocks.exactSearchService).not.toHaveBeenCalled()
            expect(mocks.hybridSearchService).not.toHaveBeenCalled()
            expect(mocks.semanticSearchService).toHaveBeenCalledOnce()
            expect(mocks.rerankAndFilterService).toHaveBeenCalledOnce()
            expect(result[0].retrievalMode).toBe('semantic')
        })
    })

    describe('postFilters.isEffective=true', () => {
        it('过滤掉无效法律（已失效）', async () => {
            // 两条精确结果：一条有效，一条已失效
            const validResult = makeRetrievalResult({
                metadata: {
                    legal_name: '有效法律',
                    effective_date: '2020-01-01T00:00:00.000Z',
                    invalid_date: undefined,
                },
                retrievalMode: 'exact',
            })
            const invalidResult = makeRetrievalResult({
                metadata: {
                    legal_name: '已失效法律',
                    effective_date: '2015-01-01T00:00:00.000Z',
                    invalid_date: '2019-01-01T00:00:00.000Z', // 已失效
                },
                retrievalMode: 'exact',
            })

            mocks.classifyIntentService.mockResolvedValue({
                intent: 'exact',
                legalName: '民法典',
                articleRef: '第一条',
            } satisfies IntentClassification)
            mocks.exactSearchService.mockResolvedValue([validResult, invalidResult])

            const result = await retrievalRouterService(makeRequest({
                postFilters: { isEffective: true },
            }))

            expect(result).toHaveLength(1)
            expect(result[0].metadata.legal_name).toBe('有效法律')
        })
    })

    describe('结果截取 top-k', () => {
        it('结果数量超过 k 时只返回前 k 条', async () => {
            const manyResults: RetrievalResult[] = Array.from({ length: 10 }, (_, i) =>
                makeRetrievalResult({ content: `条文${i + 1}`, score: 1 - i * 0.05, retrievalMode: 'exact' }),
            )

            mocks.classifyIntentService.mockResolvedValue({
                intent: 'exact',
                legalName: '民法典',
            } satisfies IntentClassification)
            mocks.exactSearchService.mockResolvedValue(manyResults)

            const result = await retrievalRouterService(makeRequest({ k: 3 }))

            expect(result).toHaveLength(3)
            expect(result[0].content).toBe('条文1')
        })

        it('结果数量不足 k 时返回全部结果', async () => {
            const fewResults: RetrievalResult[] = [
                makeRetrievalResult({ content: '唯一结果', retrievalMode: 'exact' }),
            ]

            mocks.classifyIntentService.mockResolvedValue({
                intent: 'exact',
                legalName: '某法律',
            } satisfies IntentClassification)
            mocks.exactSearchService.mockResolvedValue(fewResults)

            const result = await retrievalRouterService(makeRequest({ k: 5 }))

            expect(result).toHaveLength(1)
        })
    })

    describe('Rerank 参数传递', () => {
        it('Rerank 调用时传入 query、k 和 type', async () => {
            const items: SearchResultItem[] = [makeSearchItem()]
            mocks.classifyIntentService.mockResolvedValue({
                intent: 'hybrid',
                keywords: ['测试'],
            } satisfies IntentClassification)
            mocks.hybridSearchService.mockResolvedValue(items)
            mocks.rerankAndFilterService.mockResolvedValue(items)

            const request = makeRequest({ query: '测试查询', k: 7, type: 'case_material' })
            await retrievalRouterService(request)

            expect(mocks.rerankAndFilterService).toHaveBeenCalledWith(
                '测试查询',
                expect.any(Array),
                7,
                'case_material',
            )
        })
    })
})

// --- postFilter.service 单元测试 ---

describe('isLawEffective', () => {
    it('无生效日期无失效日期时返回 true', () => {
        expect(isLawEffective(undefined, undefined)).toBe(true)
    })

    it('生效日期在过去，无失效日期时返回 true（有效）', () => {
        expect(isLawEffective('2000-01-01', undefined)).toBe(true)
    })

    it('生效日期在未来时返回 false（未生效）', () => {
        expect(isLawEffective('2099-01-01', undefined)).toBe(false)
    })

    it('失效日期在过去时返回 false（已失效）', () => {
        expect(isLawEffective('2000-01-01', '2010-01-01')).toBe(false)
    })

    it('失效日期在未来时返回 true（仍有效）', () => {
        expect(isLawEffective('2000-01-01', '2099-01-01')).toBe(true)
    })

    it('失效日期为空字符串时忽略失效判断，返回 true', () => {
        expect(isLawEffective('2000-01-01', '')).toBe(true)
    })

    it('生效日期格式无效时返回 false', () => {
        expect(isLawEffective('not-a-date', undefined)).toBe(false)
    })
})

describe('applyDateFilter', () => {
    const makeResult = (effectiveDate: string | undefined): RetrievalResult => ({
        content: '内容',
        score: 1,
        metadata: { effective_date: effectiveDate },
        retrievalMode: 'semantic',
    })

    it('operator= > 时过滤掉早于目标日期的结果', () => {
        const results = [
            makeResult('2022-01-01T00:00:00.000Z'),
            makeResult('2024-01-01T00:00:00.000Z'),
        ]
        const filtered = applyDateFilter(results, {
            effective_date: { date: '2023-01-01', operator: '>' },
        })
        expect(filtered).toHaveLength(1)
        expect(filtered[0].metadata.effective_date).toBe('2024-01-01T00:00:00.000Z')
    })

    it('operator= < 时过滤掉晚于目标日期的结果', () => {
        const results = [
            makeResult('2020-01-01T00:00:00.000Z'),
            makeResult('2025-01-01T00:00:00.000Z'),
        ]
        const filtered = applyDateFilter(results, {
            effective_date: { date: '2023-06-01', operator: '<' },
        })
        expect(filtered).toHaveLength(1)
        expect(filtered[0].metadata.effective_date).toBe('2020-01-01T00:00:00.000Z')
    })

    it('metadata 字段不存在时过滤掉该结果', () => {
        const results = [
            { content: '有日期', score: 1, metadata: { effective_date: '2022-01-01' }, retrievalMode: 'semantic' as const },
            { content: '无日期', score: 1, metadata: {}, retrievalMode: 'semantic' as const },
        ]
        const filtered = applyDateFilter(results, {
            effective_date: { date: '2020-01-01', operator: '>' },
        })
        expect(filtered).toHaveLength(1)
        expect(filtered[0].content).toBe('有日期')
    })

    it('dateFilter 为 undefined 时跳过该字段过滤', () => {
        const results = [makeResult('2022-01-01T00:00:00.000Z')]
        const filtered = applyDateFilter(results, { effective_date: undefined })
        expect(filtered).toHaveLength(1)
    })
})

describe('applyPostFiltersService', () => {
    it('无 postFilters 时原样返回结果', () => {
        const results = [makeRetrievalResult()]
        expect(applyPostFiltersService(results, undefined)).toEqual(results)
    })

    it('isEffective=true 时过滤已失效的条目', () => {
        const results: RetrievalResult[] = [
            makeRetrievalResult({
                metadata: { effective_date: '2020-01-01', invalid_date: undefined },
            }),
            makeRetrievalResult({
                metadata: { effective_date: '2015-01-01', invalid_date: '2019-01-01' },
            }),
        ]
        const filtered = applyPostFiltersService(results, { isEffective: true })
        expect(filtered).toHaveLength(1)
        expect(filtered[0].metadata.effective_date).toBe('2020-01-01')
    })

    it('publishDateFilter 正确传入 publish_date 字段', () => {
        const results: RetrievalResult[] = [
            makeRetrievalResult({ metadata: { publish_date: '2022-06-01' } }),
            makeRetrievalResult({ metadata: { publish_date: '2019-01-01' } }),
        ]
        const filtered = applyPostFiltersService(results, {
            publishDateFilter: { date: '2021-01-01', operator: '>=' },
        })
        expect(filtered).toHaveLength(1)
        expect(filtered[0].metadata.publish_date).toBe('2022-06-01')
    })

    it('多个 postFilter 条件同时生效（取交集）', () => {
        const results: RetrievalResult[] = [
            // 有效且发布日期满足条件
            makeRetrievalResult({
                metadata: { effective_date: '2020-01-01', invalid_date: undefined, publish_date: '2022-01-01' },
            }),
            // 有效但发布日期不满足条件
            makeRetrievalResult({
                metadata: { effective_date: '2020-01-01', invalid_date: undefined, publish_date: '2018-01-01' },
            }),
            // 已失效，发布日期满足
            makeRetrievalResult({
                metadata: { effective_date: '2015-01-01', invalid_date: '2019-01-01', publish_date: '2022-01-01' },
            }),
        ]
        const filtered = applyPostFiltersService(results, {
            isEffective: true,
            publishDateFilter: { date: '2020-01-01', operator: '>=' },
        })
        expect(filtered).toHaveLength(1)
        expect(filtered[0].metadata.publish_date).toBe('2022-01-01')
    })
})
