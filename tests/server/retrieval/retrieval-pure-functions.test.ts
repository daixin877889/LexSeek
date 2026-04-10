/**
 * 检索系统纯函数测试
 *
 * 测试 fullTextSearch、hybridSearch、postFilter 中的纯函数
 */
import { describe, it, expect } from 'vitest'
import {
    buildParameterizedMetadataFilter,
    buildSourceIdsFilter,
} from '~~/server/services/retrieval/fullTextSearch.service'
import {
    extractDocId,
    reciprocalRankFusion,
} from '~~/server/services/retrieval/hybridSearch.service'
import {
    isLawEffective,
    applyDateFilter,
    applyPostFiltersService,
} from '~~/server/services/retrieval/postFilter.service'
import type { RetrievalResult, SearchResultItem } from '~~/server/services/retrieval/types'
import { ALLOWED_TABLES, ALLOWED_METADATA_KEYS } from '~~/server/services/retrieval/types'

// ==================== fullTextSearch 纯函数 ====================

describe('buildParameterizedMetadataFilter', () => {
    it('空 filter 返回空 SQL 和参数', () => {
        const result = buildParameterizedMetadataFilter(undefined, 1)
        expect(result.filterSQL).toBe('')
        expect(result.filterParams).toEqual([])
    })

    it('空对象返回空 SQL 和参数', () => {
        const result = buildParameterizedMetadataFilter({}, 1)
        expect(result.filterSQL).toBe('')
        expect(result.filterParams).toEqual([])
    })

    it('单个合法字段生成正确的参数化 SQL', () => {
        const result = buildParameterizedMetadataFilter({ legal_id: '123' }, 2)
        expect(result.filterSQL).toBe(` AND metadata->>'legal_id' = $2`)
        expect(result.filterParams).toEqual(['123'])
    })

    it('多个字段生成正确的参数化 SQL', () => {
        const result = buildParameterizedMetadataFilter(
            { legal_id: '123', legal_type: 'law' },
            3
        )
        expect(result.filterSQL).toContain(`$3`)
        expect(result.filterSQL).toContain(`$4`)
        expect(result.filterParams).toEqual(['123', 'law'])
    })

    it('数字值转换为字符串', () => {
        const result = buildParameterizedMetadataFilter({ legal_id: 42 }, 1)
        expect(result.filterParams).toEqual(['42'])
    })

    it('布尔值转换为字符串', () => {
        const result = buildParameterizedMetadataFilter({ legal_id: true } as any, 1)
        expect(result.filterParams).toEqual(['true'])
    })

    it('非法字段名抛出错误', () => {
        expect(() =>
            buildParameterizedMetadataFilter({ malicious_field: 'value' }, 1)
        ).toThrow('非法 metadata 过滤字段')
    })

    it('startParamIndex 正确影响参数编号', () => {
        const result = buildParameterizedMetadataFilter({ legal_id: '1' }, 10)
        expect(result.filterSQL).toContain('$10')
    })
})

describe('buildSourceIdsFilter', () => {
    it('undefined sourceIds 返回空', () => {
        const result = buildSourceIdsFilter(undefined, 1)
        expect(result.filterSQL).toBe('')
        expect(result.filterParams).toEqual([])
    })

    it('空数组返回空', () => {
        const result = buildSourceIdsFilter([], 1)
        expect(result.filterSQL).toBe('')
        expect(result.filterParams).toEqual([])
    })

    it('单个 sourceId 生成正确 SQL', () => {
        const result = buildSourceIdsFilter(['src1'], 3)
        expect(result.filterSQL).toBe(` AND metadata->>'sourceId' IN ($3)`)
        expect(result.filterParams).toEqual(['src1'])
    })

    it('多个 sourceIds 生成正确 SQL', () => {
        const result = buildSourceIdsFilter(['src1', 'src2', 'src3'], 5)
        expect(result.filterSQL).toBe(` AND metadata->>'sourceId' IN ($5, $6, $7)`)
        expect(result.filterParams).toEqual(['src1', 'src2', 'src3'])
    })
})

// ==================== hybridSearch 纯函数 ====================

describe('extractDocId', () => {
    it('law 类型使用 articles_id', () => {
        const item: SearchResultItem = {
            score: 0.5,
            content: '测试内容',
            metadata: { articles_id: 'art_123' },
        }
        expect(extractDocId(item, 'law')).toBe('art_123')
    })

    it('law 类型无 articles_id 时使用 content 前50字符', () => {
        const longContent = 'A'.repeat(100)
        const item: SearchResultItem = {
            score: 0.5,
            content: longContent,
            metadata: {},
        }
        expect(extractDocId(item, 'law')).toBe('A'.repeat(50))
    })

    it('case_material 类型使用 sourceId + chunkIndex', () => {
        const item: SearchResultItem = {
            score: 0.5,
            content: '测试',
            metadata: { sourceId: 'file_1', chunkIndex: 3 },
        }
        expect(extractDocId(item, 'case_material')).toBe('file_1_3')
    })

    it('case_material 无 chunkIndex 时默认为 0', () => {
        const item: SearchResultItem = {
            score: 0.5,
            content: '测试',
            metadata: { sourceId: 'file_1' },
        }
        expect(extractDocId(item, 'case_material')).toBe('file_1_0')
    })
})

describe('reciprocalRankFusion', () => {
    const makeItem = (id: string, score: number, type: 'law' | 'case_material' = 'law'): SearchResultItem => ({
        score,
        content: id,
        metadata: type === 'law' ? { articles_id: id } : { sourceId: id, chunkIndex: 0 },
    })

    it('空输入返回空数组', () => {
        expect(reciprocalRankFusion([], [], 'law')).toEqual([])
    })

    it('只有 BM25 结果时正确计算 RRF 分数', () => {
        const bm25 = [makeItem('a', 1), makeItem('b', 0.5)]
        const result = reciprocalRankFusion(bm25, [], 'law')
        expect(result).toHaveLength(2)
        // 第一名 RRF = 1/(60+0+1) = 1/61
        expect(result[0]!.score).toBeCloseTo(1 / 61, 5)
    })

    it('相同文档在两个列表中的分数合并', () => {
        const bm25 = [makeItem('a', 1)]
        const vector = [makeItem('a', 0.9)]
        const result = reciprocalRankFusion(bm25, vector, 'law')
        expect(result).toHaveLength(1)
        // 合并分数 = 1/61 + 1/61
        expect(result[0]!.score).toBeCloseTo(2 / 61, 5)
    })

    it('结果按 RRF 分数降序排列', () => {
        const bm25 = [makeItem('a', 1), makeItem('b', 0.5)]
        const vector = [makeItem('a', 0.9), makeItem('c', 0.8)]
        const result = reciprocalRankFusion(bm25, vector, 'law')
        // a 出现在两个列表，分数最高
        expect(result[0]!.metadata.articles_id).toBe('a')
    })

    it('自定义 k 值影响 RRF 计算', () => {
        const bm25 = [makeItem('a', 1)]
        const k10 = reciprocalRankFusion(bm25, [], 'law', 10)
        const k100 = reciprocalRankFusion(bm25, [], 'law', 100)
        // k=10: 1/(10+0+1) = 1/11
        // k=100: 1/(100+0+1) = 1/101
        expect(k10[0]!.score).toBeGreaterThan(k100[0]!.score)
    })

    it('case_material 类型去重使用 sourceId', () => {
        const bm25 = [makeItem('file1', 1, 'case_material')]
        const vector = [makeItem('file1', 0.9, 'case_material')]
        const result = reciprocalRankFusion(bm25, vector, 'case_material')
        expect(result).toHaveLength(1)
    })
})

// ==================== postFilter 纯函数 ====================

describe('isLawEffective', () => {
    it('无日期参数时返回 true', () => {
        expect(isLawEffective()).toBe(true)
    })

    it('null 日期参数时返回 true', () => {
        expect(isLawEffective(null, null)).toBe(true)
    })

    it('已生效且未失效的法律返回 true', () => {
        expect(isLawEffective('2020-01-01', null)).toBe(true)
    })

    it('未来生效日期返回 false', () => {
        expect(isLawEffective('2099-01-01', null)).toBe(false)
    })

    it('已失效的法律返回 false', () => {
        expect(isLawEffective('2020-01-01', '2021-01-01')).toBe(false)
    })

    it('未来失效日期返回 true', () => {
        expect(isLawEffective('2020-01-01', '2099-01-01')).toBe(true)
    })

    it('空字符串失效日期视为无失效日期', () => {
        expect(isLawEffective('2020-01-01', '')).toBe(true)
    })
})

describe('applyDateFilter', () => {
    const makeResult = (date: string): RetrievalResult => ({
        content: '测试',
        score: 0.5,
        metadata: { publish_date: date },
        retrievalMode: 'hybrid',
    })

    it('无过滤条件返回原数组', () => {
        const results = [makeResult('2024-01-01')]
        expect(applyDateFilter(results, {})).toEqual(results)
    })

    it('undefined 过滤条件被跳过', () => {
        const results = [makeResult('2024-01-01')]
        expect(applyDateFilter(results, { publish_date: undefined })).toEqual(results)
    })

    it('大于操作符正确过滤', () => {
        const results = [
            makeResult('2024-01-01'),
            makeResult('2024-06-01'),
            makeResult('2024-12-01'),
        ]
        const filtered = applyDateFilter(results, {
            publish_date: { date: '2024-06-01', operator: '>' },
        })
        expect(filtered).toHaveLength(1)
        expect(filtered[0]!.metadata.publish_date).toBe('2024-12-01')
    })

    it('小于操作符正确过滤', () => {
        const results = [
            makeResult('2024-01-01'),
            makeResult('2024-06-01'),
            makeResult('2024-12-01'),
        ]
        const filtered = applyDateFilter(results, {
            publish_date: { date: '2024-06-01', operator: '<' },
        })
        expect(filtered).toHaveLength(1)
        expect(filtered[0]!.metadata.publish_date).toBe('2024-01-01')
    })

    it('等于操作符按天比较', () => {
        const results = [
            makeResult('2024-06-01'),
            makeResult('2024-06-02'),
        ]
        const filtered = applyDateFilter(results, {
            publish_date: { date: '2024-06-01', operator: '=' },
        })
        expect(filtered).toHaveLength(1)
    })

    it('大于等于操作符包含等于', () => {
        const results = [
            makeResult('2024-05-31'),
            makeResult('2024-06-01'),
            makeResult('2024-06-02'),
        ]
        const filtered = applyDateFilter(results, {
            publish_date: { date: '2024-06-01', operator: '>=' },
        })
        expect(filtered).toHaveLength(2)
    })

    it('缺少日期字段的结果被过滤掉', () => {
        const results: RetrievalResult[] = [{
            content: '测试',
            score: 0.5,
            metadata: {},
            retrievalMode: 'hybrid',
        }]
        const filtered = applyDateFilter(results, {
            publish_date: { date: '2024-01-01', operator: '>' },
        })
        expect(filtered).toHaveLength(0)
    })

    it('无效日期字符串的结果被过滤掉', () => {
        const results: RetrievalResult[] = [{
            content: '测试',
            score: 0.5,
            metadata: { publish_date: 'not-a-date' },
            retrievalMode: 'hybrid',
        }]
        const filtered = applyDateFilter(results, {
            publish_date: { date: '2024-01-01', operator: '>' },
        })
        expect(filtered).toHaveLength(0)
    })
})

describe('applyPostFiltersService', () => {
    const makeResult = (overrides: Partial<RetrievalResult> = {}): RetrievalResult => ({
        content: '测试内容',
        score: 0.8,
        metadata: {},
        retrievalMode: 'hybrid',
        ...overrides,
    })

    it('无 postFilters 返回原数组', () => {
        const results = [makeResult()]
        expect(applyPostFiltersService(results)).toEqual(results)
    })

    it('undefined postFilters 返回原数组', () => {
        const results = [makeResult()]
        expect(applyPostFiltersService(results, undefined)).toEqual(results)
    })

    it('isEffective 过滤已失效法律', () => {
        const results = [
            makeResult({ metadata: { effective_date: '2020-01-01', invalid_date: '2021-01-01' } }),
            makeResult({ metadata: { effective_date: '2020-01-01', invalid_date: '2099-12-31' } }),
        ]
        const filtered = applyPostFiltersService(results, { isEffective: true })
        expect(filtered).toHaveLength(1)
    })

    it('空 postFilters 对象返回原数组', () => {
        const results = [makeResult()]
        expect(applyPostFiltersService(results, {})).toEqual(results)
    })

    it('组合有效性和日期过滤', () => {
        const results = [
            makeResult({ metadata: { effective_date: '2020-01-01', invalid_date: '', publish_date: '2023-01-01' } }),
            makeResult({ metadata: { effective_date: '2020-01-01', invalid_date: '2021-01-01', publish_date: '2023-06-01' } }),
        ]
        const filtered = applyPostFiltersService(results, {
            isEffective: true,
            publishDateFilter: { date: '2023-03-01', operator: '>' },
        })
        // 第一条有效但 publish_date 不满足 >2023-03-01 -> 过滤掉
        // 第二条已失效 -> 过滤掉
        expect(filtered).toHaveLength(0)
    })
})

// ==================== types 常量 ====================

describe('检索类型常量', () => {
    it('ALLOWED_TABLES 包含预期的表名', () => {
        expect(ALLOWED_TABLES.has('law_embeddings')).toBe(true)
        expect(ALLOWED_TABLES.has('case_material_embeddings')).toBe(true)
        expect(ALLOWED_TABLES.has('malicious_table')).toBe(false)
    })

    it('ALLOWED_METADATA_KEYS 包含预期的键', () => {
        expect(ALLOWED_METADATA_KEYS.has('legal_id')).toBe(true)
        expect(ALLOWED_METADATA_KEYS.has('legal_name')).toBe(true)
        expect(ALLOWED_METADATA_KEYS.has('userId')).toBe(true)
        expect(ALLOWED_METADATA_KEYS.has('sourceId')).toBe(true)
        expect(ALLOWED_METADATA_KEYS.has('malicious_key')).toBe(false)
    })
})
