/**
 * 法律知识库类型定义
 */

/** 法律类型枚举 */
export enum LegalType {
    /** 法律 */
    LAW = 'law',
    /** 行政法规 */
    REGULATION = 'regulation',
    /** 司法解释 */
    JUDICIAL_INTERP = 'judicial_interp',
    /** 指导意见 */
    GUIDELINE = 'guideline',
}

/** 法律类型显示名称映射 */
export const LegalTypeLabels: Record<LegalType, string> = {
    [LegalType.LAW]: '法律',
    [LegalType.REGULATION]: '行政法规',
    [LegalType.JUDICIAL_INTERP]: '司法解释',
    [LegalType.GUIDELINE]: '指导意见',
}

/** 条文类型枚举 */
export enum ArticleType {
    /** 通知 */
    NOTICE = 'notice',
    /** 正文头部 */
    HEADER = 'header',
    /** 正文尾部 */
    FOOTER = 'footer',
    /** 附件 */
    ANNEX = 'annex',
    /** 一级标题(编) */
    L1 = 'l1',
    /** 二级标题(分编) */
    L2 = 'l2',
    /** 三级标题(章) */
    L3 = 'l3',
    /** 四级标题(节) */
    L4 = 'l4',
    /** 五级标题(条) */
    L5 = 'l5',
}

/** 条文类型显示名称映射 */
export const ArticleTypeLabels: Record<ArticleType, string> = {
    [ArticleType.NOTICE]: '通知',
    [ArticleType.HEADER]: '正文头部',
    [ArticleType.FOOTER]: '正文尾部',
    [ArticleType.ANNEX]: '附件',
    [ArticleType.L1]: '编',
    [ArticleType.L2]: '分编',
    [ArticleType.L3]: '章',
    [ArticleType.L4]: '节',
    [ArticleType.L5]: '条',
}

/** 法律法规基础信息 */
export interface LegalMainInfo {
    id: string
    name: string
    code: string
    type: LegalType
    category: string | null
    content: string
    issuingAuthority: string | null
    documentNumber: string | null
    publishDate: string | null
    effectiveDate: string | null
    invalidDate: string | null
    lastEditedAt: string | null
    lastEmbeddingAt: string | null
    createdAt: string | null
    updatedAt: string | null
}

/** 法律法规列表项（不含 content） */
export interface LegalMainListItem {
    id: string
    name: string
    code: string
    type: LegalType
    category: string | null
    issuingAuthority: string | null
    documentNumber: string | null
    publishDate: string | null
    effectiveDate: string | null
    invalidDate: string | null
    lastEditedAt: string | null
    lastEmbeddingAt: string | null
    createdAt: string | null
}

/** 法律条文信息 */
export interface LegalArticleInfo {
    id: string
    legalId: string
    type: ArticleType
    l1: string | null
    l1I: number | null
    l2: string | null
    l2I: number | null
    l3: string | null
    l3I: number | null
    l4: string | null
    l4I: number | null
    l5: string | null
    l5I: number | null
    order: number | null
    content: string | null
    publishDate: string | null
    effectiveDate: string | null
    invalidDate: string | null
    lastEditedAt: string | null
    lastEmbeddingAt: string | null
    createdAt: string | null
}

/** 法律条文列表项（含层级路径） */
export interface LegalArticleListItem extends LegalArticleInfo {
    /** 层级路径，如 "第一编 > 第一章 > 第一条" */
    hierarchyPath: string
    /** 是否已嵌入 */
    isEmbedded: boolean
}

/** 创建法律法规请求参数 */
export interface CreateLegalMainRequest {
    name: string
    code: string
    type: LegalType
    category?: string | null
    content: string
    issuingAuthority?: string | null
    documentNumber?: string | null
    publishDate?: string | null
    effectiveDate?: string | null
    invalidDate?: string | null
}

/** 更新法律法规请求参数 */
export interface UpdateLegalMainRequest {
    name?: string
    code?: string
    type?: LegalType
    category?: string | null
    content?: string
    issuingAuthority?: string | null
    documentNumber?: string | null
    publishDate?: string | null
    effectiveDate?: string | null
    invalidDate?: string | null
}

/** 创建法律条文请求参数 */
export interface CreateLegalArticleRequest {
    legalId: string
    type: ArticleType
    l1?: string | null
    l1I?: number | null
    l2?: string | null
    l2I?: number | null
    l3?: string | null
    l3I?: number | null
    l4?: string | null
    l4I?: number | null
    l5?: string | null
    l5I?: number | null
    order?: number | null
    content?: string | null
    publishDate?: string | null
    effectiveDate?: string | null
    invalidDate?: string | null
}

/** 更新法律条文请求参数 */
export interface UpdateLegalArticleRequest {
    type?: ArticleType
    l1?: string | null
    l1I?: number | null
    l2?: string | null
    l2I?: number | null
    l3?: string | null
    l3I?: number | null
    l4?: string | null
    l4I?: number | null
    l5?: string | null
    l5I?: number | null
    order?: number | null
    content?: string | null
    publishDate?: string | null
    effectiveDate?: string | null
    invalidDate?: string | null
}

/** 法律法规列表查询参数 */
export interface LegalMainListQuery {
    page?: number
    pageSize?: number
    keyword?: string
    type?: LegalType
    issuingAuthority?: string
    sortBy?: 'createdAt' | 'publishDate' | 'effectiveDate' | 'name'
    sortOrder?: 'asc' | 'desc'
}

/** 法律条文列表查询参数 */
export interface LegalArticleListQuery {
    legalId: string
    page?: number
    pageSize?: number
    /** 条文类型筛选 */
    type?: ArticleType
    /** 关键词搜索（搜索内容、层级路径、L1-L5 标题） */
    keyword?: string
    /** L1 标题筛选 */
    l1?: string
    /** L2 标题筛选 */
    l2?: string
    /** L3 标题筛选 */
    l3?: string
    /** L4 标题筛选 */
    l4?: string
    /** L5 标题筛选 */
    l5?: string
}

/** 分页响应 */
export interface PaginatedResponse<T> {
    items: T[]
    total: number
    page: number
    pageSize: number
    totalPages: number
}

/** 法律嵌入元数据 */
export interface LawEmbeddingMetadata {
    /** 条文 ID */
    articleId: string
    /** 法律 ID */
    legalId: string
    /** 法律名称 */
    legalName: string
    /** 法律代码 */
    legalCode: string
    /** 法律类型 */
    legalType: LegalType
    /** 条文类型 */
    articleType: ArticleType
    /** 层级路径 */
    hierarchyPath: string
    /** 发布日期 */
    publishDate: string | null
    /** 生效日期 */
    effectiveDate: string | null
    /** 失效日期 */
    invalidDate: string | null
    /** 是否有效 */
    isValid: boolean
}

/** 法律搜索参数 */
export interface LawSearchParams {
    /** 搜索查询 */
    query: string
    /** 搜索模式：vector-向量搜索，sql-SQL筛选 */
    mode?: 'vector' | 'sql'
    /** 法律类型筛选 */
    legalType?: LegalType
    /** 发文机关筛选 */
    issuingAuthority?: string
    /** 生效日期起始 */
    effectiveDateFrom?: string
    /** 生效日期结束 */
    effectiveDateTo?: string
    /** 是否只返回有效法律 */
    validOnly?: boolean
    /** 返回数量限制 */
    limit?: number
    /** 偏移量 */
    offset?: number
}

/** 法律搜索结果项 */
export interface LawSearchResultItem {
    /** 条文 ID */
    articleId: string
    /** 法律 ID */
    legalId: string
    /** 法律名称 */
    legalName: string
    /** 法律代码 */
    legalCode: string
    /** 条文内容 */
    content: string
    /** 层级路径 */
    hierarchyPath: string
    /** 相似度分数（向量搜索时） */
    score?: number
    /** 元数据 */
    metadata: LawEmbeddingMetadata
}

/** 法律搜索结果 */
export interface LawSearchResult {
    items: LawSearchResultItem[]
    total: number
    mode: 'vector' | 'sql'
}


/** 排序树节点 */
export interface SortTreeNode {
    /** 条文 ID */
    id: string
    /** 条文类型 */
    type: ArticleType
    /** 显示标题 */
    title: string
    /** 排序序号 */
    order: number | null
    /** 子节点数量（折叠时显示） */
    childCount: number
    /** 子节点（展开时加载） */
    children?: SortTreeNode[]
    /** 层级深度（0-4） */
    depth: number
    /** 层级路径标识，用于确定父子关系 */
    pathKey: string
}

/** 批量排序请求项 */
export interface BatchSortItem {
    /** 条文 ID */
    id: string
    /** 新的排序序号 */
    order: number
}

/** 批量排序请求 */
export interface BatchSortRequest {
    /** 法律 ID */
    legalId: string
    /** 排序项列表 */
    items: BatchSortItem[]
}

/** 排序树查询参数 */
export interface SortTreeQuery {
    /** 法律 ID */
    legalId: string
    /** 父级路径（用于懒加载子节点） */
    parentPath?: string
    /** 父级类型 */
    parentType?: ArticleType
}


/** 法律嵌入记录信息 */
export interface LawEmbeddingInfo {
    /** 嵌入记录 ID */
    id: string
    /** 嵌入文本内容 */
    text: string | null
    /** 元数据 */
    metadata: LawEmbeddingMetadata | null
    /** 最后嵌入时间（从元数据中提取） */
    lastEmbeddingAt: string | null
}

/** 法律嵌入列表查询参数 */
export interface LawEmbeddingListQuery {
    /** 法律 ID */
    legalId: string
    /** 条文 ID（可选，筛选特定条文的嵌入） */
    articleId?: string
    /** 页码 */
    page?: number
    /** 每页数量 */
    pageSize?: number
}

/** 更新嵌入元数据请求 */
export interface UpdateEmbeddingMetadataRequest {
    /** 是否有效 */
    isValid?: boolean
    /** 失效日期 */
    invalidDate?: string | null
}

/** 法律法规统计信息 */
export interface LegalStatistics {
    /** 条文总数 */
    totalArticles: number
    /** 已向量化条文数 */
    embeddedArticles: number
    /** 未向量化条文数 */
    notEmbeddedArticles: number
    /** 各类型条文数量分布 */
    articlesByType: {
        /** 编 */
        l1: number
        /** 分编 */
        l2: number
        /** 章 */
        l3: number
        /** 节 */
        l4: number
        /** 条 */
        l5: number
        /** 通知 */
        notice: number
        /** 正文头部 */
        header: number
        /** 正文尾部 */
        footer: number
        /** 附件 */
        annex: number
    }
    /** 最后编辑时间 */
    lastEditedAt: string | null
    /** 最后向量化时间 */
    lastEmbeddingAt: string | null
}
