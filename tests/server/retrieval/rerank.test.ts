/**
 * Rerank 精排服务单元测试
 *
 * **Feature: retrieval**
 * **Validates: Requirements rerank-service**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
    getRerankConfigWithFallbackService: vi.fn(),
    fetch: vi.fn(),
}))

vi.mock('../../../server/services/model/modelConfig.service', () => ({
    getRerankConfigWithFallbackService: mocks.getRerankConfigWithFallbackService,
}))

vi.stubGlobal('fetch', mocks.fetch)

import { rerankService, rerankAndFilterService } from '../../../server/services/retrieval/rerank.service'
import type { SearchResultItem } from '../../../server/services/retrieval/types'

/** 构造测试用 SearchResultItem */
const makeItem = (content: string, score = 0.5): SearchResultItem => ({
    content,
    score,
    metadata: { legal_id: content },
})

describe('rerankService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('标准扁平格式（通用供应商）', () => {
        const STANDARD_CONFIG = {
            apiKey: 'sk-test',
            baseUrl: 'https://api.siliconflow.cn/v1/rerank',
            model: 'BAAI/bge-reranker-v2-m3',
            source: 'database' as const,
        }

        it('使用扁平请求体和 results 响应', async () => {
            mocks.getRerankConfigWithFallbackService.mockResolvedValue(STANDARD_CONFIG)
            const mockResults = [{ index: 0, relevance_score: 0.95 }]
            mocks.fetch.mockResolvedValue({
                ok: true,
                json: async () => ({ results: mockResults }),
            })

            const result = await rerankService('劳动合同', ['文档A'], 1)

            expect(result).toEqual(mockResults)

            const [url, options] = mocks.fetch.mock.calls[0]
            expect(url).toBe('https://api.siliconflow.cn/v1/rerank')

            const body = JSON.parse(options.body)
            expect(body.query).toBe('劳动合同')
            expect(body.documents).toEqual(['文档A'])
            expect(body.top_n).toBe(1)
            expect(body.input).toBeUndefined()
            expect(body.parameters).toBeUndefined()
        })

        it('阿里云 compatible API 同样使用扁平格式', async () => {
            mocks.getRerankConfigWithFallbackService.mockResolvedValue({
                ...STANDARD_CONFIG,
                baseUrl: 'https://dashscope.aliyuncs.com/compatible-api/v1/reranks',
                model: 'qwen3-rerank',
            })
            mocks.fetch.mockResolvedValue({
                ok: true,
                json: async () => ({ results: [{ index: 0, relevance_score: 0.9 }] }),
            })

            await rerankService('查询', ['文档'], 1)

            const [url, options] = mocks.fetch.mock.calls[0]
            expect(url).toBe('https://dashscope.aliyuncs.com/compatible-api/v1/reranks')
            const body = JSON.parse(options.body)
            expect(body.query).toBe('查询')
            expect(body.input).toBeUndefined()
        })
    })

    describe('DashScope 原生格式（gte-rerank-v2）', () => {
        const DASHSCOPE_CONFIG = {
            apiKey: 'sk-dashscope',
            baseUrl: 'https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank',
            model: 'gte-rerank-v2',
            source: 'environment' as const,
        }

        it('URL 包含 /api/v1/services/ 时自动使用嵌套格式', async () => {
            mocks.getRerankConfigWithFallbackService.mockResolvedValue(DASHSCOPE_CONFIG)
            const mockResults = [
                { index: 0, relevance_score: 0.9 },
                { index: 1, relevance_score: 0.7 },
            ]
            mocks.fetch.mockResolvedValue({
                ok: true,
                json: async () => ({ output: { results: mockResults } }),
            })

            const result = await rerankService('合同违约', ['文档A', '文档B'], 2)

            expect(result).toEqual(mockResults)

            const [url, options] = mocks.fetch.mock.calls[0]
            expect(url).toBe(DASHSCOPE_CONFIG.baseUrl)

            const body = JSON.parse(options.body)
            expect(body.input.query).toBe('合同违约')
            expect(body.input.documents).toEqual(['文档A', '文档B'])
            expect(body.parameters.top_n).toBe(2)
            expect(options.headers['Authorization']).toBe('Bearer sk-dashscope')
        })
    })

    it('使用自定义模型名称时覆盖配置中的模型', async () => {
        mocks.getRerankConfigWithFallbackService.mockResolvedValue({
            apiKey: 'sk-test',
            baseUrl: 'https://api.jina.ai/v1/rerank',
            model: 'jina-reranker-v2',
            source: 'database' as const,
        })
        mocks.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ results: [{ index: 0, relevance_score: 0.8 }] }),
        })

        await rerankService('查询', ['文档'], 1, 'custom-model')

        const [, options] = mocks.fetch.mock.calls[0]
        const body = JSON.parse(options.body)
        expect(body.model).toBe('custom-model')
    })

    it('API 超时时抛出 AbortError', async () => {
        mocks.getRerankConfigWithFallbackService.mockResolvedValue({
            apiKey: 'sk-test',
            baseUrl: 'https://api.example.com/v1/rerank',
            model: 'test',
            source: 'database' as const,
        })
        mocks.fetch.mockImplementation((_url: string, options: RequestInit) => {
            return new Promise((_resolve, reject) => {
                options.signal?.addEventListener('abort', () => {
                    reject(new DOMException('The operation was aborted.', 'AbortError'))
                })
            })
        })

        await expect(rerankService('查询', ['文档'], 1)).rejects.toThrow()
    }, 10000)

    it('API 返回非 2xx 时抛出 Error', async () => {
        mocks.getRerankConfigWithFallbackService.mockResolvedValue({
            apiKey: 'sk-test',
            baseUrl: 'https://api.example.com/v1/rerank',
            model: 'test',
            source: 'database' as const,
        })
        mocks.fetch.mockResolvedValue({ ok: false, status: 400, statusText: 'Bad Request' })

        await expect(rerankService('查询', ['文档'], 1)).rejects.toThrow('Rerank API 错误: 400 Bad Request')
    })

    it('响应缺少 results 字段时抛出格式异常错误', async () => {
        mocks.getRerankConfigWithFallbackService.mockResolvedValue({
            apiKey: 'sk-test',
            baseUrl: 'https://api.example.com/v1/rerank',
            model: 'test',
            source: 'database' as const,
        })
        mocks.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ unexpected: 'format' }),
        })

        await expect(rerankService('查询', ['文档'], 1)).rejects.toThrow('Rerank API 响应格式异常')
    })
})

describe('rerankAndFilterService', () => {
    const CONFIG = {
        apiKey: 'sk-test',
        baseUrl: 'https://api.example.com/v1/rerank',
        model: 'rerank-model',
        source: 'database' as const,
    }

    beforeEach(() => {
        vi.clearAllMocks()
        mocks.getRerankConfigWithFallbackService.mockResolvedValue(CONFIG)
        delete process.env.NUXT_LAW_RERANK_THRESHOLD
        delete process.env.NUXT_MATERIAL_RERANK_THRESHOLD
    })

    it('空结果列表时直接返回空数组', async () => {
        const result = await rerankAndFilterService('查询', [], 5, 'law')
        expect(result).toEqual([])
        expect(mocks.fetch).not.toHaveBeenCalled()
    })

    it('正常 rerank 后按 relevance_score 过滤并映射原始结果', async () => {
        const items = [makeItem('条文A', 0.3), makeItem('条文B', 0.3), makeItem('条文C', 0.3)]

        mocks.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                results: [
                    { index: 0, relevance_score: 0.9 },
                    { index: 2, relevance_score: 0.5 },
                    { index: 1, relevance_score: 0.4 },
                ],
            }),
        })

        const result = await rerankAndFilterService('查询', items, 3, 'law')

        expect(result).toHaveLength(3)
        expect(result[0].content).toBe('条文A')
        expect(result[0].score).toBe(0.9)
        expect(result[1].content).toBe('条文C')
        expect(result[1].score).toBe(0.5)
        expect(result[2].content).toBe('条文B')
        expect(result[2].score).toBe(0.4)
    })

    it('阈值过滤：低于阈值的结果被过滤掉', async () => {
        process.env.NUXT_LAW_RERANK_THRESHOLD = '0.5'
        const items = [makeItem('条文A'), makeItem('条文B'), makeItem('条文C')]

        mocks.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                results: [
                    { index: 0, relevance_score: 0.8 },
                    { index: 1, relevance_score: 0.3 },
                    { index: 2, relevance_score: 0.6 },
                ],
            }),
        })

        const result = await rerankAndFilterService('查询', items, 3, 'law')

        expect(result).toHaveLength(2)
        expect(result[0].content).toBe('条文A')
        expect(result[1].content).toBe('条文C')
    })

    it('材料类型使用独立阈值（默认 0.2）', async () => {
        const items = [makeItem('材料A'), makeItem('材料B')]

        mocks.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                results: [
                    { index: 0, relevance_score: 0.25 },
                    { index: 1, relevance_score: 0.15 },
                ],
            }),
        })

        const result = await rerankAndFilterService('查询', items, 2, 'case_material')

        expect(result).toHaveLength(1)
        expect(result[0].content).toBe('材料A')
    })

    it('API 失败时降级返回原始结果前 k 条', async () => {
        const items = [makeItem('条文A'), makeItem('条文B'), makeItem('条文C'), makeItem('条文D')]
        mocks.fetch.mockRejectedValue(new Error('网络连接失败'))

        const result = await rerankAndFilterService('查询', items, 2, 'law')

        expect(result).toHaveLength(2)
        expect(result[0].content).toBe('条文A')
        expect(result[1].content).toBe('条文B')
    })

    it('输入超过 20 条时只取前 20 条参与 rerank', async () => {
        const items = Array.from({ length: 25 }, (_, i) => makeItem(`条文${i}`))

        mocks.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                results: [{ index: 0, relevance_score: 0.9 }],
            }),
        })

        await rerankAndFilterService('查询', items, 5, 'law')

        const [, options] = mocks.fetch.mock.calls[0]
        const body = JSON.parse(options.body)
        expect(body.documents).toHaveLength(20)
        expect(body.documents[0]).toBe('条文0')
        expect(body.documents[19]).toBe('条文19')
    })
})
