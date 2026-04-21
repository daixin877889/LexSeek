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
}

export interface DownloadResponse {
    downloadUrl: string
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

export type StancePreference = 'strict' | 'balanced' | 'lenient'

export const STANCE_PREFERENCE_OPTIONS = ['strict', 'balanced', 'lenient'] as const

export const STANCE_PREFERENCE_LABEL: Record<StancePreference, string> = {
    strict: '严格',
    balanced: '中性',
    lenient: '宽松',
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
}

/**
 * 清单要点的快照形态（冻结在 contract_reviews.playbookSnapshot JSON 中）
 * 不直接等同于 contract_playbooks 行——后者可能被运营修改，快照不变。
 *
 * **Feature: contract-review-playbook (M7)**
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

export interface PlaybookSnapshot {
    contractType: string
    points: PlaybookPointSnapshot[]
    /** ISO 时间戳，便于 UI 显示"本审查使用清单版本快照于 YYYY-MM-DD" */
    snapshotAt: string
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
