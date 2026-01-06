/**
 * 法律法规搜索组合式函数
 *
 * 提供法律法规列表加载、筛选、分页、统计数据加载等功能
 * 支持响应式状态管理和错误处理
 */

import type {
    LegalSearchFilters,
    PaginationState,
    LegalSearchStatistics,
    LegalDetailResponse,
    LegalListResponse,
    LegalStatisticsResponse,
    IssuingAuthoritiesResponse,
} from '#shared/types/legal-search'
import type { LegalMainListItem } from '#shared/types/legal'

/** 带有效性计算的法律列表项 */
export interface LegalListItemWithValidity extends LegalMainListItem {
    /** 是否有效（前端计算） */
    isValid: boolean
}

export interface UseLegalSearchReturn {
    // 状态
    loading: Ref<boolean>
    error: Ref<string | null>
    legalList: Ref<LegalListItemWithValidity[]>
    statistics: Ref<LegalSearchStatistics | null>
    pagination: Ref<PaginationState>
    filters: Readonly<Ref<LegalSearchFilters>>
    selectedLegal: Ref<LegalDetailResponse | null>
    issuingAuthorities: Ref<string[]>

    // 方法
    search: (keyword?: string) => Promise<void>
    loadStatistics: () => Promise<void>
    loadLegalDetail: (id: string) => Promise<void>
    loadIssuingAuthorities: () => Promise<void>
    setFilters: (filters: Partial<LegalSearchFilters>) => void
    resetFilters: () => void
    setPage: (page: number) => void
    refresh: () => Promise<void>
}

/**
 * 计算法律是否有效
 */
function computeIsValid(item: LegalMainListItem): boolean {
    const now = new Date()
    const effectiveDate = item.effectiveDate ? new Date(item.effectiveDate) : null
    const invalidDate = item.invalidDate ? new Date(item.invalidDate) : null

    // 如果有生效日期且还未生效，则无效
    if (effectiveDate && effectiveDate > now) return false

    // 如果有失效日期且已失效，则无效
    if (invalidDate && invalidDate <= now) return false

    return true
}

/**
 * 法律法规搜索组合式函数
 */
export function useLegalSearch(): UseLegalSearchReturn {
    // 响应式状态
    const loading = ref(false)
    const error = ref<string | null>(null)
    const legalList = ref<LegalListItemWithValidity[]>([])
    const statistics = ref<LegalSearchStatistics | null>(null)
    const selectedLegal = ref<LegalDetailResponse | null>(null)
    const issuingAuthorities = ref<string[]>([])

    // 分页状态
    const pagination = ref<PaginationState>({
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 0,
    })

    // 筛选条件
    const filters = ref<LegalSearchFilters>({
        keyword: '',
        type: null,
        issuingAuthority: null,
        validityStatus: 'all',
        publishDateFrom: null,
        publishDateTo: null,
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
        console.error('法律搜索错误:', message)
    }

    /**
     * 搜索法律法规列表
     */
    const search = async (keyword?: string) => {
        try {
            loading.value = true
            clearError()

            // 更新关键词
            if (keyword !== undefined) {
                filters.value.keyword = keyword
                // 重置到第一页
                pagination.value.page = 1
            }

            // 构建查询参数
            const query: Record<string, string | number | boolean> = {
                page: pagination.value.page,
                pageSize: pagination.value.pageSize,
            }

            if (filters.value.keyword) {
                query.keyword = filters.value.keyword
            }
            if (filters.value.type) {
                query.type = filters.value.type
            }
            if (filters.value.issuingAuthority) {
                query.issuingAuthority = filters.value.issuingAuthority
            }
            if (filters.value.validityStatus && filters.value.validityStatus !== 'all') {
                query.validityStatus = filters.value.validityStatus
            }
            if (filters.value.publishDateFrom) {
                query.publishDateFrom = filters.value.publishDateFrom
            }
            if (filters.value.publishDateTo) {
                query.publishDateTo = filters.value.publishDateTo
            }

            // 发送请求（使用 useApiFetch）
            const response = await useApiFetch<LegalListResponse>('/api/v1/legal/list', { query })

            if (response) {
                // 为每个项目计算有效性
                legalList.value = response.items.map(item => ({
                    ...item,
                    isValid: computeIsValid(item),
                }))
                pagination.value = {
                    page: response.page,
                    pageSize: response.pageSize,
                    total: response.total,
                    totalPages: response.totalPages,
                }
            }
        } catch (err: any) {
            setError(err.message || '搜索失败')
        } finally {
            loading.value = false
        }
    }

    /**
     * 加载统计数据
     */
    const loadStatistics = async () => {
        try {
            clearError()

            const response = await useApiFetch<LegalStatisticsResponse>('/api/v1/legal/statistics')

            if (response) {
                statistics.value = {
                    total: response.total,
                    byType: response.byType,
                    byStatus: response.byStatus,
                }
            }
        } catch (err: any) {
            setError(err.message || '加载统计数据失败')
        }
    }

    /**
     * 加载法律法规详情
     */
    const loadLegalDetail = async (id: string) => {
        try {
            loading.value = true
            clearError()

            const response = await useApiFetch<LegalDetailResponse>(`/api/v1/legal/${id}`)
            if (response) {
                selectedLegal.value = response
            }
        } catch (err: any) {
            setError(err.message || '加载详情失败')
        } finally {
            loading.value = false
        }
    }

    /**
     * 加载发文机关列表
     */
    const loadIssuingAuthorities = async () => {
        try {
            clearError()

            const response = await useApiFetch<IssuingAuthoritiesResponse>('/api/v1/legal/issuing-authorities')
            if (response) {
                issuingAuthorities.value = response.items
            }
        } catch (err: any) {
            setError(err.message || '加载发文机关列表失败')
        }
    }

    /**
     * 设置筛选条件
     */
    const setFilters = (newFilters: Partial<LegalSearchFilters>) => {
        filters.value = { ...filters.value, ...newFilters }
        // 重置到第一页
        pagination.value.page = 1
        // 自动搜索
        search()
    }

    /**
     * 重置筛选条件
     */
    const resetFilters = () => {
        filters.value = {
            keyword: '',
            type: null,
            issuingAuthority: null,
            validityStatus: 'all',
            publishDateFrom: null,
            publishDateTo: null,
        }
        pagination.value.page = 1
        // 自动搜索
        search()
    }

    /**
     * 设置页码
     */
    const setPage = (page: number) => {
        if (page >= 1 && page <= pagination.value.totalPages) {
            pagination.value.page = page
            search()
        }
    }

    /**
     * 刷新当前数据
     */
    const refresh = async () => {
        await Promise.all([
            search(),
            loadStatistics(),
        ])
    }

    return {
        // 状态
        loading: readonly(loading),
        error: readonly(error),
        legalList,
        statistics: readonly(statistics),
        pagination: readonly(pagination),
        filters: readonly(filters),
        selectedLegal,
        issuingAuthorities,

        // 方法
        search,
        loadStatistics,
        loadLegalDetail,
        loadIssuingAuthorities,
        setFilters,
        resetFilters,
        setPage,
        refresh,
    }
}