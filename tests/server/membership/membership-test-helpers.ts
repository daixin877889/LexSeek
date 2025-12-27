/**
 * 会员系统测试辅助函数
 *
 * 提供测试中常用的辅助方法和模拟逻辑
 */

import {
    type MockMembershipLevel,
    type MockUserMembership,
    type MockCampaign,
    type MockRedemptionCode,
    type MockProduct,
    type MockOrder,
    type MockPointRecord,
    MembershipStatus,
    UserMembershipSourceType,
    RedemptionCodeStatus,
    RedemptionCodeType,
    CampaignType,
    ProductType,
    OrderStatus,
    PointRecordStatus,
} from './membership-test-fixtures'

// ==================== 日期辅助函数 ====================

/**
 * 获取当前时间
 */
export const now = (): Date => new Date()

/**
 * 获取 N 天后的日期
 */
export const daysFromNow = (days: number): Date => {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

/**
 * 获取 N 天前的日期
 */
export const daysAgo = (days: number): Date => {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

/**
 * 计算两个日期之间的天数
 */
export const daysBetween = (start: Date, end: Date): number => {
    const diff = end.getTime() - start.getTime()
    return Math.floor(diff / (24 * 60 * 60 * 1000))
}

// ==================== 会员级别辅助函数 ====================

/**
 * 检查会员级别是否有效
 */
export const isLevelActive = (level: MockMembershipLevel): boolean => {
    return level.status === 1 && level.deletedAt === null
}

/**
 * 按 sortOrder 排序会员级别（升序，sortOrder 越小级别越高）
 */
export const sortLevelsBySortOrder = (
    levels: MockMembershipLevel[]
): MockMembershipLevel[] => {
    return [...levels].sort((a, b) => a.sortOrder - b.sortOrder)
}

/**
 * 获取比当前级别更高的级别列表
 */
export const getHigherLevels = (
    currentLevel: MockMembershipLevel,
    allLevels: MockMembershipLevel[]
): MockMembershipLevel[] => {
    return allLevels.filter(
        (level) =>
            level.sortOrder < currentLevel.sortOrder &&
            isLevelActive(level)
    )
}

// ==================== 用户会员辅助函数 ====================

/**
 * 检查会员是否有效
 */
export const isMembershipValid = (membership: MockUserMembership): boolean => {
    return (
        membership.status === MembershipStatus.ACTIVE &&
        membership.endDate > new Date() &&
        membership.deletedAt === null
    )
}

/**
 * 计算会员剩余天数
 */
export const getRemainingDays = (membership: MockUserMembership): number => {
    if (!isMembershipValid(membership)) return 0
    return daysBetween(new Date(), membership.endDate)
}

/**
 * 模拟创建会员记录
 */
export const simulateCreateMembership = (
    userId: number,
    level: MockMembershipLevel,
    durationDays: number,
    sourceType: number,
    sourceId: number | null = null
): MockUserMembership => {
    const startDate = new Date()
    const endDate = daysFromNow(durationDays)

    return {
        id: Date.now(),
        userId,
        levelId: level.id,
        level,
        startDate,
        endDate,
        autoRenew: false,
        status: MembershipStatus.ACTIVE,
        sourceType,
        sourceId,
        remark: null,
        createdAt: startDate,
        updatedAt: startDate,
        deletedAt: null,
    }
}

// ==================== 营销活动辅助函数 ====================

/**
 * 检查营销活动是否有效
 */
export const isCampaignActive = (campaign: MockCampaign): boolean => {
    const currentTime = new Date()
    return (
        campaign.status === 1 &&
        campaign.startAt <= currentTime &&
        campaign.endAt >= currentTime &&
        campaign.deletedAt === null
    )
}

/**
 * 模拟执行注册赠送
 */
export const simulateRegisterGift = (
    userId: number,
    campaign: MockCampaign,
    level: MockMembershipLevel | null
): {
    membership: MockUserMembership | null
    points: number
} => {
    if (!isCampaignActive(campaign)) {
        return { membership: null, points: 0 }
    }

    let membership: MockUserMembership | null = null

    // 创建会员记录
    if (campaign.levelId && campaign.duration && level) {
        membership = simulateCreateMembership(
            userId,
            level,
            campaign.duration,
            UserMembershipSourceType.REGISTRATION_AWARD,
            campaign.id
        )
    }

    return {
        membership,
        points: campaign.giftPoint || 0,
    }
}

/**
 * 模拟执行邀请奖励
 */
export const simulateInvitationReward = (
    inviterId: number,
    campaign: MockCampaign,
    level: MockMembershipLevel | null
): {
    membership: MockUserMembership | null
    points: number
} => {
    if (!isCampaignActive(campaign)) {
        return { membership: null, points: 0 }
    }

    let membership: MockUserMembership | null = null

    // 创建会员记录
    if (campaign.levelId && campaign.duration && level) {
        membership = simulateCreateMembership(
            inviterId,
            level,
            campaign.duration,
            UserMembershipSourceType.INVITATION_TO_REGISTER,
            campaign.id
        )
    }

    return {
        membership,
        points: campaign.giftPoint || 0,
    }
}

// ==================== 兑换码辅助函数 ====================

/**
 * 检查兑换码是否可用
 */
export const isRedemptionCodeValid = (code: MockRedemptionCode): boolean => {
    const currentTime = new Date()
    return (
        code.status === RedemptionCodeStatus.VALID &&
        (code.expiredAt === null || code.expiredAt > currentTime) &&
        code.deletedAt === null
    )
}

/**
 * 获取兑换码拒绝原因
 */
export const getRedemptionCodeRejectReason = (
    code: MockRedemptionCode
): string | null => {
    if (code.status === RedemptionCodeStatus.USED) {
        return '兑换码已使用'
    }
    if (code.status === RedemptionCodeStatus.EXPIRED) {
        return '兑换码已过期'
    }
    if (code.status === RedemptionCodeStatus.REVOKED) {
        return '兑换码已作废'
    }
    if (code.expiredAt && code.expiredAt <= new Date()) {
        return '兑换码已过期'
    }
    return null
}

/**
 * 模拟兑换码兑换
 */
export const simulateRedemption = (
    userId: number,
    code: MockRedemptionCode,
    level: MockMembershipLevel | null
): {
    success: boolean
    membership: MockUserMembership | null
    points: number
    pointExpiredAt: Date | null
    errorMessage: string | null
} => {
    // 检查兑换码是否可用
    const rejectReason = getRedemptionCodeRejectReason(code)
    if (rejectReason) {
        return {
            success: false,
            membership: null,
            points: 0,
            pointExpiredAt: null,
            errorMessage: rejectReason,
        }
    }

    let membership: MockUserMembership | null = null
    let points = 0
    let pointExpiredAt: Date | null = null

    // 处理会员
    if (
        (code.type === RedemptionCodeType.MEMBERSHIP_ONLY ||
            code.type === RedemptionCodeType.MEMBERSHIP_AND_POINTS) &&
        code.levelId &&
        code.duration &&
        level
    ) {
        membership = simulateCreateMembership(
            userId,
            level,
            code.duration,
            UserMembershipSourceType.REDEMPTION_CODE,
            code.id
        )
    }

    // 处理积分
    if (
        (code.type === RedemptionCodeType.POINTS_ONLY ||
            code.type === RedemptionCodeType.MEMBERSHIP_AND_POINTS) &&
        code.pointAmount
    ) {
        points = code.pointAmount

        // 积分有效期：如果有会员则跟随会员，否则1年
        if (membership) {
            pointExpiredAt = membership.endDate
        } else {
            pointExpiredAt = daysFromNow(365)
        }
    }

    return {
        success: true,
        membership,
        points,
        pointExpiredAt,
        errorMessage: null,
    }
}

// ==================== 升级辅助函数 ====================

/**
 * 计算升级价格
 */
export const calculateUpgradePrice = (
    currentMembership: MockUserMembership,
    currentProduct: MockProduct | null,
    targetProduct: MockProduct,
    remainingDays: number
): {
    originalRemainingValue: number
    targetRemainingValue: number
    upgradePrice: number
    pointCompensation: number
} => {
    // 获取当前级别的日均价格
    const currentYearlyPrice = currentProduct?.priceYearly ?? 0
    const currentDailyPrice = currentYearlyPrice / 365

    // 获取目标级别的日均价格
    const targetYearlyPrice =
        targetProduct.priceYearly ??
        (targetProduct.priceMonthly ? targetProduct.priceMonthly * 12 : 0)
    const targetDailyPrice = targetYearlyPrice / 365

    // 计算原级别剩余价值
    const originalRemainingValue =
        Math.round(currentDailyPrice * remainingDays * 100) / 100

    // 计算目标级别剩余价值
    const targetRemainingValue =
        Math.round(targetDailyPrice * remainingDays * 100) / 100

    // 升级价格 = 目标级别剩余价值 - 原级别剩余价值
    const upgradePrice = Math.max(
        0,
        Math.round((targetRemainingValue - originalRemainingValue) * 100) / 100
    )

    // 积分补偿 = 升级价格 × 10
    const pointCompensation = Math.round(upgradePrice * 10)

    return {
        originalRemainingValue,
        targetRemainingValue,
        upgradePrice,
        pointCompensation,
    }
}

/**
 * 检查是否可以升级
 */
export const canUpgrade = (
    currentMembership: MockUserMembership | null,
    targetLevel: MockMembershipLevel
): { canUpgrade: boolean; reason?: string } => {
    // 没有有效会员不能升级
    if (!currentMembership) {
        return { canUpgrade: false, reason: '用户没有有效会员' }
    }

    // 会员已过期不能升级
    if (currentMembership.endDate < new Date()) {
        return { canUpgrade: false, reason: '会员已过期' }
    }

    // 会员状态无效不能升级
    if (currentMembership.status !== MembershipStatus.ACTIVE) {
        return { canUpgrade: false, reason: '会员状态无效' }
    }

    // 目标级别必须高于当前级别（sortOrder 更小）
    if (
        currentMembership.level &&
        targetLevel.sortOrder >= currentMembership.level.sortOrder
    ) {
        return { canUpgrade: false, reason: '目标级别必须高于当前级别' }
    }

    return { canUpgrade: true }
}

/**
 * 模拟执行会员升级
 */
export const simulateMembershipUpgrade = (
    currentMembership: MockUserMembership,
    targetLevel: MockMembershipLevel,
    pointRecords: MockPointRecord[]
): {
    success: boolean
    oldMembership: MockUserMembership
    newMembership: MockUserMembership
    transferredPoints: MockPointRecord[]
} => {
    // 1. 将原会员标记为无效
    const oldMembership: MockUserMembership = {
        ...currentMembership,
        status: MembershipStatus.INACTIVE,
        updatedAt: new Date(),
    }

    // 2. 创建新会员记录
    const newMembership: MockUserMembership = {
        id: currentMembership.id + 1000,
        userId: currentMembership.userId,
        levelId: targetLevel.id,
        level: targetLevel,
        startDate: new Date(),
        endDate: currentMembership.endDate, // 继承原会员的结束时间
        autoRenew: false,
        status: MembershipStatus.ACTIVE,
        sourceType: UserMembershipSourceType.MEMBERSHIP_UPGRADE,
        sourceId: currentMembership.id,
        remark: `从会员 ${currentMembership.id} 升级`,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
    }

    // 3. 转移积分记录
    const transferredPoints = pointRecords
        .filter((p) => p.userMembershipId === currentMembership.id)
        .map((p) => ({
            ...p,
            userMembershipId: newMembership.id,
            updatedAt: new Date(),
        }))

    return {
        success: true,
        oldMembership,
        newMembership,
        transferredPoints,
    }
}

// ==================== 积分辅助函数 ====================

/**
 * 按过期时间排序积分记录（升序）
 */
export const sortPointsByExpiry = (
    records: MockPointRecord[]
): MockPointRecord[] => {
    return [...records].sort(
        (a, b) => a.expiredAt.getTime() - b.expiredAt.getTime()
    )
}

/**
 * 获取有效积分记录
 */
export const getValidPointRecords = (
    records: MockPointRecord[]
): MockPointRecord[] => {
    return records.filter(
        (r) =>
            r.status === PointRecordStatus.VALID &&
            r.remaining > 0 &&
            r.expiredAt > new Date() &&
            r.deletedAt === null
    )
}

/**
 * 计算可用积分总数
 */
export const getTotalAvailablePoints = (
    records: MockPointRecord[]
): number => {
    return getValidPointRecords(records).reduce(
        (sum, r) => sum + r.remaining,
        0
    )
}

/**
 * 模拟积分消耗（FIFO）
 */
export const simulateConsumePoints = (
    records: MockPointRecord[],
    consumeAmount: number
): {
    success: boolean
    consumedRecords: { recordId: number; amount: number }[]
    errorMessage?: string
} => {
    const validRecords = sortPointsByExpiry(getValidPointRecords(records))
    const totalAvailable = validRecords.reduce((sum, r) => sum + r.remaining, 0)

    if (totalAvailable < consumeAmount) {
        return {
            success: false,
            consumedRecords: [],
            errorMessage: '积分不足',
        }
    }

    let remainingToConsume = consumeAmount
    const consumedRecords: { recordId: number; amount: number }[] = []

    for (const record of validRecords) {
        if (remainingToConsume <= 0) break

        const consumeFromRecord = Math.min(record.remaining, remainingToConsume)
        if (consumeFromRecord > 0) {
            consumedRecords.push({
                recordId: record.id,
                amount: consumeFromRecord,
            })
            remainingToConsume -= consumeFromRecord
        }
    }

    return { success: true, consumedRecords }
}

// ==================== 订单辅助函数 ====================

/**
 * 生成订单号
 */
export const generateOrderNo = (): string => {
    const timestamp = Date.now().toString()
    const random = Math.random().toString(36).substring(2, 8).toUpperCase()
    return `ORD${timestamp}${random}`
}

/**
 * 检查订单是否可支付
 */
export const isOrderPayable = (order: MockOrder): boolean => {
    return (
        order.status === OrderStatus.PENDING &&
        order.expiredAt > new Date() &&
        order.deletedAt === null
    )
}

/**
 * 模拟支付成功处理
 */
export const simulatePaymentSuccess = (
    order: MockOrder,
    product: MockProduct,
    level: MockMembershipLevel | null
): {
    membership: MockUserMembership | null
    points: number
    pointExpiredAt: Date | null
} => {
    let membership: MockUserMembership | null = null
    let points = 0
    let pointExpiredAt: Date | null = null

    if (product.type === ProductType.MEMBERSHIP && level) {
        // 会员商品
        const durationDays =
            order.durationUnit === 'year'
                ? order.duration * 365
                : order.duration * 30

        membership = simulateCreateMembership(
            order.userId,
            level,
            durationDays,
            UserMembershipSourceType.DIRECT_PURCHASE,
            order.id
        )

        // 赠送积分
        if (product.giftPoint) {
            points = product.giftPoint
            pointExpiredAt = membership.endDate
        }
    } else if (product.type === ProductType.POINTS) {
        // 积分商品
        points = product.pointAmount || 0
        pointExpiredAt = daysFromNow(365)
    }

    return { membership, points, pointExpiredAt }
}
