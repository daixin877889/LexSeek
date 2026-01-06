/**
 * 法条搜索组合式函数
 *
 * 提供法条向量搜索功能，支持语义搜索和筛选
 */

import type { ArticleSearchFilters, ArticleSearchResponse } from '#shared/types/legal-search'
import type { LawSearchResultItem } from '#shared/types/legal'

export interface UseArticleSearchReturn {
    // 状态
    loading: Ref<boolean>
    error: Ref<string | null>
    results: Ref<LawSearchResultItem[]>
    query: Ref<string>
    filters: Ref<ArticleSearchFilters>
    total: Ref<number>

    // 方法
    searchArticles: (query: string, filters?: Partial<ArticleSearchFilters>) => Promise<void>
    clearResults: () => void
    setFilters: (filters: Partial<ArticleSearchFilters>) => void
    resetFilters: () => void
}

/**
 * 法条搜索组合式函数
 */
export function useArticleSearch(): UseArticleSearchReturn {
    // 响应式状态
    const loading = ref(false)
    const error = ref<string | null>(null)
    const results = ref<LawSearchResultItem[]>([])
    const query = ref('')
    const total = ref(0)

    // 筛选条件
    const filters = ref<ArticleSearchFilters>({
        legalType: null,
        validityStatus: 'valid',
    })

    /**
     * 清除错误状态
     */
    const clearError = () => {
        error.value = null
    }

    /**
     * 设置错误状态
     */
    const setError = (message: string) => {
        error.value = message
        console.error('法条搜索错误:', message)
    }

    /**
     * 搜索法条
     */
    const searchArticles = async (searchQuery: string, searchFilters?: Partial<ArticleSearchFilters>) => {
        if (!searchQuery.trim()) {
            setError('搜索查询不能为空')
            return
        }

        try {
            loading.value = true
            clearError()

            // 更新查询和筛选条件
            query.value = searchQuery
            if (searchFilters) {
                filters.value = { ...filters.value, ...searchFilters }
            }

            // 构建请求参数（只传递有效值，避免传递 null）
            const requestBody: Record<string, unknown> = {
                query: searchQuery.trim(),
                validityStatus: filters.value.validityStatus,
                limit: 20, // 默认返回 20 条结果
            }

            // 只有当 legalType 有值时才传递
            if (filters.value.legalType) {
                requestBody.legalType = filters.value.legalType
            }

            // 发送请求（使用 useApiFetch）
            const response = await useApiFetch<ArticleSearchResponse>('/api/v1/legal/search-articles', {
                method: 'POST',
                body: requestBody,
            })

            if (response) {
                // 更新状态
                results.value = response.items
                total.value = response.total
            }
        } catch (err: any) {
            setError(err.message || '搜索失败')
            results.value = []
            total.value = 0
        } finally {
            loading.value = false
        }
    }

    /**
     * 清除搜索结果
     */
    const clearResults = () => {
        results.value = []
        total.value = 0
        query.value = ''
        clearError()
    }

    /**
     * 设置筛选条件
     */
    const setFilters = (newFilters: Partial<ArticleSearchFilters>) => {
        filters.value = { ...filters.value, ...newFilters }

        // 如果有查询，重新搜索
        if (query.value.trim()) {
            searchArticles(query.value)
        }
    }

    /**
     * 重置筛选条件
     */
    const resetFilters = () => {
        filters.value = {
            legalType: null,
            validityStatus: 'valid',
        }

        // 如果有查询，重新搜索
        if (query.value.trim()) {
            searchArticles(query.value)
        }
    }

    return {
        // 状态
        loading: readonly(loading),
        error: readonly(error),
        results,
        query: readonly(query),
        filters: readonly(filters),
        total: readonly(total),

        // 方法
        searchArticles,
        clearResults,
        setFilters,
        resetFilters,
    }
}