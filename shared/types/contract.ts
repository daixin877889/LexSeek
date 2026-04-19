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
export type ReviewWithParsedRisks = Omit<contractReviews, 'risks'> & {
    risks: Risk[] | null
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

/** 管理端详情：summary 完整、risks 原样 JSON 返回，不截断、不解析 */
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
    summary: string | null
    risks: unknown
    hasUnsavedDocxChanges: boolean
    createdAt: Date
    updatedAt: Date
    deletedAt: Date | null
}
