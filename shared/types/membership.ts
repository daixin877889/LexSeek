/**
 * 会员系统类型定义
 */

/** 会员来源类型 */
export enum UserMembershipSourceType {
    /** 兑换码兑换 */
    REDEMPTION_CODE = 1,
    /** 直接购买 */
    DIRECT_PURCHASE = 2,
    /** 管理员赠送 */
    ADMIN_GIFT = 3,
    /** 活动奖励 */
    ACTIVITY_AWARD = 4,
    /** 试用 */
    TRIAL = 5,
    /** 注册赠送 */
    REGISTRATION_AWARD = 6,
    /** 邀请注册赠送 */
    INVITATION_TO_REGISTER = 7,
    /** 会员升级 */
    MEMBERSHIP_UPGRADE = 8,
    /** 其他 */
    OTHER = 99,
}

/** 会员状态 */
export enum MembershipStatus {
    /** 无效 */
    INACTIVE = 0,
    /** 有效 */
    ACTIVE = 1,
}

/** 会员级别状态 */
export enum MembershipLevelStatus {
    /** 禁用 */
    DISABLED = 0,
    /** 启用 */
    ENABLED = 1,
}

/** 权益状态 */
export enum BenefitStatus {
    /** 禁用 */
    DISABLED = 0,
    /** 启用 */
    ENABLED = 1,
}

/** 会员级别信息 */
export interface MembershipLevelInfo {
    id: number
    name: string
    description: string | null
    sortOrder: number
    status: MembershipLevelStatus
}

/** 用户会员信息 */
export interface UserMembershipInfo {
    id: number
    userId: number
    levelId: number
    levelName: string
    startDate: string
    endDate: string
    autoRenew: boolean
    status: MembershipStatus
    sourceType: UserMembershipSourceType
    sourceId: number | null
    remark: string | null
}

/** 用户权益信息 */
export interface UserBenefitInfo {
    id: number
    name: string
    description: string | null
    type: string
    value: unknown
}

/** 创建会员记录参数 */
export interface CreateMembershipParams {
    userId: number
    levelId: number
    duration: number
    sourceType: UserMembershipSourceType
    sourceId?: number
    remark?: string
}

/** 升级价格计算结果 */
export interface UpgradePriceResult {
    /** 原级别剩余价值 */
    originalRemainingValue: number
    /** 目标级别剩余价值 */
    targetRemainingValue: number
    /** 升级价格 */
    upgradePrice: number
    /** 积分补偿 */
    pointCompensation: number
}
