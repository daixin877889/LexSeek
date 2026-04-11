/**
 * URL 状态管理 Composable
 *
 * 用于将页面筛选状态同步到 URL 查询参数，实现以下功能：
 * 1. 状态持久化：筛选条件保存在 URL 中，刷新页面后状态不丢失
 * 2. 可分享性：用户可以复制 URL 分享给他人，他人打开后看到相同的筛选结果
 * 3. 浏览器导航支持：支持浏览器的前进/后退按钮
 * 4. 良好的用户体验：URL 简洁可读，参数验证完善
 */

import type { ValidityStatusFilter } from '#shared/types/legal-search'
import { VALIDITY_STATUS_FILTERS } from '#shared/types/legal-search'

/**
 * 筛选状态接口
 */
export interface FilterState {
    /** 搜索关键字 */
    keyword: string

    /** 法律类型 */
    type: 'all' | 'law' | 'regulation' | 'judicial_interp' | 'guideline'

    /** 状态筛选 */
    status: ValidityStatusFilter

    /** 发文机关 */
    issuingAuthority: string

    /** 当前页码 */
    page: number

    /** 每页数量 */
    pageSize: number
}

/**
 * URL 状态管理配置选项
 */
export interface UrlStateOptions {
    /** 默认值配置 */
    defaultValues: Partial<FilterState>

    /** 有效值配置（用于参数验证） */
    validValues?: {
        type?: string[]
        status?: string[]
    }

    /** 状态恢复后的回调函数 */
    onRestore?: (state: FilterState) => void
}

/**
 * 默认筛选状态
 */
export const DEFAULT_FILTER_STATE: FilterState = {
    keyword: '',
    type: 'all',
    status: 'all',
    issuingAuthority: '',
    page: 1,
    pageSize: 20
}

/**
 * 验证 URL 参数的有效性
 * 
 * 对 URL 查询参数进行验证和清理，确保参数值在有效范围内。
 * 对于无效的参数值，使用对应字段的默认值。
 * 
 * @param params URL 查询参数对象
 * @param options 配置选项
 * @returns 验证后的筛选状态
 */
export function validateParams(
    params: Record<string, any>,
    options: UrlStateOptions
): FilterState {
    const { defaultValues, validValues } = options

    // 合并默认值
    const defaults = { ...DEFAULT_FILTER_STATE, ...defaultValues }

    // 验证并清理 keyword（搜索关键字）
    let keyword = defaults.keyword
    if (typeof params.keyword === 'string') {
        keyword = params.keyword.trim()
    }

    // 验证并清理 type（法律类型）
    let type = defaults.type
    if (typeof params.type === 'string') {
        const validTypes = validValues?.type || ['all', 'law', 'regulation', 'judicial_interp', 'guideline']
        if (validTypes.includes(params.type)) {
            type = params.type as FilterState['type']
        } else {
            console.warn(`[useUrlState] 无效的 type 参数值: ${params.type}，使用默认值: ${defaults.type}`)
        }
    }

    // 验证并清理 status（状态筛选）
    let status = defaults.status
    if (typeof params.status === 'string') {
        const validStatuses = validValues?.status || [...VALIDITY_STATUS_FILTERS]
        if (validStatuses.includes(params.status)) {
            status = params.status as FilterState['status']
        } else {
            console.warn(`[useUrlState] 无效的 status 参数值: ${params.status}，使用默认值: ${defaults.status}`)
        }
    }

    // 验证并清理 issuingAuthority（发文机关）
    let issuingAuthority = defaults.issuingAuthority
    if (typeof params.issuingAuthority === 'string') {
        issuingAuthority = params.issuingAuthority.trim()
    }

    // 验证并清理 page（当前页码）
    let page = defaults.page
    if (params.page !== undefined) {
        const pageNum = Number(params.page)
        if (Number.isInteger(pageNum) && pageNum > 0) {
            page = pageNum
        } else {
            console.warn(`[useUrlState] 无效的 page 参数值: ${params.page}，使用默认值: ${defaults.page}`)
        }
    }

    // 验证并清理 pageSize（每页数量）
    let pageSize = defaults.pageSize
    if (params.pageSize !== undefined) {
        const pageSizeNum = Number(params.pageSize)
        // pageSize 必须是正整数且在合理范围内（10-100）
        if (Number.isInteger(pageSizeNum) && pageSizeNum >= 10 && pageSizeNum <= 100) {
            pageSize = pageSizeNum
        } else {
            console.warn(`[useUrlState] 无效的 pageSize 参数值: ${params.pageSize}，使用默认值: ${defaults.pageSize}`)
        }
    }

    return {
        keyword,
        type,
        status,
        issuingAuthority,
        page,
        pageSize
    }
}

/**
 * 将筛选状态同步到 URL 查询参数
 * 
 * 将当前的筛选状态同步到浏览器 URL 的查询参数中。
 * 为了保持 URL 简洁，等于默认值的参数不会出现在 URL 中。
 * 使用 router.replace() 更新 URL，不创建新的浏览器历史记录。
 * 
 * @param state 要同步的筛选状态（可以是部分状态）
 * @param options 配置选项
 */
export function syncToUrl(
    state: Partial<FilterState>,
    options: UrlStateOptions
): void {
    const router = useRouter()
    const { defaultValues } = options

    // 合并默认值
    const defaults = { ...DEFAULT_FILTER_STATE, ...defaultValues }

    // 构建查询参数对象
    const query: Record<string, string> = {}

    // 处理 keyword（搜索关键字）
    if (state.keyword !== undefined && state.keyword !== defaults.keyword && state.keyword !== '') {
        query.keyword = state.keyword
    }

    // 处理 type（法律类型）
    if (state.type !== undefined && state.type !== defaults.type) {
        query.type = state.type
    }

    // 处理 status（状态筛选）
    if (state.status !== undefined && state.status !== defaults.status) {
        query.status = state.status
    }

    // 处理 issuingAuthority（发文机关）
    if (state.issuingAuthority !== undefined && state.issuingAuthority !== defaults.issuingAuthority && state.issuingAuthority !== '') {
        query.issuingAuthority = state.issuingAuthority
    }

    // 处理 page（当前页码）
    if (state.page !== undefined && state.page !== defaults.page) {
        query.page = String(state.page)
    }

    // 处理 pageSize（每页数量）
    if (state.pageSize !== undefined && state.pageSize !== defaults.pageSize) {
        query.pageSize = String(state.pageSize)
    }

    // 使用 router.replace() 更新 URL（不创建新的历史记录）
    // Vue Router 会自动处理 URL 编码
    router.replace({
        query
    })
}

/**
 * 从 URL 查询参数恢复筛选状态
 * 
 * 从浏览器 URL 的查询参数中读取筛选条件，并恢复到页面状态。
 * 对 URL 参数进行验证，确保参数值在有效范围内。
 * 对于不存在或无效的参数，使用默认值。
 * 
 * @param options 配置选项
 * @returns 恢复的筛选状态
 */
export function restoreFromUrl(options: UrlStateOptions): FilterState {
    const route = useRoute()

    // 读取 URL 查询参数
    const params = route.query

    // 验证参数并返回筛选状态
    const state = validateParams(params, options)

    // 调用恢复回调（如果提供）
    if (options.onRestore) {
        options.onRestore(state)
    }

    return state
}

/**
 * URL 状态管理 Composable
 * 
 * 提供 URL 状态同步和恢复功能，用于在页面筛选条件和 URL 查询参数之间建立双向绑定。
 * 
 * @param options 配置选项
 * @returns URL 状态管理函数集合
 * 
 * @example
 * ```typescript
 * const { syncToUrl, restoreFromUrl } = useUrlState({
 *   defaultValues: {
 *     keyword: '',
 *     type: 'all',
 *     status: 'all',
 *     page: 1,
 *     pageSize: 20
 *   },
 *   validValues: {
 *     type: ['all', 'law', 'regulation'],
 *     status: ['all', 'valid', 'invalid']
 *   },
 *   onRestore: (state) => {
 *     // 恢复状态后的回调
 *     loadData()
 *   }
 * })
 * 
 * // 页面加载时恢复状态
 * onMounted(() => {
 *   const state = restoreFromUrl()
 *   // 应用状态到 UI
 * })
 * 
 * // 筛选条件变化时同步到 URL
 * watch(() => [filter.type, filter.status], () => {
 *   syncToUrl(filter)
 * })
 * ```
 */
export function useUrlState(options: UrlStateOptions) {
    return {
        /**
         * 同步状态到 URL
         */
        syncToUrl: (state: Partial<FilterState>) => syncToUrl(state, options),

        /**
         * 从 URL 恢复状态
         */
        restoreFromUrl: () => restoreFromUrl(options),

        /**
         * 验证参数
         */
        validateParams: (params: Record<string, any>) => validateParams(params, options)
    }
}
