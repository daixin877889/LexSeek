/**
 * 合同审查业务类型
 *
 * 约定：Prisma row 类型从 #shared/types/prisma 直接导入，不在此文件镜像。
 */

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

import type { contractReviews } from '~~/generated/prisma/client'

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
