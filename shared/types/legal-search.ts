/**
 * 法律法规搜索功能类型定义
 */

import type { LegalType, LegalMainListItem, LegalArticleInfo, LawSearchResultItem } from './legal'

// ==================== 筛选条件类型 ====================

/** 生效状态筛选值 */
export type ValidityStatus = 'all' | 'valid' | 'pending' | 'invalid'

/** 法律法规搜索筛选条件 */
export interface LegalSearchFilters {
    /** 搜索关键词 */
    keyword: string
    /** 法律类型 */
    type: LegalType | null
    /** 发文机关（单选） */
    issuingAuthority: string | null
    /** 生效状态（all: 全部, valid: 现行有效, pending: 尚未生效, invalid: 已失效） */
    validityStatus: ValidityStatus
    /** 发布日期起始 */
    publishDateFrom: string | null
    /** 发布日期结束 */
    publishDateTo: string | null
}

/** 法条搜索筛选条件 */
export interface ArticleSearchFilters {
    /** 法律类型 */
    legalType: LegalType | null
    /** 生效状态（all: 全部, valid: 现行有效, pending: 尚未生效, invalid: 已失效） */
    validityStatus: ValidityStatus
}

// ==================== 分页类型 ====================

/** 分页状态 */
export interface PaginationState {
    /** 当前页码 */
    page: number
    /** 每页数量 */
    pageSize: number
    /** 总数量 */
    total: number
    /** 总页数 */
    totalPages: number
}

// ==================== 统计类型 ====================

/** 法律法规搜索统计信息 */
export interface LegalSearchStatistics {
    /** 法律法规总数 */
    total: number
    /** 按类型统计 */
    byType: {
        /** 法律数量 */
        law: number
        /** 行政法规数量 */
        regulation: number
        /** 司法解释数量 */
        judicial_interp: number
        /** 指导意见数量 */
        guideline: number
    }
    /** 按状态统计 */
    byStatus: {
        /** 有效数量 */
        valid: number
        /** 已失效数量 */
        invalid: number
    }
}

// ==================== API 请求类型 ====================

/** 法律法规列表请求参数 */
export interface LegalListRequest {
    /** 页码 */
    page?: number
    /** 每页数量 */
    pageSize?: number
    /** 搜索关键词 */
    keyword?: string
    /** 法律类型 */
    type?: LegalType
    /** 发文机关（单选） */
    issuingAuthority?: string
    /** 生效状态 */
    validityStatus?: ValidityStatus
    /** 发布日期起始 */
    publishDateFrom?: string
    /** 发布日期结束 */
    publishDateTo?: string
    /** 排序字段 */
    sortBy?: 'publishDate' | 'effectiveDate' | 'name' | 'createdAt'
    /** 排序方向 */
    sortOrder?: 'asc' | 'desc'
}

/** 法条搜索请求参数 */
export interface ArticleSearchRequest {
    /** 搜索查询 */
    query: string
    /** 法律类型筛选 */
    legalType?: LegalType
    /** 是否只返回有效法律 */
    validOnly?: boolean
    /** 返回数量限制 */
    limit?: number
}

// ==================== API 响应类型 ====================

/** 法律法规列表响应 */
export interface LegalListResponse {
    /** 列表项 */
    items: LegalMainListItem[]
    /** 总数量 */
    total: number
    /** 当前页码 */
    page: number
    /** 每页数量 */
    pageSize: number
    /** 总页数 */
    totalPages: number
}

/** 法律法规统计响应 */
export interface LegalStatisticsResponse {
    /** 法律法规总数 */
    total: number
    /** 按类型统计 */
    byType: {
        law: number
        regulation: number
        judicial_interp: number
        guideline: number
    }
    /** 按状态统计 */
    byStatus: {
        valid: number
        invalid: number
    }
}

/** 法律法规详情响应（含条文列表） */
export interface LegalDetailResponse {
    /** 法律法规 ID */
    id: string
    /** 法律名称 */
    name: string
    /** 法律代码 */
    code: string
    /** 法律类型 */
    type: LegalType
    /** 法律分类 */
    category: string | null
    /** 法律内容 */
    content: string
    /** 发文机关 */
    issuingAuthority: string | null
    /** 文号 */
    documentNumber: string | null
    /** 发布日期 */
    publishDate: string | null
    /** 生效日期 */
    effectiveDate: string | null
    /** 失效日期 */
    invalidDate: string | null
    /** 条文列表 */
    articles: LegalArticleInfo[]
}

/** 法条搜索响应 */
export interface ArticleSearchResponse {
    /** 搜索结果 */
    items: LawSearchResultItem[]
    /** 总数量 */
    total: number
}

/** 发文机关列表响应 */
export interface IssuingAuthoritiesResponse {
    /** 发文机关列表 */
    items: string[]
}

// ==================== 前端状态类型 ====================

/** 法律法规搜索页面状态 */
export interface LegalSearchPageState {
    /** 加载状态 */
    loading: boolean
    /** 错误信息 */
    error: string | null
    /** 法律法规列表 */
    legalList: LegalMainListItem[]
    /** 统计信息 */
    statistics: LegalSearchStatistics | null
    /** 分页状态 */
    pagination: PaginationState
    /** 筛选条件 */
    filters: LegalSearchFilters
    /** 当前选中的法律法规 */
    selectedLegal: LegalDetailResponse | null
    /** 发文机关列表（用于筛选下拉） */
    issuingAuthoritiesList: string[]
}

/** 法条搜索状态 */
export interface ArticleSearchState {
    /** 加载状态 */
    loading: boolean
    /** 搜索结果 */
    results: LawSearchResultItem[]
    /** 搜索查询 */
    query: string
}
