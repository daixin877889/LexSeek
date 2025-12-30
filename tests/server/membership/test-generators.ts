/**
 * 测试数据生成器模块
 *
 * 使用 fast-check 生成随机测试数据，用于属性测试
 *
 * **Feature: test-infrastructure**
 * **Validates: Requirements 8.1**
 */

import * as fc from 'fast-check'
import {
    MembershipStatus,
    MembershipLevelStatus,
    UserMembershipSourceType,
    RedemptionCodeStatus,
    RedemptionCodeType,
    CampaignType,
    PointRecordStatus,
    PointSourceType,
} from './test-db-helper'

// ==================== 属性测试配置 ====================

/** 属性测试默认配置 */
export const PBT_CONFIG = { numRuns: 100 }

/** 属性测试快速配置（用于耗时较长的测试） */
export const PBT_CONFIG_FAST = { numRuns: 5 }

// ==================== 基础数据生成器 ====================

/** 生成有效的中文名称 */
export const chineseNameArb = fc.string({ minLength: 2, maxLength: 10 })
    .filter(s => s.trim().length >= 2)
    .map(s => s.trim())

/** 生成有效的描述文本 */
export const descriptionArb = fc.option(
    fc.string({ minLength: 1, maxLength: 100 }).map(s => s.trim()),
    { nil: null }
)

/** 生成正整数 */
export const positiveIntArb = fc.integer({ min: 1, max: 10000 })

/** 生成排序值 */
export const sortOrderArb = fc.integer({ min: 1, max: 100 })

/** 生成状态值（0 或 1） */
export const statusArb = fc.constantFrom(0, 1)

/** 生成有效日期（过滤无效日期） */
export const validDateArb = fc.date({
    min: new Date('2024-01-01'),
    max: new Date('2030-12-31'),
}).filter(d => !isNaN(d.getTime()))

/** 生成未来日期 */
export const futureDateArb = fc.date({
    min: new Date(),
    max: new Date('2030-12-31'),
}).filter(d => !isNaN(d.getTime()) && d > new Date())

/** 生成过去日期 */
export const pastDateArb = fc.date({
    min: new Date('2020-01-01'),
    max: new Date(),
}).filter(d => !isNaN(d.getTime()) && d < new Date())

// ==================== 会员级别数据生成器 ====================

/** 会员级别创建数据生成器 */
export const membershipLevelDataArb = fc.record({
    name: fc.string({ minLength: 2, maxLength: 20 }).map(s => `测试级别_${s}`),
    description: descriptionArb,
    sortOrder: sortOrderArb,
    status: fc.constantFrom(MembershipLevelStatus.DISABLED, MembershipLevelStatus.ENABLED),
})

/** 会员级别更新数据生成器 */
export const membershipLevelUpdateArb = fc.record({
    name: fc.option(fc.string({ minLength: 2, maxLength: 20 }).map(s => `测试级别_${s}`), { nil: undefined }),
    description: fc.option(descriptionArb, { nil: undefined }),
    sortOrder: fc.option(sortOrderArb, { nil: undefined }),
    status: fc.option(fc.constantFrom(MembershipLevelStatus.DISABLED, MembershipLevelStatus.ENABLED), { nil: undefined }),
})

// ==================== 用户会员记录数据生成器 ====================

/** 会员时长生成器（天数） */
export const durationDaysArb = fc.integer({ min: 1, max: 365 })

/** 用户会员来源类型生成器 */
export const userMembershipSourceTypeArb = fc.constantFrom(
    UserMembershipSourceType.REDEMPTION_CODE,
    UserMembershipSourceType.DIRECT_PURCHASE,
    UserMembershipSourceType.ADMIN_GIFT,
    UserMembershipSourceType.ACTIVITY_AWARD,
    UserMembershipSourceType.TRIAL,
    UserMembershipSourceType.REGISTRATION_AWARD,
    UserMembershipSourceType.INVITATION_TO_REGISTER,
    UserMembershipSourceType.MEMBERSHIP_UPGRADE
)

/** 用户会员记录创建数据生成器 */
export const userMembershipDataArb = fc.record({
    duration: durationDaysArb,
    autoRenew: fc.boolean(),
    sourceType: userMembershipSourceTypeArb,
    remark: descriptionArb,
})

// ==================== 积分记录数据生成器 ====================

/** 积分数量生成器 */
export const pointAmountArb = fc.integer({ min: 1, max: 10000 })

/** 积分来源类型生成器 */
export const pointSourceTypeArb = fc.constantFrom(
    PointSourceType.MEMBERSHIP_PURCHASE_GIFT,
    PointSourceType.DIRECT_PURCHASE,
    PointSourceType.REDEMPTION_CODE,
    PointSourceType.ADMIN_GIFT,
    PointSourceType.ACTIVITY_AWARD,
    PointSourceType.REGISTRATION_AWARD,
    PointSourceType.INVITATION_REWARD
)

/** 积分记录创建数据生成器 */
export const pointRecordDataArb = fc.record({
    pointAmount: pointAmountArb,
    sourceType: pointSourceTypeArb,
    daysUntilExpiry: fc.integer({ min: 1, max: 365 }),
})

/** 积分消费数据生成器 */
export const pointConsumptionArb = (maxPoints: number) =>
    fc.integer({ min: 1, max: Math.max(1, maxPoints) })

// ==================== 兑换码数据生成器 ====================

/** 兑换码类型生成器 */
export const redemptionCodeTypeArb = fc.constantFrom(
    RedemptionCodeType.MEMBERSHIP_ONLY,
    RedemptionCodeType.POINTS_ONLY,
    RedemptionCodeType.MEMBERSHIP_AND_POINTS
)

/** 兑换码状态生成器 */
export const redemptionCodeStatusArb = fc.constantFrom(
    RedemptionCodeStatus.VALID,
    RedemptionCodeStatus.USED,
    RedemptionCodeStatus.EXPIRED,
    RedemptionCodeStatus.REVOKED
)

/** 兑换码创建数据生成器 - 仅会员类型 */
export const redemptionCodeMembershipOnlyArb = fc.record({
    type: fc.constant(RedemptionCodeType.MEMBERSHIP_ONLY),
    duration: fc.integer({ min: 1, max: 365 }),
    pointAmount: fc.constant(null),
    daysUntilExpiry: fc.integer({ min: 1, max: 365 }),
})

/** 兑换码创建数据生成器 - 仅积分类型 */
export const redemptionCodePointsOnlyArb = fc.record({
    type: fc.constant(RedemptionCodeType.POINTS_ONLY),
    duration: fc.constant(null),
    pointAmount: pointAmountArb,
    daysUntilExpiry: fc.integer({ min: 1, max: 365 }),
})

/** 兑换码创建数据生成器 - 会员和积分类型 */
export const redemptionCodeMembershipAndPointsArb = fc.record({
    type: fc.constant(RedemptionCodeType.MEMBERSHIP_AND_POINTS),
    duration: fc.integer({ min: 1, max: 365 }),
    pointAmount: pointAmountArb,
    daysUntilExpiry: fc.integer({ min: 1, max: 365 }),
})

/** 兑换码创建数据生成器（所有类型） */
export const redemptionCodeDataArb = fc.oneof(
    redemptionCodeMembershipOnlyArb,
    redemptionCodePointsOnlyArb,
    redemptionCodeMembershipAndPointsArb
)

// ==================== 营销活动数据生成器 ====================

/** 营销活动类型生成器 */
export const campaignTypeArb = fc.constantFrom(
    CampaignType.REGISTER_GIFT,
    CampaignType.INVITATION_REWARD,
    CampaignType.ACTIVITY_REWARD
)

/** 营销活动创建数据生成器 */
export const campaignDataArb = fc.record({
    name: fc.string({ minLength: 2, maxLength: 50 }).map(s => `测试活动_${s}`),
    type: campaignTypeArb,
    duration: fc.option(fc.integer({ min: 1, max: 365 }), { nil: null }),
    giftPoint: fc.option(fc.integer({ min: 1, max: 10000 }), { nil: null }),
    daysActive: fc.integer({ min: 1, max: 30 }),
})

/** 活动时间范围生成器 */
export const campaignTimeRangeArb = fc.record({
    startOffset: fc.integer({ min: -30, max: 0 }), // 开始时间偏移（天）
    endOffset: fc.integer({ min: 1, max: 60 }),    // 结束时间偏移（天）
}).map(({ startOffset, endOffset }) => {
    const now = new Date()
    return {
        startAt: new Date(now.getTime() + startOffset * 24 * 60 * 60 * 1000),
        endAt: new Date(now.getTime() + endOffset * 24 * 60 * 60 * 1000),
    }
})

// ==================== 会员升级数据生成器 ====================

/** 会员升级场景生成器 */
export const membershipUpgradeScenarioArb = fc.record({
    originalDaysRemaining: fc.integer({ min: 1, max: 365 }),
    originalLevelSortOrder: fc.integer({ min: 1, max: 9 }),
    targetLevelSortOrder: fc.integer({ min: 2, max: 10 }),
}).filter(({ originalLevelSortOrder, targetLevelSortOrder }) =>
    // 确保目标级别比原级别高（sortOrder 越大级别越高）
    targetLevelSortOrder > originalLevelSortOrder
)

/** 会员升级价格计算输入生成器 */
export const upgradePriceInputArb = fc.record({
    originalRemainingDays: fc.integer({ min: 1, max: 365 }),
    originalDailyPrice: fc.float({ min: Math.fround(0.1), max: Math.fround(10), noNaN: true }),
    targetDailyPrice: fc.float({ min: Math.fround(0.1), max: Math.fround(20), noNaN: true }),
}).filter(({ originalDailyPrice, targetDailyPrice }) =>
    // 确保目标价格高于原价格
    targetDailyPrice > originalDailyPrice
)

// ==================== 复合数据生成器 ====================

/** 生成多个会员级别（按 sortOrder 排序） */
export const membershipLevelListArb = (count: number) =>
    fc.array(membershipLevelDataArb, { minLength: count, maxLength: count })
        .map(levels => levels.map((level, index) => ({
            ...level,
            sortOrder: index + 1,
        })))

/** 生成多个积分记录（按过期时间排序） */
export const pointRecordListArb = (count: number) =>
    fc.array(pointRecordDataArb, { minLength: count, maxLength: count })
        .map(records => {
            const now = Date.now()
            return records.map((record, index) => ({
                ...record,
                expiredAt: new Date(now + (index + 1) * 30 * 24 * 60 * 60 * 1000),
            }))
        })

// ==================== 辅助函数 ====================

/**
 * 根据时长计算结束日期
 * @param startDate 开始日期
 * @param durationDays 时长（天）
 * @returns 结束日期
 */
export const calculateEndDate = (startDate: Date, durationDays: number): Date => {
    return new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000)
}

/**
 * 计算两个日期之间的天数
 * @param startDate 开始日期
 * @param endDate 结束日期
 * @returns 天数
 */
export const daysBetween = (startDate: Date, endDate: Date): number => {
    const diffMs = endDate.getTime() - startDate.getTime()
    return Math.floor(diffMs / (24 * 60 * 60 * 1000))
}

/**
 * 判断日期是否在范围内
 * @param date 日期
 * @param startDate 开始日期
 * @param endDate 结束日期
 * @returns 是否在范围内
 */
export const isDateInRange = (date: Date, startDate: Date, endDate: Date): boolean => {
    return date >= startDate && date <= endDate
}
