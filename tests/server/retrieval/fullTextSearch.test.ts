/**
 * 全文搜索服务单元测试
 *
 * **Feature: retrieval**
 * **Validates: Requirements fullTextSearch**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
    buildParameterizedMetadataFilter,
    buildSourceIdsFilter,
    fullTextSearchService,
} from '../../../server/services/retrieval/fullTextSearch.service'

// Mock getPool
vi.mock('../../../server/services/legal/vectorStore.service', () => ({
    getPool: vi.fn(),
}))

import { getPool } from '../../../server/services/legal/vectorStore.service'

describe('buildParameterizedMetadataFilter', () => {
    it('undefined 时返回空 filterSQL 和空 filterParams', () => {
        const result = buildParameterizedMetadataFilter(undefined, 2)
        expect(result.filterSQL).toBe('')
        expect(result.filterParams).toEqual([])
    })

    it('空对象时返回空 filterSQL 和空 filterParams', () => {
        const result = buildParameterizedMetadataFilter({}, 2)
        expect(result.filterSQL).toBe('')
        expect(result.filterParams).toEqual([])
    })

    it('合法 key 时生成正确参数化 SQL', () => {
        const result = buildParameterizedMetadataFilter({ legal_id: '123' }, 2)
        expect(result.filterSQL).toBe(` AND metadata->>'legal_id' = $2`)
        expect(result.filterParams).toEqual(['123'])
    })

    it('多个合法 key 时生成多个 AND 条件，参数递增', () => {
        const result = buildParameterizedMetadataFilter(
            { legal_id: '123', legal_type: 'statute' },
            2,
        )
        expect(result.filterSQL).toBe(
            ` AND metadata->>'legal_id' = $2 AND metadata->>'legal_type' = $3`,
        )
        expect(result.filterParams).toEqual(['123', 'statute'])
    })

    it('自定义起始参数索引时正确偏移', () => {
        const result = buildParameterizedMetadataFilter({ legal_name: '刑法' }, 5)
        expect(result.filterSQL).toBe(` AND metadata->>'legal_name' = $5`)
        expect(result.filterParams).toEqual(['刑法'])
    })

    it('非法 key 时抛出 Error', () => {
        expect(() =>
            buildParameterizedMetadataFilter({ illegal_key: 'val' }, 2),
        ).toThrow('非法 metadata 过滤字段: illegal_key')
    })

    it('number/boolean 类型值自动转为字符串', () => {
        const result = buildParameterizedMetadataFilter({ legal_id: 42 }, 2)
        expect(result.filterParams).toEqual(['42'])
    })
})

describe('buildSourceIdsFilter', () => {
    it('undefined 时返回空 filterSQL 和空 filterParams', () => {
        const result = buildSourceIdsFilter(undefined, 2)
        expect(result.filterSQL).toBe('')
        expect(result.filterParams).toEqual([])
    })

    it('空数组时返回空 filterSQL 和空 filterParams', () => {
        const result = buildSourceIdsFilter([], 2)
        expect(result.filterSQL).toBe('')
        expect(result.filterParams).toEqual([])
    })

    it('单个 sourceId 时生成 IN ($N) 条件', () => {
        const result = buildSourceIdsFilter(['abc'], 2)
        expect(result.filterSQL).toBe(` AND metadata->>'sourceId' IN ($2)`)
        expect(result.filterParams).toEqual(['abc'])
    })

    it('多个 sourceId 时生成 IN ($N, $N+1) 条件', () => {
        const result = buildSourceIdsFilter(['1', '2'], 3)
        expect(result.filterSQL).toBe(` AND metadata->>'sourceId' IN ($3, $4)`)
        expect(result.filterParams).toEqual(['1', '2'])
    })

    it('参数索引正确从起始值递增', () => {
        const result = buildSourceIdsFilter(['a', 'b', 'c'], 5)
        expect(result.filterSQL).toBe(` AND metadata->>'sourceId' IN ($5, $6, $7)`)
        expect(result.filterParams).toEqual(['a', 'b', 'c'])
    })
})

describe('fullTextSearchService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('非法表名时抛出 Error', async () => {
        await expect(
            fullTextSearchService('evil_table', ['关键词'], 10),
        ).rejects.toThrow('非法表名: evil_table')
    })

    it('空 keywords 时直接返回空数组，不查询数据库', async () => {
        const result = await fullTextSearchService('law_embeddings', [], 10)
        expect(result).toEqual([])
        expect(getPool).not.toHaveBeenCalled()
    })

    it('正常查询时正确构建 SQL 并映射结果', async () => {
        const mockRows = [
            { text: '第一条法律条文', metadata: { legal_id: '1' }, score: '0.5' },
            { text: '第二条法律条文', metadata: { legal_id: '2' }, score: '0.3' },
        ]
        const mockQuery = vi.fn().mockResolvedValue({ rows: mockRows })
        vi.mocked(getPool).mockReturnValue({ query: mockQuery } as never)

        const result = await fullTextSearchService('law_embeddings', ['合同', '违约'], 5)

        expect(result).toHaveLength(2)
        expect(result[0]).toEqual({
            score: 0.5,
            content: '第一条法律条文',
            metadata: { legal_id: '1' },
        })
        expect(result[1]).toEqual({
            score: 0.3,
            content: '第二条法律条文',
            metadata: { legal_id: '2' },
        })

        // 验证：业务方已改为每个 token 一个独立占位符（多 token 间 || OR），
        // 不再走 keywords.join(' ') 单参模式
        const [sql, params] = mockQuery.mock.calls[0]
        expect(params[0]).toBe('合同')
        expect(params[1]).toBe('违约')
        // LIMIT 参数在末尾
        expect(params[params.length - 1]).toBe(5)
        expect(sql).toContain('plainto_tsquery')
        expect(sql).toContain('law_embeddings')
    })

    it('带 metadataFilter 时正确拼接过滤条件', async () => {
        const mockQuery = vi.fn().mockResolvedValue({ rows: [] })
        vi.mocked(getPool).mockReturnValue({ query: mockQuery } as never)

        await fullTextSearchService(
            'law_embeddings',
            ['侵权'],
            10,
            { legal_type: 'statute' },
        )

        const [sql, params] = mockQuery.mock.calls[0]
        // $1 = searchText, $2 = 'statute', $3 = k
        expect(params[0]).toBe('侵权')
        expect(params[1]).toBe('statute')
        expect(params[2]).toBe(10)
        expect(sql).toContain(`metadata->>'legal_type' = $2`)
        expect(sql).toContain('LIMIT $3')
    })

    it('带 sourceIds 时正确拼接 IN 条件', async () => {
        const mockQuery = vi.fn().mockResolvedValue({ rows: [] })
        vi.mocked(getPool).mockReturnValue({ query: mockQuery } as never)

        await fullTextSearchService(
            'case_material_embeddings',
            ['证据'],
            10,
            undefined,
            ['src1', 'src2'],
        )

        const [sql, params] = mockQuery.mock.calls[0]
        // $1 = searchText, $2 = 'src1', $3 = 'src2', $4 = k
        expect(params[0]).toBe('证据')
        expect(params[1]).toBe('src1')
        expect(params[2]).toBe('src2')
        expect(params[3]).toBe(10)
        expect(sql).toContain(`metadata->>'sourceId' IN ($2, $3)`)
        expect(sql).toContain('LIMIT $4')
    })

    it('同时带 metadataFilter 和 sourceIds 时参数索引正确累积', async () => {
        const mockQuery = vi.fn().mockResolvedValue({ rows: [] })
        vi.mocked(getPool).mockReturnValue({ query: mockQuery } as never)

        await fullTextSearchService(
            'law_embeddings',
            ['刑法'],
            10,
            { legal_id: '99' },
            ['s1', 's2'],
        )

        const [sql, params] = mockQuery.mock.calls[0]
        // $1=searchText, $2=legal_id value, $3='s1', $4='s2', $5=k
        expect(params).toEqual(['刑法', '99', 's1', 's2', 10])
        expect(sql).toContain(`metadata->>'legal_id' = $2`)
        expect(sql).toContain(`metadata->>'sourceId' IN ($3, $4)`)
        expect(sql).toContain('LIMIT $5')
    })
})
