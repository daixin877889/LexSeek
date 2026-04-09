/**
 * 混合检索服务单元测试
 *
 * **Feature: retrieval**
 * **Validates: Requirements hybridSearch**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
    extractDocId,
    reciprocalRankFusion,
    vectorSearchService,
    hybridSearchService,
} from '../../../server/services/retrieval/hybridSearch.service'
import type { SearchResultItem } from '../../../server/services/retrieval/types'

// Mock vectorStore.service
vi.mock('../../../server/services/legal/vectorStore.service', () => ({
    getPool: vi.fn(),
    getEmbeddingsAsync: vi.fn(),
}))

// Mock fullTextSearch.service
vi.mock('../../../server/services/retrieval/fullTextSearch.service', () => ({
    buildParameterizedMetadataFilter: vi.fn(() => ({ filterSQL: '', filterParams: [] })),
    buildSourceIdsFilter: vi.fn(() => ({ filterSQL: '', filterParams: [] })),
    fullTextSearchService: vi.fn(),
}))

import { getPool, getEmbeddingsAsync } from '../../../server/services/legal/vectorStore.service'
import { buildParameterizedMetadataFilter, buildSourceIdsFilter, fullTextSearchService } from '../../../server/services/retrieval/fullTextSearch.service'

// 辅助函数：创建测试用 SearchResultItem
function makeItem(content: string, metadata: Record<string, unknown> = {}): SearchResultItem {
    return { score: 1, content, metadata }
}

describe('extractDocId', () => {
    it('type=law + metadata 有 articles_id → 返回 articles_id', () => {
        const item = makeItem('内容', { articles_id: 'art-001' })
        expect(extractDocId(item, 'law')).toBe('art-001')
    })

    it('type=law + metadata 无 articles_id → 返回 content 前 50 字符', () => {
        const longContent = '这是一段很长的法律条文内容，用于测试当没有 articles_id 时的回退行为，确保截断正确'
        const item = makeItem(longContent, {})
        expect(extractDocId(item, 'law')).toBe(longContent.slice(0, 50))
    })

    it('type=law + articles_id 为空字符串 → 返回 content 前 50 字符', () => {
        const item = makeItem('法律条文', { articles_id: '' })
        expect(extractDocId(item, 'law')).toBe('法律条文')
    })

    it('type=case_material → 返回 sourceId_chunkIndex', () => {
        const item = makeItem('材料内容', { sourceId: 'src-001', chunkIndex: 3 })
        expect(extractDocId(item, 'case_material')).toBe('src-001_3')
    })

    it('type=case_material + 无 chunkIndex → 返回 sourceId_0', () => {
        const item = makeItem('材料内容', { sourceId: 'src-002' })
        expect(extractDocId(item, 'case_material')).toBe('src-002_0')
    })

    it('type=case_material + chunkIndex=0 → 返回 sourceId_0', () => {
        const item = makeItem('材料内容', { sourceId: 'src-003', chunkIndex: 0 })
        expect(extractDocId(item, 'case_material')).toBe('src-003_0')
    })
})

describe('reciprocalRankFusion', () => {
    it('两路结果无重叠 → 按 RRF 分数合并排序', () => {
        const bm25 = [makeItem('文档A', { articles_id: 'A' }), makeItem('文档B', { articles_id: 'B' })]
        const vector = [makeItem('文档C', { articles_id: 'C' }), makeItem('文档D', { articles_id: 'D' })]
        const result = reciprocalRankFusion(bm25, vector, 'law')

        expect(result).toHaveLength(4)
        // 两路各自 rank=0 得分相等：1/(60+1) ≈ 0.01639
        // rank=1 得分：1/(60+2) ≈ 0.01613
        // A 和 C 同为 rank=0，得分相同（均来自一路）
        expect(result[0].score).toBeCloseTo(1 / 61)
        expect(result[1].score).toBeCloseTo(1 / 61)
        expect(result[2].score).toBeCloseTo(1 / 62)
        expect(result[3].score).toBeCloseTo(1 / 62)
    })

    it('两路结果有重叠 → 分数叠加，重叠文档排名提升', () => {
        const bm25 = [makeItem('文档A', { articles_id: 'A' }), makeItem('文档B', { articles_id: 'B' })]
        const vector = [makeItem('文档B', { articles_id: 'B' }), makeItem('文档C', { articles_id: 'C' })]
        const result = reciprocalRankFusion(bm25, vector, 'law')

        expect(result).toHaveLength(3)
        // B 同时出现在两路中，rank=1 和 rank=0
        // B 分数：1/(60+2) + 1/(60+1) ≈ 0.01613 + 0.01639 ≈ 0.03252
        const bItem = result.find(r => r.metadata.articles_id === 'B')
        expect(bItem).toBeDefined()
        expect(bItem!.score).toBeCloseTo(1 / 62 + 1 / 61)
        // B 应该排在最前面
        expect(result[0].metadata.articles_id).toBe('B')
    })

    it('BM25 结果为空 → Vector 结果正常返回', () => {
        const vector = [makeItem('文档A', { articles_id: 'A' }), makeItem('文档B', { articles_id: 'B' })]
        const result = reciprocalRankFusion([], vector, 'law')

        expect(result).toHaveLength(2)
        expect(result[0].score).toBeCloseTo(1 / 61)
        expect(result[1].score).toBeCloseTo(1 / 62)
    })

    it('Vector 结果为空 → BM25 结果正常返回', () => {
        const bm25 = [makeItem('文档A', { articles_id: 'A' }), makeItem('文档B', { articles_id: 'B' })]
        const result = reciprocalRankFusion(bm25, [], 'law')

        expect(result).toHaveLength(2)
        expect(result[0].score).toBeCloseTo(1 / 61)
    })

    it('两路都空 → 返回空数组', () => {
        const result = reciprocalRankFusion([], [], 'law')
        expect(result).toEqual([])
    })

    it('k 参数影响分数分布', () => {
        const bm25 = [makeItem('文档A', { articles_id: 'A' })]
        const vector = [makeItem('文档A', { articles_id: 'A' })]

        const resultK60 = reciprocalRankFusion(bm25, vector, 'law', 60)
        const resultK10 = reciprocalRankFusion(bm25, vector, 'law', 10)

        // k=10 时分数更大：1/(10+1) > 1/(60+1)
        expect(resultK10[0].score).toBeGreaterThan(resultK60[0].score)
        // k=10: 1/(10+1) + 1/(10+1) = 2/11
        expect(resultK10[0].score).toBeCloseTo(2 / 11)
        // k=60: 1/(60+1) + 1/(60+1) = 2/61
        expect(resultK60[0].score).toBeCloseTo(2 / 61)
    })

    it('case_material 类型使用 sourceId_chunkIndex 作为去重 key', () => {
        const bm25 = [makeItem('材料内容', { sourceId: 'src1', chunkIndex: 0 })]
        const vector = [makeItem('材料内容', { sourceId: 'src1', chunkIndex: 0 })]
        const result = reciprocalRankFusion(bm25, vector, 'case_material')

        // 相同 sourceId+chunkIndex 应该去重合并
        expect(result).toHaveLength(1)
        expect(result[0].score).toBeCloseTo(2 / 61)
    })
})

describe('vectorSearchService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // 重置 buildParameterizedMetadataFilter 和 buildSourceIdsFilter 为默认实现
        vi.mocked(buildParameterizedMetadataFilter).mockReturnValue({ filterSQL: '', filterParams: [] })
        vi.mocked(buildSourceIdsFilter).mockReturnValue({ filterSQL: '', filterParams: [] })
    })

    it('非法表名 → 抛出 Error', async () => {
        await expect(
            vectorSearchService('evil_table', '查询', 10),
        ).rejects.toThrow('非法表名: evil_table')
    })

    it('正常查询 → 验证 SQL 构建和参数传递', async () => {
        const mockQueryVector = [0.1, 0.2, 0.3]
        const mockEmbeddings = { embedQuery: vi.fn().mockResolvedValue(mockQueryVector) }
        vi.mocked(getEmbeddingsAsync).mockResolvedValue(mockEmbeddings as never)

        const mockRows = [
            { text: '法律条文一', metadata: { articles_id: 'art-1' }, score: '0.85' },
            { text: '法律条文二', metadata: { articles_id: 'art-2' }, score: '0.72' },
        ]
        const mockQuery = vi.fn()
            .mockResolvedValueOnce({}) // SET hnsw.ef_search
            .mockResolvedValueOnce({ rows: mockRows }) // SELECT
        const mockClient = { query: mockQuery, release: vi.fn() }
        vi.mocked(getPool).mockReturnValue({ connect: vi.fn().mockResolvedValue(mockClient) } as never)

        const result = await vectorSearchService('law_embeddings', '合同纠纷', 5)

        expect(result).toHaveLength(2)
        expect(result[0]).toEqual({
            score: 0.85,
            content: '法律条文一',
            metadata: { articles_id: 'art-1' },
        })
        expect(result[1]).toEqual({
            score: 0.72,
            content: '法律条文二',
            metadata: { articles_id: 'art-2' },
        })

        // 验证 embedQuery 被调用
        expect(mockEmbeddings.embedQuery).toHaveBeenCalledWith('合同纠纷')

        // 验证第二次 query 调用（SELECT）
        const [sql, params] = mockQuery.mock.calls[1]
        expect(sql).toContain('law_embeddings')
        expect(sql).toContain('embedding <=> $1::vector')
        expect(params[0]).toBe('[0.1,0.2,0.3]')
        expect(params[params.length - 1]).toBe(5)
    })

    it('非法表名校验在获取 embeddings 之前执行', async () => {
        await expect(
            vectorSearchService('injected_table', '查询', 10),
        ).rejects.toThrow('非法表名: injected_table')

        // 不应调用 getEmbeddingsAsync
        expect(getEmbeddingsAsync).not.toHaveBeenCalled()
    })

    it('带 metadataFilter 时正确传递过滤参数', async () => {
        const mockEmbeddings = { embedQuery: vi.fn().mockResolvedValue([0.5]) }
        vi.mocked(getEmbeddingsAsync).mockResolvedValue(mockEmbeddings as never)
        vi.mocked(buildParameterizedMetadataFilter).mockReturnValue({
            filterSQL: ` AND metadata->>'legal_type' = $2`,
            filterParams: ['statute'],
        })

        const mockQuery = vi.fn()
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ rows: [] })
        const mockClient = { query: mockQuery, release: vi.fn() }
        vi.mocked(getPool).mockReturnValue({ connect: vi.fn().mockResolvedValue(mockClient) } as never)

        await vectorSearchService('law_embeddings', '刑法', 10, { legal_type: 'statute' })

        const [sql, params] = mockQuery.mock.calls[1]
        expect(params[1]).toBe('statute')
        expect(sql).toContain(`metadata->>'legal_type' = $2`)
    })
})

describe('hybridSearchService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(buildParameterizedMetadataFilter).mockReturnValue({ filterSQL: '', filterParams: [] })
        vi.mocked(buildSourceIdsFilter).mockReturnValue({ filterSQL: '', filterParams: [] })
    })

    it('并行执行 BM25 和 Vector 搜索，结果经 RRF 融合', async () => {
        const bm25Items: SearchResultItem[] = [
            makeItem('BM25文档A', { articles_id: 'A' }),
            makeItem('BM25文档B', { articles_id: 'B' }),
        ]
        const vectorItems: SearchResultItem[] = [
            makeItem('Vector文档C', { articles_id: 'C' }),
            makeItem('Vector文档B', { articles_id: 'B' }), // B 在两路中都出现
        ]

        vi.mocked(fullTextSearchService).mockResolvedValue(bm25Items)

        const mockEmbeddings = { embedQuery: vi.fn().mockResolvedValue([0.1]) }
        vi.mocked(getEmbeddingsAsync).mockResolvedValue(mockEmbeddings as never)
        const mockQuery = vi.fn()
            .mockResolvedValueOnce({}) // SET hnsw.ef_search
            .mockResolvedValueOnce({ rows: vectorItems.map(i => ({ text: i.content, metadata: i.metadata, score: '0.9' })) })
        const mockClient = { query: mockQuery, release: vi.fn() }
        vi.mocked(getPool).mockReturnValue({ connect: vi.fn().mockResolvedValue(mockClient) } as never)

        const result = await hybridSearchService(
            { intent: 'hybrid', keywords: ['合同', '违约'], rewrittenQuery: '合同违约纠纷' },
            { query: '合同违约', type: 'law', k: 5 },
        )

        // fullTextSearchService 被调用
        expect(fullTextSearchService).toHaveBeenCalledWith(
            'law_embeddings',
            ['合同', '违约'],
            15, // k * 3
            undefined,
            undefined,
        )

        // embedQuery 使用 rewrittenQuery
        expect(mockEmbeddings.embedQuery).toHaveBeenCalledWith('合同违约纠纷')

        // B 同时出现在两路，应排在最前面
        expect(result).toHaveLength(3)
        expect(result[0].metadata.articles_id).toBe('B')
    })

    it('无 rewrittenQuery 时使用原始 query', async () => {
        vi.mocked(fullTextSearchService).mockResolvedValue([])

        const mockEmbeddings = { embedQuery: vi.fn().mockResolvedValue([0.1]) }
        vi.mocked(getEmbeddingsAsync).mockResolvedValue(mockEmbeddings as never)
        const mockQuery = vi.fn()
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ rows: [] })
        const mockClient = { query: mockQuery, release: vi.fn() }
        vi.mocked(getPool).mockReturnValue({ connect: vi.fn().mockResolvedValue(mockClient) } as never)

        await hybridSearchService(
            { intent: 'hybrid', keywords: ['损害赔偿'] },
            { query: '原始查询内容', type: 'law', k: 3 },
        )

        // 无 rewrittenQuery 时使用原始 query
        expect(mockEmbeddings.embedQuery).toHaveBeenCalledWith('原始查询内容')
    })

    it('case_material 类型使用正确表名', async () => {
        vi.mocked(fullTextSearchService).mockResolvedValue([])

        const mockEmbeddings = { embedQuery: vi.fn().mockResolvedValue([0.1]) }
        vi.mocked(getEmbeddingsAsync).mockResolvedValue(mockEmbeddings as never)
        const mockQuery = vi.fn()
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ rows: [] })
        const mockClient = { query: mockQuery, release: vi.fn() }
        vi.mocked(getPool).mockReturnValue({ connect: vi.fn().mockResolvedValue(mockClient) } as never)

        await hybridSearchService(
            { intent: 'hybrid', keywords: ['证人证词'] },
            { query: '案件材料查询', type: 'case_material', k: 5 },
        )

        expect(fullTextSearchService).toHaveBeenCalledWith(
            'case_material_embeddings',
            expect.any(Array),
            15,
            undefined,
            undefined,
        )

        const [sql] = mockQuery.mock.calls[1]
        expect(sql).toContain('case_material_embeddings')
    })
})
