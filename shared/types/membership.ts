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
    /** 已结算（会员升级时旧记录状态） */
    SETTLED = 2,
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
    sourceTypeName: string
    sourceId: number | null
    remark: string | null
    createdAt: string
    /** 结算时间（会员升级时记录） */
    settlementAt: string | null
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
    /** 时长单位：day-天，month-月，year-年 */
    durationUnit?: 'day' | 'month' | 'year'
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
    /** 计算详情（用于 UI 展示） */
    calculationDetails: {
        /** 实付金额 */
        paidAmount: number
        /** 套餐总天数 */
        totalDays: number
        /** 剩余天数 */
        remainingDays: number
        /** 日均价值（实付金额/总天数） */
        dailyValue: number
        /** 目标年价 */
        targetYearlyPrice: number
        /** 目标日均价值（目标年价/365） */
        targetDailyValue: number
    }
}

/** 升级详情中的旧会员信息 */
export interface UpgradeDetailsOldMembership {
    id: number
    levelId: number
    levelName: string
    startDate: string
    endDate: string
    settlementDate: string
}

/** 升级详情中的新会员信息 */
export interface UpgradeDetailsNewMembership {
    id: number
    levelId: number
    levelName: string
    startDate: string
    endDate: string
}

/** 升级详情中的旧积分记录信息 */
export interface UpgradeDetailsOldPointRecord {
    id: number
    remaining: number
    transferOut: number
    transferToRecordId: number
}

/** 升级详情中的新积分记录信息 */
export interface UpgradeDetailsNewPointRecords {
    transferRecordId: number | null
    compensationRecordId: number | null
}

/** 会员升级详情（存储在 membership_upgrade_records.details 字段） */
export interface UpgradeDetails {
    oldMembership: UpgradeDetailsOldMembership
    newMembership: UpgradeDetailsNewMembership
    oldPointRecords: UpgradeDetailsOldPointRecord[]
    newPointRecords: UpgradeDetailsNewPointRecords
}
