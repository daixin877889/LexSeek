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
