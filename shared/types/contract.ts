/**
 * 合同审查业务类型
 *
 * 约定：Prisma row 类型从 #shared/types/prisma 直接导入，不在此文件镜像。
 */

import type { contractReviews } from '~~/generated/prisma/client'

export type RiskLevel = 'high' | 'medium' | 'low'
export type Stance = 'partyA' | 'partyB' | 'neutral'
export type ContractReviewStatus =
    | 'pending'
    | 'reviewing'
    | 'awaiting_stance'
    | 'completed'
    | 'rebuilding'           // ← M5 新增（DB 临时态；不进状态机主图，对齐 spec §8.4）
    | 'failed'

/**
 * 合同类型候选集。
 *
 * 仅作为 LLM prompt 的提示词使用（"从这些里选一个或返回其它"）；
 * DB 存储为 varchar(50) 不加约束，允许 LLM 在必要时输出新类型。
 * 所有引用这个列表的代码（如 partyDetector 的 prompt 模板）都应从这里导入，
 * 避免枚举硬编码在多处形成偏差。
 */
export const CONTRACT_TYPE_OPTIONS = [
    '劳动合同',
    '租赁合同',
    '买卖合同',
    '服务合同',
    '借款合同',
    '保密协议',
    '其他',
] as const

/** 单条风险（存 contractReviews.risks JSON 字段；schema 层 refine 强制 high/medium 必含 suggestedClauseText） */
export interface Risk {
    id: string
    clauseIndex: number
    clauseText: string
    level: RiskLevel
    category: string
    problem: string
    legalBasis?: string
    analysis: string
    risk: string
    suggestion: string
    suggestedClauseText?: string
    /** 命中的要点 code；清单外风险留空（M7 Playbook） */
    matchedPointCode?: string
}

/**
 * Phase A：RiskListPanel 消费的 Risk 显示类型扩展。
 * 在 Risk 基础上注入 archivedStatus（工作区处置状态）和 entityId（ContractRisk 数据库主键）。
 * 用于 ContractReviewPanel 把 ContractRiskEntity 映射给 RiskListPanel 时保留处置态。
 */
export type RiskDisplay = Risk & {
    archivedStatus?: RiskArchivedStatus | null
    entityId?: number
}

export interface CreateReviewRequest {
    sourceType: 'upload' | 'paste'
    ossFileId?: number
    text?: string
    /** 可选：归属案件 id；传入后校验案件属于当前用户，写入 contractReviews.caseId */
    caseId?: number
}

export interface CreateReviewResponse {
    reviewId: number
    sessionId: string
}

export interface StanceRequest {
    stance: Stance
    partyA?: string
    partyB?: string
}

export interface PatchReviewRequest {
    risks: Risk[]
}

export interface RebuildDocxResponse {
    reviewedFileId: number
    downloadUrl: string
    /** spec §4.4: {合同名}_{版本号或"工作区"}_{日期}.docx */
    filename: string
}

export interface DownloadResponse {
    downloadUrl: string
    /** spec §4.4: {合同名}_{版本号或"工作区"}_{日期}.docx */
    filename: string
}

/**
 * 审查实体（已将 Prisma JsonValue risks 收敛到 Risk[] 类型）。
 *
 * 用于前端与管理层拆包后传给组件：M4 Task 2 评审 I3 登记，M5 落地。
 * 后端 API 层统一在返回前把 `risks: Json` 当成 `Risk[] | null` 使用，
 * 前端即可免去 `as Risk[]` 散落。
 */
export type ReviewWithParsedRisks = Omit<contractReviews, 'risks' | 'summary'> & {
    risks: Risk[] | null
    summary: ContractOverview | null
}

/**
 * 仅 completed 状态允许编辑 risks / 重生批注。
 * pending / reviewing / awaiting_stance / failed / rebuilding 均返回 409。
 */
export const REVIEW_EDITABLE_STATUSES: readonly ContractReviewStatus[] = ['completed'] as const

export const REVIEW_STATUS_LABEL: Record<ContractReviewStatus, string> = {
    pending: '待处理',
    reviewing: '审查中',
    awaiting_stance: '等待立场',
    completed: '已完成',
    rebuilding: '重建中',
    failed: '失败',
}

export const STANCE_LABEL: Record<Stance, string> = {
    partyA: '甲方',
    partyB: '乙方',
    neutral: '中立',
}

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
    high: '高',
    medium: '中',
    low: '低',
}

// ==================== 列表/详情 DTO（用户端 + 管理端共享） ====================

/** 用户端列表项（无 userId / deletedAt 等超管字段） */
export interface ReviewListItem {
    id: number
    sessionId: string
    caseId: number | null
    contractType: string | null
    partyA: string | null
    partyB: string | null
    stance: string | null
    status: string
    summary: string | null
    originalFileName: string | null
    hasUnsavedDocxChanges: boolean
    /** 高风险条目数（后端从 risks JSONB 派生，列表页用于展示） */
    highRiskCount: number
    /** 中风险条目数 */
    mediumRiskCount: number
    /** 总风险数 */
    totalRiskCount: number
    createdAt: Date
    updatedAt: Date
}

/** 管理端列表项：在用户端基础上补充用户归属与软删时间 */
export type AdminReviewListItem = ReviewListItem & {
    userId: number
    userPhone: string | null
    userNickname: string | null
    deletedAt: Date | null
}

/**
 * 管理端详情：summary 按结构化形态返回（M6.1 Task 1.3 起字段类型已升级为 Json），
 * risks 原样 JSON 返回，不截断、不解析
 */
export interface AdminReviewDetail {
    id: number
    sessionId: string
    userId: number
    userPhone: string | null
    userNickname: string | null
    originalFileId: number
    originalFileName: string | null
    reviewedFileId: number | null
    reviewedFileName: string | null
    contractType: string | null
    partyA: string | null
    partyB: string | null
    stance: string | null
    status: string
    summary: ContractOverview | null
    risks: unknown
    hasUnsavedDocxChanges: boolean
    createdAt: Date
    updatedAt: Date
    deletedAt: Date | null
}

// ==================== M6.1 ====================

/**
 * 分档总览（contractReviews.summary 升级为 JSON 后的结构）
 *
 * - counts / score / scoreLabel 三个派生值不进 schema，由前端 useContractOverview 实时派生
 * - highlights 为 null 时说明"历史数据"或"summarize 未完成"，前端降级为只显示卡片列表
 */
export interface ContractOverview {
    /** 分档要点，每档 1-5 条，挂 riskId 用于可点跳转 */
    highlights: {
        high: Array<{ text: string; riskId: string }>
        medium: Array<{ text: string; riskId: string }>
        low: Array<{ text: string; riskId: string }>
    } | null
    /** 总评（后端 LLM 生成，≤120 字）。历史 M4/M5 的 string 迁移后填这个字段 */
    overall: string
}

/**
 * 条款切分结果（仅在 workflow 内存中流转，不落库）
 */
export interface ClauseSegment {
    /** 顺序号，从 1 开始 */
    index: number
    /** 条款编号文本，如 "3.2"、"第五条"、null（无标号散段） */
    number: string | null
    /** 条款正文 */
    text: string
    /** Phase B：该条款在 docxText 中的起始字符偏移（闭区间） */
    offsetStart: number
    /** Phase B：该条款在 docxText 中的结束字符偏移（开区间，即 offsetStart + text.length） */
    offsetEnd: number
}

/**
 * 合同审查的 SSE 自定义事件联合（经 publishCustomEvent 发出，前端 onCustomEvent 接收）
 *
 * 只有 4 种 type：
 *  - stage：阶段状态切换（running / done），done 事件可能携带阶段产出
 *  - progress：分析进度，单条失败走可选 error 字段
 *  - risk：增量 risk（子期 2 才开始用）
 *  - overview：汇总总览（子期 3 才开始用）
 */
export type ContractReviewEvent =
    | {
        type: 'stage'
        stage: 'detect' | 'stance' | 'segment' | 'analyze' | 'summarize'
        status: 'running' | 'done'
        /** analyze 阶段累积的非致命失败 */
        warnings?: string[]
        /** segment 阶段 done 时携带 */
        totalClauses?: number
        /** detect 阶段 done 时携带 */
        partyA?: string
        partyB?: string
        contractType?: string
    }
    | { type: 'progress'; current: number; total: number; error?: string }
    | { type: 'risk'; risk: Risk }
    | { type: 'overview'; overview: ContractOverview }

// ==================== M7 Playbook ====================

/**
 * 要点客观严格度
 * - strict：从严解读，保护当事人利益
 * - balanced：均衡解读（默认）
 * - lenient：从宽解读，减少过度风险标记
 */
export type StancePreference = 'strict' | 'balanced' | 'lenient'

export const STANCE_PREFERENCE_OPTIONS = ['strict', 'balanced', 'lenient'] as const

export const STANCE_PREFERENCE_LABEL: Record<StancePreference, string> = {
    strict: '严格',
    balanced: '中性',
    lenient: '宽松',
}

/**
 * 写入 contractReviews.playbookSnapshot 的单条快照结构。
 * 字段对齐 contractPlaybooks，仅取快照写入所需字段。
 */
export interface PlaybookPointSnapshot {
    code: string
    title: string
    defaultLevel: 'high' | 'medium' | 'low'
    stancePreference: StancePreference
    checkContent: string
    legalBasis?: string
    suggestion?: string
}

/**
 * 冻结在 contract_reviews.playbookSnapshot JSON 中的完整快照。
 * 运营后续修改 contract_playbooks 不影响历史审查的快照数据。
 */
export interface PlaybookSnapshot {
    contractType: string
    points: PlaybookPointSnapshot[]
    /** ISO 时间戳，便于 UI 显示"本审查使用清单版本快照于 YYYY-MM-DD" */
    snapshotAt: string
}

/**
 * Phase B：版本快照 clauses 数组的元素类型。
 * 是 ClauseSegment 的持久化子集（去掉 number 字段，只保留 diff/定位所需字段）。
 * SaveVersionInput.clauses、persistRisksAndCreateV1Snapshot 等凡写入或读取 snapshot.clauses
 * 的地方都应使用此类型，避免内联重复。
 */
export interface ClauseSnapshotItem {
    index: number
    text: string
    offsetStart: number
    offsetEnd: number
}

// ===== 多版本：枚举 =====
// Phase A 只声明当前用到的值；Phase B/C 扩展时再加
export const VERSION_SYSTEM_LABELS = [
    'initial_upload',
    'lawyer_save',
    'client_return',
    'auto_backup',
] as const
export type VersionSystemLabel = typeof VERSION_SYSTEM_LABELS[number]

export const VERSION_SYSTEM_LABEL_DISPLAY: Record<VersionSystemLabel, string> = {
    initial_upload: '初次上传',
    lawyer_save: '律师保存',
    client_return: '客户回传',
    auto_backup: '自动备份',
}

export const RISK_SOURCES = ['ai', 'external_new', 'global_review'] as const
export type RiskSource = typeof RISK_SOURCES[number]

export const ANNOTATION_AUTHOR_TYPES = ['ai', 'lawyer', 'external'] as const
export type AnnotationAuthorType = typeof ANNOTATION_AUTHOR_TYPES[number]

export const RISK_ARCHIVED_STATUSES = ['handled', 'ignored'] as const  // Phase B 加 'client_removed'
export type RiskArchivedStatus = typeof RISK_ARCHIVED_STATUSES[number]

// ===== 多版本：实体 =====
export interface ContractRiskEntity {
    id: number
    reviewId: number
    source: RiskSource
    code: string | null
    category: string
    level: RiskLevel
    stance: StancePreference
    problem: string
    legalBasis: string | null
    analysis: string | null
    suggestion: string | null
    archivedStatus: RiskArchivedStatus | null
    archivedAt: string | null
    anchorQuote: string
    anchorParagraphIndex: number | null
    anchorCharStart: number | null
    anchorCharEnd: number | null
    createdAt: string
    updatedAt: string
    // Phase B
    originalAnchorQuote: string | null
    orphaned: boolean
}

export interface ContractAnnotationEntity {
    id: number
    reviewId: number
    riskId: number
    parentAnnotationId: number | null
    authorType: AnnotationAuthorType
    authorName: string
    authorUserId: number | null
    content: string
    createdAt: string
    // 软删的批注不出现在 API 响应中（service 层过滤 deletedAt IS NULL）
    // Phase B
    wordCommentRef: string | null
    removedByClient: boolean
    suppressInExport: boolean
}

export interface ContractReviewVersionEntity {
    id: number
    reviewId: number
    versionNumber: number
    systemLabel: VersionSystemLabel
    lawyerNote: string | null
    createdById: number
    createdByName: string
    createdAt: string
    // Phase B
    docxFileId: number | null
    // Phase B 再加 stats（变更徽章用）
}

/** 版本列表响应（不含 snapshotData，只有元信息） */
export interface ContractReviewVersionListResponse {
    versions: ContractReviewVersionEntity[]
    currentVersionId: number | null
    maxVersionNo: number
}

/** 版本快照响应（包含完整 snapshot 内容用于只读渲染） */
export interface ContractReviewVersionSnapshotResponse extends ContractReviewVersionEntity {
    snapshot: {
        risks: ContractRiskEntity[]
        annotations: ContractAnnotationEntity[]
        docxText: string
        /** Phase B：条款切分结果，含字符偏移，未落库时为空数组 */
        clauses: ClauseSnapshotItem[]
    }
}

// ===== Phase B：客户回传版本上传 SSE 事件 =====

export const CONTRACT_UPLOAD_VERSION_SSE_EVENT = {
    PROGRESS: 'upload-version-progress',
    COMPLETE: 'upload-version-complete',
    ERROR: 'upload-version-error',
} as const

export type UploadVersionStep = 'backup' | 'parse' | 'diff' | 'ai' | 'merge'
export type UploadVersionStatus = 'done' | 'progress'

export interface UploadVersionProgressData {
    step: UploadVersionStep
    status: UploadVersionStatus
    externalChangeCount?: number
    clauseModifiedCount?: number
    total?: number
    current?: number
    newVersionId?: number
}

export interface UploadVersionCompleteData {
    newVersionId: number
    summary: string
}

export interface UploadVersionErrorData {
    step: UploadVersionStep
    code: string
    message: string
}
