/**
 * 会员系统测试数据工厂
 *
 * 提供测试数据生成方法，用于集成测试
 */

import * as fc from 'fast-check'

// ==================== 状态常量 ====================

/** 会员状态 */
export const MembershipStatus = {
    INACTIVE: 0,
    ACTIVE: 1,
} as const

/** 会员来源类型 */
export const UserMembershipSourceType = {
    REDEMPTION_CODE: 1,
    DIRECT_PURCHASE: 2,
    ADMIN_GIFT: 3,
    ACTIVITY_AWARD: 4,
    TRIAL: 5,
    REGISTRATION_AWARD: 6,
    INVITATION_TO_REGISTER: 7,
    MEMBERSHIP_UPGRADE: 8,
    OTHER: 99,
} as const

/** 兑换码状态 */
export const RedemptionCodeStatus = {
    VALID: 1,
    USED: 2,
    EXPIRED: 3,
    REVOKED: 4,
} as const

/** 兑换码类型 */
export const RedemptionCodeType = {
    MEMBERSHIP_ONLY: 1,
    POINTS_ONLY: 2,
    MEMBERSHIP_AND_POINTS: 3,
} as const

/** 营销活动类型 */
export const CampaignType = {
    REGISTER_GIFT: 1,
    INVITATION_REWARD: 2,
    ACTIVITY_REWARD: 3,
} as const

/** 商品类型 */
export const ProductType = {
    MEMBERSHIP: 1,
    POINTS: 2,
} as const

/** 订单状态 */
export const OrderStatus = {
    PENDING: 0,
    PAID: 1,
    CANCELLED: 2,
    REFUNDED: 3,
} as const

/** 支付单状态 */
export const PaymentTransactionStatus = {
    PENDING: 0,
    SUCCESS: 1,
    FAILED: 2,
    EXPIRED: 3,
    REFUNDED: 4,
} as const

/** 积分记录状态 */
export const PointRecordStatus = {
    VALID: 1,
    MEMBERSHIP_UPGRADE_SETTLEMENT: 2,
    CANCELLED: 3,
} as const

// ==================== 类型定义 ====================

/** 会员级别 */
export interface MockMembershipLevel {
    id: number
    name: string
    description: string | null
    sortOrder: number
    status: number
    createdAt: Date
    updatedAt: Date
    deletedAt: Date | null
}

/** 用户会员记录 */
export interface MockUserMembership {
    id: number
    userId: number
    levelId: number
    level?: MockMembershipLevel
    startDate: Date
    endDate: Date
    autoRenew: boolean
    status: number
    sourceType: number
    sourceId: number | null
    remark: string | null
    createdAt: Date
    updatedAt: Date
    deletedAt: Date | null
}

/** 营销活动 */
export interface MockCampaign {
    id: number
    name: string
    type: number
    levelId: number | null
    duration: number | null
    giftPoint: number | null
    startAt: Date
    endAt: Date
    status: number
    remark: string | null
    createdAt: Date
    updatedAt: Date
    deletedAt: Date | null
}

/** 兑换码 */
export interface MockRedemptionCode {
    id: number
    code: string
    type: number
    levelId: number | null
    duration: number | null
    pointAmount: number | null
    expiredAt: Date | null
    status: number
    remark: string | null
    createdAt: Date
    updatedAt: Date
    deletedAt: Date | null
}

/** 商品 */
export interface MockProduct {
    id: number
    name: string
    type: number
    levelId: number | null
    priceMonthly: number | null
    priceYearly: number | null
    giftPoint: number | null
    unitPrice: number | null
    pointAmount: number | null
    purchaseLimit: number
    status: number
    sortOrder: number
    createdAt: Date
    updatedAt: Date
    deletedAt: Date | null
}

/** 订单 */
export interface MockOrder {
    id: number
    orderNo: string
    userId: number
    productId: number
    amount: number
    duration: number
    durationUnit: string
    status: number
    paidAt: Date | null
    expiredAt: Date
    remark: string | null
    createdAt: Date
    updatedAt: Date
    deletedAt: Date | null
}

/** 积分记录 */
export interface MockPointRecord {
    id: number
    userId: number
    userMembershipId: number | null
    pointAmount: number
    used: number
    remaining: number
    sourceType: number
    effectiveAt: Date
    expiredAt: Date
    status: number
    createdAt: Date
    updatedAt: Date
    deletedAt: Date | null
}

// ==================== 数据工厂 ====================

/**
 * 创建会员级别测试数据
 */
export const createMembershipLevel = (
    overrides: Partial<MockMembershipLevel> = {}
): MockMembershipLevel => {
    const now = new Date()
    return {
        id: 1,
        name: '普通会员',
        description: '普通会员级别',
        sortOrder: 1,
        status: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        ...overrides,
    }
}

/**
 * 创建用户会员记录测试数据
 */
export const createUserMembership = (
    overrides: Partial<MockUserMembership> = {}
): MockUserMembership => {
    const now = new Date()
    const endDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
    return {
        id: 1,
        userId: 1,
        levelId: 1,
        startDate: now,
        endDate,
        autoRenew: false,
        status: MembershipStatus.ACTIVE,
        sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
        sourceId: null,
        remark: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        ...overrides,
    }
}

/**
 * 创建营销活动测试数据
 */
export const createCampaign = (
    overrides: Partial<MockCampaign> = {}
): MockCampaign => {
    const now = new Date()
    const startAt = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const endAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    return {
        id: 1,
        name: '注册赠送活动',
        type: CampaignType.REGISTER_GIFT,
        levelId: 1,
        duration: 30,
        giftPoint: 100,
        startAt,
        endAt,
        status: 1,
        remark: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        ...overrides,
    }
}

/**
 * 创建兑换码测试数据
 */
export const createRedemptionCode = (
    overrides: Partial<MockRedemptionCode> = {}
): MockRedemptionCode => {
    const now = new Date()
    const expiredAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
    return {
        id: 1,
        code: `CODE${Date.now()}`,
        type: RedemptionCodeType.MEMBERSHIP_AND_POINTS,
        levelId: 1,
        duration: 30,
        pointAmount: 100,
        expiredAt,
        status: RedemptionCodeStatus.VALID,
        remark: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        ...overrides,
    }
}

/**
 * 创建商品测试数据
 */
export const createProduct = (
    overrides: Partial<MockProduct> = {}
): MockProduct => {
    const now = new Date()
    return {
        id: 1,
        name: '月度会员',
        type: ProductType.MEMBERSHIP,
        levelId: 1,
        priceMonthly: 29.9,
        priceYearly: 299,
        giftPoint: 100,
        unitPrice: null,
        pointAmount: null,
        purchaseLimit: 0,
        status: 1,
        sortOrder: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        ...overrides,
    }
}

/**
 * 创建订单测试数据
 */
export const createOrder = (
    overrides: Partial<MockOrder> = {}
): MockOrder => {
    const now = new Date()
    const expiredAt = new Date(now.getTime() + 30 * 60 * 1000) // 30分钟后过期
    return {
        id: 1,
        orderNo: `ORD${Date.now()}`,
        userId: 1,
        productId: 1,
        amount: 29.9,
        duration: 1,
        durationUnit: 'month',
        status: OrderStatus.PENDING,
        paidAt: null,
        expiredAt,
        remark: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        ...overrides,
    }
}

/**
 * 创建积分记录测试数据
 */
export const createPointRecord = (
    overrides: Partial<MockPointRecord> = {}
): MockPointRecord => {
    const now = new Date()
    const expiredAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
    return {
        id: 1,
        userId: 1,
        userMembershipId: null,
        pointAmount: 100,
        used: 0,
        remaining: 100,
        sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
        effectiveAt: now,
        expiredAt,
        status: PointRecordStatus.VALID,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        ...overrides,
    }
}

// ==================== fast-check 生成器 ====================

/** 会员级别生成器 */
export const membershipLevelArb = fc.record({
    id: fc.integer({ min: 1, max: 1000 }),
    name: fc.string({ minLength: 2, maxLength: 20 }),
    description: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
    sortOrder: fc.integer({ min: 1, max: 100 }),
    status: fc.constantFrom(0, 1),
})

/** 用户会员记录生成器 */
export const userMembershipArb = fc.record({
    id: fc.integer({ min: 1, max: 10000 }),
    userId: fc.integer({ min: 1, max: 10000 }),
    levelId: fc.integer({ min: 1, max: 100 }),
    startDate: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
    endDate: fc.date({ min: new Date('2025-01-01'), max: new Date('2026-12-31') }),
    status: fc.constantFrom(MembershipStatus.INACTIVE, MembershipStatus.ACTIVE),
    sourceType: fc.constantFrom(
        UserMembershipSourceType.REDEMPTION_CODE,
        UserMembershipSourceType.DIRECT_PURCHASE,
        UserMembershipSourceType.REGISTRATION_AWARD
    ),
})

/** 营销活动生成器 */
export const campaignArb = fc.record({
    id: fc.integer({ min: 1, max: 1000 }),
    name: fc.string({ minLength: 2, maxLength: 50 }),
    type: fc.constantFrom(
        CampaignType.REGISTER_GIFT,
        CampaignType.INVITATION_REWARD,
        CampaignType.ACTIVITY_REWARD
    ),
    levelId: fc.option(fc.integer({ min: 1, max: 100 }), { nil: null }),
    duration: fc.option(fc.integer({ min: 1, max: 365 }), { nil: null }),
    giftPoint: fc.option(fc.integer({ min: 1, max: 10000 }), { nil: null }),
    status: fc.constantFrom(0, 1),
})

/** 兑换码生成器 */
export const redemptionCodeArb = fc.record({
    id: fc.integer({ min: 1, max: 10000 }),
    code: fc.string({ minLength: 8, maxLength: 16 }),
    type: fc.constantFrom(
        RedemptionCodeType.MEMBERSHIP_ONLY,
        RedemptionCodeType.POINTS_ONLY,
        RedemptionCodeType.MEMBERSHIP_AND_POINTS
    ),
    levelId: fc.option(fc.integer({ min: 1, max: 100 }), { nil: null }),
    duration: fc.option(fc.integer({ min: 1, max: 365 }), { nil: null }),
    pointAmount: fc.option(fc.integer({ min: 1, max: 10000 }), { nil: null }),
    status: fc.constantFrom(
        RedemptionCodeStatus.VALID,
        RedemptionCodeStatus.USED,
        RedemptionCodeStatus.EXPIRED,
        RedemptionCodeStatus.REVOKED
    ),
})

/** 积分记录生成器 */
export const pointRecordArb = fc.record({
    id: fc.integer({ min: 1, max: 10000 }),
    userId: fc.integer({ min: 1, max: 10000 }),
    userMembershipId: fc.option(fc.integer({ min: 1, max: 10000 }), { nil: null }),
    pointAmount: fc.integer({ min: 1, max: 10000 }),
    remaining: fc.integer({ min: 0, max: 10000 }),
    expiredAt: fc.date({ min: new Date('2025-01-01'), max: new Date('2027-12-31') }),
    status: fc.constantFrom(
        PointRecordStatus.VALID,
        PointRecordStatus.MEMBERSHIP_UPGRADE_SETTLEMENT,
        PointRecordStatus.CANCELLED
    ),
})

// ==================== 批量数据生成 ====================

/**
 * 生成会员级别列表（按 sortOrder 排序）
 */
export const generateMembershipLevels = (count: number = 3): MockMembershipLevel[] => {
    const levels: MockMembershipLevel[] = []
    const names = ['钻石会员', '黄金会员', '普通会员']

    for (let i = 0; i < count; i++) {
        levels.push(
            createMembershipLevel({
                id: i + 1,
                name: names[i] || `会员级别${i + 1}`,
                sortOrder: i + 1,
            })
        )
    }

    return levels
}

/**
 * 生成积分记录列表（按过期时间排序）
 */
export const generatePointRecords = (
    userId: number,
    count: number = 3,
    userMembershipId: number | null = null
): MockPointRecord[] => {
    const records: MockPointRecord[] = []
    const now = new Date()

    for (let i = 0; i < count; i++) {
        const expiredAt = new Date(now.getTime() + (i + 1) * 30 * 24 * 60 * 60 * 1000)
        records.push(
            createPointRecord({
                id: i + 1,
                userId,
                userMembershipId,
                pointAmount: 100 * (i + 1),
                remaining: 100 * (i + 1),
                expiredAt,
            })
        )
    }

    return records
}
