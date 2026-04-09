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

// 在 mock 设置之后导入被测模块
import { rerankService, rerankAndFilterService } from '../../../server/services/retrieval/rerank.service'
import type { SearchResultItem } from '../../../server/services/retrieval/types'

/** 测试用 Rerank 配置 */
const TEST_CONFIG = {
    apiKey: 'sk-test-rerank-key',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode',
    model: 'gte-rerank-v2',
    source: 'environment' as const,
}

/** 构造测试用 SearchResultItem */
const makeItem = (content: string, score = 0.5): SearchResultItem => ({
    content,
    score,
    metadata: { legal_id: content },
})

describe('rerankService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.getRerankConfigWithFallbackService.mockResolvedValue(TEST_CONFIG)
    })

    it('正常调用时返回精排结果', async () => {
        const mockResults = [
            { index: 0, relevance_score: 0.9 },
            { index: 1, relevance_score: 0.7 },
        ]
        mocks.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ results: mockResults }),
        })

        const result = await rerankService('合同违约', ['文档A', '文档B'], 2)

        expect(result).toEqual(mockResults)
        expect(mocks.fetch).toHaveBeenCalledOnce()

        // 验证请求参数
        const [url, options] = mocks.fetch.mock.calls[0]
        expect(url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/rerank')
        const body = JSON.parse(options.body)
        expect(body.query).toBe('合同违约')
        expect(body.documents).toEqual(['文档A', '文档B'])
        expect(body.top_n).toBe(2)
        expect(body.model).toBe('gte-rerank-v2')
        expect(options.headers['Authorization']).toBe('Bearer sk-test-rerank-key')
    })

    it('使用自定义模型名称时覆盖配置中的模型', async () => {
        mocks.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ results: [{ index: 0, relevance_score: 0.8 }] }),
        })

        await rerankService('查询', ['文档'], 1, 'custom-rerank-model')

        const [, options] = mocks.fetch.mock.calls[0]
        const body = JSON.parse(options.body)
        expect(body.model).toBe('custom-rerank-model')
    })

    it('API 超时时抛出 AbortError', async () => {
        mocks.fetch.mockImplementation((_url: string, options: RequestInit) => {
            return new Promise((_resolve, reject) => {
                options.signal?.addEventListener('abort', () => {
                    reject(new DOMException('The operation was aborted.', 'AbortError'))
                })
            })
        })

        await expect(rerankService('查询', ['文档'], 1)).rejects.toThrow()
    }, 10000)

    it('API 返回 400 错误时抛出 Error', async () => {
        mocks.fetch.mockResolvedValue({
            ok: false,
            status: 400,
            statusText: 'Bad Request',
        })

        await expect(rerankService('查询', ['文档'], 1)).rejects.toThrow(
            'Rerank API 错误: 400 Bad Request',
        )
    })

    it('API 返回 500 错误时抛出 Error', async () => {
        mocks.fetch.mockResolvedValue({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
        })

        await expect(rerankService('查询', ['文档'], 1)).rejects.toThrow('Rerank API 错误: 500')
    })
})

describe('rerankAndFilterService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.getRerankConfigWithFallbackService.mockResolvedValue(TEST_CONFIG)
        // 重置阈值环境变量
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

        // 默认法律阈值 0.3，全部通过
        expect(result).toHaveLength(3)
        // 结果按 rerank 顺序返回，score 替换为 relevance_score
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

        // 降级：返回前 k 条原始结果
        expect(result).toHaveLength(2)
        expect(result[0].content).toBe('条文A')
        expect(result[1].content).toBe('条文B')
    })

    it('输入超过 20 条时只取前 20 条参与 rerank', async () => {
        // 构造 25 条数据
        const items = Array.from({ length: 25 }, (_, i) => makeItem(`条文${i}`))

        mocks.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                results: [{ index: 0, relevance_score: 0.9 }],
            }),
        })

        await rerankAndFilterService('查询', items, 5, 'law')

        // 验证传给 API 的文档只有 20 条
        const [, options] = mocks.fetch.mock.calls[0]
        const body = JSON.parse(options.body)
        expect(body.documents).toHaveLength(20)
        // 确认是前 20 条
        expect(body.documents[0]).toBe('条文0')
        expect(body.documents[19]).toBe('条文19')
    })
})
