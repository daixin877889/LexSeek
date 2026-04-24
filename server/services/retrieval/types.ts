/**
 * 检索系统类型定义
 *
 * 统一检索路由器、各通道、Rerank 等服务的共享类型
 */

/** 检索模式 */
export type RetrievalMode = 'exact' | 'hybrid' | 'semantic'

/** 检索意图分类结果 */
export interface IntentClassification {
    intent: RetrievalMode
    legalName?: string
    articleRef?: string
    keywords?: string[]
    rewrittenQuery?: string
}

/** 日期过滤条件 */
export interface DateFilter {
    date: string // ISO 格式日期: YYYY-MM-DD
    operator: '>' | '<' | '=' | '>=' | '<='
}

/** 后处理过滤条件（检索结果返回后在内存中过滤） */
export interface PostFilters {
    isEffective?: boolean
    invalidDateFilter?: DateFilter
    publishDateFilter?: DateFilter
    effectiveDateFilter?: DateFilter
}

/** 检索请求 */
export interface RetrievalRequest {
    query: string
    type: 'law' | 'case_material' | 'case_memory' | 'case_analysis'
    k: number
    /** 简单等值过滤（key=value），由 buildParameterizedMetadataFilter 处理 */
    metadataFilter?: Record<string, string | number | boolean>
    /** sourceId IN 过滤（案件材料检索用），由各通道内部构建 SQL IN 条件 */
    sourceIds?: string[]
    /** 后处理过滤（日期范围、有效性等），在检索结果返回后内存中过滤 */
    postFilters?: PostFilters
}

/** 检索结果 */
export interface RetrievalResult {
    content: string
    score: number
    metadata: Record<string, unknown>
    retrievalMode: RetrievalMode
}

/** 内部搜索结果（BM25/Vector 通道共用） */
export interface SearchResultItem {
    score: number
    content: string
    metadata: Record<string, unknown>
}

/** 允许查询的表名白名单 */
export const ALLOWED_TABLES = new Set(['law_embeddings', 'case_material_embeddings', 'case_memories', 'case_analysis_embeddings'])

/** 允许的 metadata 过滤字段白名单 */
export const ALLOWED_METADATA_KEYS = new Set([
    'legal_id', 'legal_name', 'legal_type', 'article_type',
    'userId', 'sourceId', 'source',
    'caseId', 'kind', 'subjectKey', 'confidence', 'supersedes', 'invalidatedAt', 'isActive', 'analysisId', 'analysisType',
])
