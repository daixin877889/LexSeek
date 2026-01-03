/**
 * 权益系统类型定义
 */

/** 权益标识码 */
export enum BenefitCode {
    /** 云盘空间 */
    STORAGE_SPACE = 'storage_space',
    // 预留：日案件分析限额
    // DAILY_ANALYSIS_QUOTA = 'daily_analysis_quota',
    // 预留：月案件分析限额
    // MONTHLY_ANALYSIS_QUOTA = 'monthly_analysis_quota',
    // 预留：案件分析并发数
    // ANALYSIS_CONCURRENCY = 'analysis_concurrency',
}

/** 权益单位类型 */
export enum BenefitUnitType {
    /** 字节 */
    BYTE = 'byte',
    /** 次数 */
    COUNT = 'count',
}

/** 权益计算模式 */
export enum BenefitConsumptionMode {
    /** 累加（如云盘空间） */
    SUM = 'sum',
    /** 取最大值（如并发数） */
    MAX = 'max',
}

/** 权益来源类型 */
export enum BenefitSourceType {
    /** 会员赠送 */
    MEMBERSHIP_GIFT = 'membership_gift',
    /** 权益包购买 */
    BENEFIT_PACKAGE = 'benefit_package',
    /** 兑换码兑换 */
    REDEMPTION_CODE = 'redemption_code',
    /** 管理员赠送 */
    ADMIN_GIFT = 'admin_gift',
}

/** 用户权益状态 */
export enum UserBenefitStatus {
    /** 无效 */
    INACTIVE = 0,
    /** 有效 */
    ACTIVE = 1,
}

/** 格式化后的权益展示信息 */
export interface BenefitFormattedInfo {
    /** 总额（格式化后，如 "10 GB"） */
    total: string
    /** 已使用（格式化后，如 "1.5 GB"） */
    used: string
    /** 剩余（格式化后，如 "8.5 GB"） */
    remaining: string
    /** 使用率百分比（0-100） */
    percentage: number
}

/** 用户权益汇总信息 */
export interface UserBenefitSummary {
    /** 权益标识码 */
    code: string
    /** 权益名称 */
    name: string
    /** 权益总额（原始值） */
    totalValue: number
    /** 已使用量（原始值） */
    usedValue: number
    /** 剩余量（原始值） */
    remainingValue: number
    /** 单位类型 */
    unitType: string
    /** 格式化后的展示值 */
    formatted: BenefitFormattedInfo
}

/** 云盘空间配额信息 */
export interface StorageQuotaInfo {
    /** 总字节数 */
    totalBytes: number
    /** 已使用字节数 */
    usedBytes: number
    /** 剩余字节数 */
    remainingBytes: number
    /** 格式化后的展示值 */
    formatted: BenefitFormattedInfo
}

/** 云盘空间校验结果 */
export interface StorageQuotaCheckResult {
    /** 是否允许上传 */
    allowed: boolean
    /** 配额信息 */
    quota: StorageQuotaInfo
    /** 需要的空间大小（字节） */
    requiredSize: number
    /** 需要的空间大小（格式化后） */
    requiredFormatted: string
    /** 错误信息（空间不足时） */
    message?: string
}

/** 用户权益记录（用于详情展示） */
export interface UserBenefitRecord {
    /** 记录ID */
    id: number
    /** 权益值 */
    benefitValue: number
    /** 来源类型 */
    sourceType: string
    /** 来源类型名称 */
    sourceTypeName: string
    /** 生效时间 */
    effectiveAt: string
    /** 过期时间 */
    expiredAt: string
    /** 状态 */
    status: number
}

/** 用户权益详情响应 */
export interface UserBenefitDetailResponse {
    /** 权益标识码 */
    code: string
    /** 权益名称 */
    name: string
    /** 权益总额（原始值） */
    totalValue: number
    /** 已使用量（原始值） */
    usedValue: number
    /** 剩余量（原始值） */
    remainingValue: number
    /** 单位类型 */
    unitType: string
    /** 格式化后的展示值 */
    formatted: BenefitFormattedInfo
    /** 权益记录列表 */
    records: UserBenefitRecord[]
}

/** 权益来源类型名称映射 */
export const BenefitSourceTypeName: Record<string, string> = {
    [BenefitSourceType.MEMBERSHIP_GIFT]: '会员赠送',
    [BenefitSourceType.BENEFIT_PACKAGE]: '权益包购买',
    [BenefitSourceType.REDEMPTION_CODE]: '兑换码兑换',
    [BenefitSourceType.ADMIN_GIFT]: '管理员赠送',
}

// ==================== 后台管理类型定义 ====================

/** 权益状态名称映射 */
export const BenefitStatusNames: Record<number, string> = {
    1: '启用',
    0: '禁用',
}

/** 用户权益状态名称映射 */
export const UserBenefitStatusNames: Record<number, string> = {
    1: '有效',
    0: '无效',
}

/** 单位类型名称映射 */
export const BenefitUnitTypeNames: Record<string, string> = {
    [BenefitUnitType.BYTE]: '字节',
    [BenefitUnitType.COUNT]: '次数',
}

/** 计算模式名称映射 */
export const BenefitConsumptionModeNames: Record<string, string> = {
    [BenefitConsumptionMode.SUM]: '累加',
    [BenefitConsumptionMode.MAX]: '取最大值',
}

/** 后台权益类型信息 */
export interface BenefitAdminInfo {
    /** 权益ID */
    id: number
    /** 权益标识码 */
    code: string
    /** 权益名称 */
    name: string
    /** 权益描述 */
    description: string | null
    /** 单位类型 */
    unitType: string
    /** 单位类型名称 */
    unitTypeName: string
    /** 计算模式 */
    consumptionMode: string
    /** 计算模式名称 */
    consumptionModeName: string
    /** 默认值（字符串形式） */
    defaultValue: string
    /** 格式化后的默认值 */
    formattedDefaultValue: string
    /** 状态：1-启用，0-禁用 */
    status: number
    /** 状态名称 */
    statusName: string
    /** 创建时间 */
    createdAt: string
    /** 更新时间 */
    updatedAt: string
}

/** 会员级别权益配置项 */
export interface MembershipBenefitItem {
    /** 权益ID */
    benefitId: number
    /** 权益标识码 */
    benefitCode: string
    /** 权益名称 */
    benefitName: string
    /** 权益值（字符串形式） */
    benefitValue: string
    /** 格式化后的权益值 */
    formattedValue: string
    /** 单位类型 */
    unitType: string
}

/** 会员级别权益配置信息 */
export interface MembershipBenefitConfig {
    /** 会员级别ID */
    levelId: number
    /** 会员级别名称 */
    levelName: string
    /** 权益配置列表 */
    benefits: MembershipBenefitItem[]
}

/** 用户权益记录（管理员视图） */
export interface UserBenefitRecordAdmin {
    /** 记录ID */
    id: number
    /** 权益ID */
    benefitId: number
    /** 权益名称 */
    benefitName: string
    /** 权益标识码 */
    benefitCode: string
    /** 权益值（字符串形式） */
    benefitValue: string
    /** 格式化后的权益值 */
    formattedValue: string
    /** 来源类型 */
    sourceType: string
    /** 来源类型名称 */
    sourceTypeName: string
    /** 生效时间 */
    effectiveAt: string
    /** 过期时间 */
    expiredAt: string
    /** 状态：1-有效，0-无效 */
    status: number
    /** 状态名称 */
    statusName: string
    /** 备注 */
    remark: string | null
    /** 创建时间 */
    createdAt: string
}

/** 用户权益管理响应（管理员视图） */
export interface UserBenefitsAdminResponse {
    /** 用户信息 */
    user: {
        id: number
        phone: string
        nickname: string | null
    }
    /** 权益汇总 */
    summary: UserBenefitSummary[]
    /** 权益记录列表 */
    records: UserBenefitRecordAdmin[]
}

/** 可用权益类型（用于下拉选择） */
export interface AvailableBenefit {
    /** 权益ID */
    id: number
    /** 权益标识码 */
    code: string
    /** 权益名称 */
    name: string
    /** 单位类型 */
    unitType: string
}
