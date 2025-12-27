/**
 * 兑换码类型定义
 */

/** 兑换码类型 */
export enum RedemptionCodeType {
    /** 仅会员 */
    MEMBERSHIP_ONLY = 1,
    /** 仅积分 */
    POINTS_ONLY = 2,
    /** 会员和积分 */
    MEMBERSHIP_AND_POINTS = 3,
}

/** 兑换码状态 */
export enum RedemptionCodeStatus {
    /** 有效 */
    ACTIVE = 1,
    /** 已使用 */
    USED = 2,
    /** 已过期 */
    EXPIRED = 3,
    /** 已作废 */
    INVALID = 4,
}

/** 兑换码信息 */
export interface RedemptionCodeInfo {
    id: number
    code: string
    type: RedemptionCodeType
    levelId: number | null
    levelName: string | null
    duration: number | null
    pointAmount: number | null
    expiredAt: string | null
    status: RedemptionCodeStatus
    remark: string | null
}

/** 兑换记录信息 */
export interface RedemptionRecordInfo {
    id: number
    userId: number
    codeId: number
    code: string
    type: RedemptionCodeType
    levelName: string | null
    duration: number | null
    pointAmount: number | null
    createdAt: string
}

/** 创建兑换码参数 */
export interface CreateRedemptionCodeParams {
    code: string
    type: RedemptionCodeType
    levelId?: number
    duration?: number
    pointAmount?: number
    expiredAt?: Date
    remark?: string
}

/** 兑换结果 */
export interface RedemptionResult {
    success: boolean
    membershipId?: number
    pointRecordId?: number
    message?: string
}
