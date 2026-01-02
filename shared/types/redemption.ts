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

// ==================== 管理员视角类型定义 ====================

/** 管理员视角的兑换码信息（扩展基础信息） */
export interface RedemptionCodeAdminInfo extends RedemptionCodeInfo {
    /** 类型名称 */
    typeName: string
    /** 状态名称 */
    statusName: string
    /** 创建时间 */
    createdAt: string
    /** 更新时间 */
    updatedAt: string
}

/** 管理员视角的兑换记录信息（扩展基础信息） */
export interface RedemptionRecordAdminInfo extends RedemptionRecordInfo {
    /** 用户名 */
    userName: string | null
    /** 用户手机号 */
    userPhone: string
    /** 类型名称 */
    typeName: string
}

/** 批量生成兑换码参数 */
export interface GenerateCodesParams {
    /** 兑换码类型 */
    type: RedemptionCodeType
    /** 生成数量（1-1000） */
    quantity: number
    /** 会员级别 ID（type=1或3时必填） */
    levelId?: number
    /** 会员时长天数（type=1或3时必填） */
    duration?: number
    /** 积分数量（type=2或3时必填） */
    pointAmount?: number
    /** 过期时间 */
    expiredAt?: Date
    /** 备注 */
    remark?: string
}

/** 批量生成兑换码结果 */
export interface GenerateCodesResult {
    /** 生成的兑换码列表 */
    codes: string[]
    /** 生成数量 */
    count: number
}

// ==================== 辅助函数 ====================

/** 获取兑换码类型名称 */
export const getRedemptionCodeTypeName = (type: RedemptionCodeType): string => {
    const typeNames: Record<RedemptionCodeType, string> = {
        [RedemptionCodeType.MEMBERSHIP_ONLY]: '仅会员',
        [RedemptionCodeType.POINTS_ONLY]: '仅积分',
        [RedemptionCodeType.MEMBERSHIP_AND_POINTS]: '会员和积分',
    }
    return typeNames[type] || '未知'
}

/** 获取兑换码状态名称 */
export const getRedemptionCodeStatusName = (status: RedemptionCodeStatus): string => {
    const statusNames: Record<RedemptionCodeStatus, string> = {
        [RedemptionCodeStatus.ACTIVE]: '有效',
        [RedemptionCodeStatus.USED]: '已使用',
        [RedemptionCodeStatus.EXPIRED]: '已过期',
        [RedemptionCodeStatus.INVALID]: '已作废',
    }
    return statusNames[status] || '未知'
}
