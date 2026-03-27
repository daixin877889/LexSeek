/**
 * useArticleSearch 法条搜索 Composable 测试
 *
 * 测试法条搜索功能
 *
 * **Feature: article-search-composable**
 * **Validates: 法条搜索功能**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// 导入待测试的 composable
const { useArticleSearch } = await import('~/composables/useArticleSearch')

describe('useArticleSearch 初始状态测试', () => {
    it('初始状态应为正确默认值', () => {
        const { loading, error, results, query, total } = useArticleSearch()
        expect(loading.value).toBe(false)
        expect(error.value).toBeNull()
        expect(results.value).toEqual([])
        expect(query.value).toBe('')
        expect(total.value).toBe(0)
    })
})

describe('useArticleSearch clearResults 测试', () => {
    it('clearResults 应重置所有状态', () => {
        const { results, query, total, clearResults } = useArticleSearch()
        // @ts-ignore - 直接修改测试
        results.value = [{ id: '1', content: 'test' }]
        // @ts-ignore - 直接修改测试
        query.value = 'test query'
        // @ts-ignore - 直接修改测试
        total.value = 10

        clearResults()

        expect(results.value).toEqual([])
        expect(total.value).toBe(0)
        expect(query.value).toBe('')
    })
})

describe('useArticleSearch setFilters 测试', () => {
    it('setFilters 应更新 filters 值', () => {
        const { filters, setFilters } = useArticleSearch()
        setFilters({ legalType: 'law' as any })
        expect(filters.value.legalType).toBe('law')
    })

    it('setFilters 应合并而非替换所有 filters', () => {
        const { filters, setFilters } = useArticleSearch()
        // @ts-ignore - 直接修改测试
        filters.value = { legalType: 'law', validityStatus: 'valid' }
        setFilters({ legalType: 'regulation' as any })
        expect(filters.value.validityStatus).toBe('valid')
    })
})

describe('useArticleSearch resetFilters 测试', () => {
    it('resetFilters 应恢复默认值', () => {
        const { filters, setFilters, resetFilters } = useArticleSearch()
        setFilters({ legalType: 'law' as any, validityStatus: 'invalid' as any })
        resetFilters()
        expect(filters.value.legalType).toBeNull()
        expect(filters.value.validityStatus).toBe('valid')
    })
})

describe('useArticleSearch Property 测试', () => {
    it('Property: clearResults 后状态应为空', () => {
        fc.assert(
            fc.property(
                fc.array(fc.string(), { minLength: 0, maxLength: 5 }),
                fc.string({ maxLength: 50 }),
                fc.integer({ min: 0, max: 1000 }),
                (items, q, t) => {
                    const { results, query, total, clearResults } = useArticleSearch()
                    // @ts-ignore - 直接修改测试
                    results.value = items.map((_, i) => ({ id: String(i), content: _ }))
                    // @ts-ignore - 直接修改测试
                    query.value = q
                    // @ts-ignore - 直接修改测试
                    total.value = t
                    clearResults()
                    expect(results.value).toEqual([])
                    expect(query.value).toBe('')
                    expect(total.value).toBe(0)
                }
            ),
            { numRuns: 50, seed: 12345 }
        )
    })
})
