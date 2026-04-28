/**
 * 测试数据库辅助模块
 *
 * 提供真实数据库操作的测试数据管理功能
 * 所有测试数据使用特定前缀标记，便于清理
 *
 * **Feature: test-infrastructure**
 * **Validates: Requirements 6.1, 6.2, 6.3**
 */

import { Prisma } from '../../../generated/prisma/client'

// Worker 级 prisma 客户端：每个 vitest worker 连接到独立的 ls_test_w<id> 数据库
// 真正的实例化在 tests/_infra/worker-setup.ts 启动时完成
import { getWorkerPrisma } from '../../_infra/worker-prisma'

export const getTestPrisma = getWorkerPrisma

// 兼容性导出
export const testPrisma = new Proxy({} as any, {
    get(_, prop) {
        return (getWorkerPrisma() as any)[prop]
    },
})

// ==================== 测试数据标记前缀 ====================

/** 测试用户手机号前缀 */
export const TEST_USER_PHONE_PREFIX = '199'

/** 测试会员级别名称前缀 */
export const TEST_LEVEL_NAME_PREFIX = '测试级别_'

/** 测试兑换码前缀 */
export const TEST_CODE_PREFIX = 'TEST_'

/** 测试营销活动名称前缀 */
export const TEST_CAMPAIGN_NAME_PREFIX = '测试活动_'

// ==================== 测试数据 ID 追踪 ====================

/** 测试数据 ID 追踪接口 */
export interface TestIds {
    userIds: number[]
    membershipLevelIds: number[]
    userMembershipIds: number[]
    pointRecordIds: number[]
    redemptionCodeIds: number[]
    redemptionRecordIds: number[]
    campaignIds: number[]
    membershipUpgradeRecordIds: number[]
    orderIds: number[]
    productIds: number[]
}

/** 创建空的测试 ID 追踪对象 */
export const createEmptyTestIds = (): TestIds => ({
    userIds: [],
    membershipLevelIds: [],
    userMembershipIds: [],
    pointRecordIds: [],
    redemptionCodeIds: [],
    redemptionRecordIds: [],
    campaignIds: [],
    membershipUpgradeRecordIds: [],
    orderIds: [],
    productIds: [],
})

/** 重置测试 ID 追踪对象 */
export const resetTestIds = (testIds: TestIds): void => {
    testIds.userIds = []
    testIds.membershipLevelIds = []
    testIds.userMembershipIds = []
    testIds.pointRecordIds = []
    testIds.redemptionCodeIds = []
    testIds.redemptionRecordIds = []
    testIds.campaignIds = []
    testIds.membershipUpgradeRecordIds = []
    testIds.orderIds = []
    testIds.productIds = []
}

// ==================== 状态常量 ====================

/** 会员状态 */
export const MembershipStatus = {
    INACTIVE: 0,
    ACTIVE: 1,
    SETTLED: 2,
} as const

/** 会员级别状态 */
export const MembershipLevelStatus = {
    DISABLED: 0,
    ENABLED: 1,
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
    INVALID: 4,
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

/** 积分记录状态 */
export const PointRecordStatus = {
    VALID: 1,
    MEMBERSHIP_UPGRADE_SETTLEMENT: 2,
    CANCELLED: 3,
} as const

/** 积分来源类型 */
export const PointSourceType = {
    MEMBERSHIP_PURCHASE_GIFT: 1,
    DIRECT_PURCHASE: 2,
    REDEMPTION_CODE: 3,
    ADMIN_GIFT: 4,
    ACTIVITY_AWARD: 5,
    REGISTRATION_AWARD: 6,
    INVITATION_REWARD: 7,
} as const

// ==================== 测试数据创建函数 ====================

/** 用户创建输入类型 */
export interface TestUserInput {
    name?: string
    phone?: string
    password?: string
    status?: number
}

/**
 * 创建测试用户
 * @param data 用户数据（可选）
 * @returns 创建的用户记录
 */
let userCounter = 0
export const createTestUser = async (
    data: TestUserInput = {}
): Promise<Prisma.usersGetPayload<{}>> => {
    // 使用计数器 + 随机数 + 时间戳确保唯一性，手机号必须正好11位
    const count = ++userCounter
    // 生成唯一后缀：计数器(4位) + 随机数(4位) + 时间戳位(4位) = 12位，取后8位
    const randomPart = Array.from(crypto.getRandomValues(new Uint8Array(2)))
        .map(b => String(b % 100).padStart(2, '0'))
        .join('')
    const counterPart = String(count % 10000).padStart(4, '0')
    // 使用时间戳后4位 + 计数后4位混合，确保即使计数器循环也不会重复
    const timestampPart = String(Date.now() % 10000).padStart(4, '0')
    // 取 counterPart 后2位 + timestampPart 后3位 + randomPart 前3位 = 8位
    const suffix = `${counterPart.slice(-2)}${timestampPart.slice(-3)}${randomPart.slice(0, 3)}`
    const phone = data.phone || `199${suffix}`  // 199 + 8位 = 11位手机号

    const user = await getTestPrisma().users.create({
        data: {
            name: data.name || `测试用户_${count}`,
            phone,
            password: data.password || 'test_password_hash',
            status: data.status ?? 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return user
}

/** 会员级别创建输入类型 */
export interface TestMembershipLevelInput {
    name?: string
    description?: string | null
    sortOrder?: number
    status?: number
}

/**
 * 创建测试会员级别
 * @param data 会员级别数据（可选）
 * @returns 创建的会员级别记录
 */
export const createTestMembershipLevel = async (
    data: TestMembershipLevelInput = {}
): Promise<Prisma.membershipLevelsGetPayload<{}>> => {
    const timestamp = Date.now()

    const level = await getTestPrisma().membershipLevels.create({
        data: {
            name: data.name || `${TEST_LEVEL_NAME_PREFIX}${timestamp}`,
            // 只有在 data 中没有 description 键时才使用默认值
            description: 'description' in data ? data.description : '测试会员级别描述',
            sortOrder: data.sortOrder ?? Math.floor(Math.random() * 100) + 1,
            status: data.status ?? MembershipLevelStatus.ENABLED,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return level
}

/** 用户会员记录创建输入类型 */
export interface TestUserMembershipInput {
    startDate?: Date
    endDate?: Date
    autoRenew?: boolean
    status?: number
    sourceType?: number
    sourceId?: number | null
    remark?: string | null
}

/**
 * 创建测试用户会员记录
 * @param userId 用户 ID
 * @param levelId 会员级别 ID
 * @param data 用户会员记录数据（可选）
 * @returns 创建的用户会员记录
 */
export const createTestUserMembership = async (
    userId: number,
    levelId: number,
    data: TestUserMembershipInput = {}
): Promise<Prisma.userMembershipsGetPayload<{}>> => {
    const now = new Date()
    const defaultEndDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

    const membership = await testPrisma.userMemberships.create({
        data: {
            userId,
            levelId,
            startDate: data.startDate ?? now,
            endDate: data.endDate ?? defaultEndDate,
            autoRenew: data.autoRenew ?? false,
            status: data.status ?? MembershipStatus.ACTIVE,
            sourceType: data.sourceType ?? UserMembershipSourceType.DIRECT_PURCHASE,
            sourceId: data.sourceId ?? null,
            remark: data.remark ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return membership
}

/** 积分记录创建输入类型 */
export interface TestPointRecordInput {
    pointAmount?: number
    used?: number
    remaining?: number
    sourceType?: number
    sourceId?: number | null
    userMembershipId?: number | null
    effectiveAt?: Date
    expiredAt?: Date
    status?: number
    remark?: string | null
}

/**
 * 创建测试积分记录
 * @param userId 用户 ID
 * @param data 积分记录数据（可选）
 * @returns 创建的积分记录
 */
export const createTestPointRecord = async (
    userId: number,
    data: TestPointRecordInput = {}
): Promise<Prisma.pointRecordsGetPayload<{}>> => {
    const now = new Date()
    const defaultExpiredAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
    const pointAmount = data.pointAmount ?? 100

    const record = await testPrisma.pointRecords.create({
        data: {
            userId,
            pointAmount,
            used: data.used ?? 0,
            remaining: data.remaining ?? pointAmount,
            sourceType: data.sourceType ?? PointSourceType.DIRECT_PURCHASE,
            sourceId: data.sourceId ?? null,
            userMembershipId: data.userMembershipId ?? null,
            effectiveAt: data.effectiveAt ?? now,
            expiredAt: data.expiredAt ?? defaultExpiredAt,
            status: data.status ?? PointRecordStatus.VALID,
            remark: data.remark ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return record
}

/** 兑换码创建输入类型 */
export interface TestRedemptionCodeInput {
    code?: string
    type?: number
    levelId?: number | null
    duration?: number | null
    pointAmount?: number | null
    expiredAt?: Date | null
    status?: number
    remark?: string | null
}

/**
 * 创建测试兑换码
 * @param levelId 会员级别 ID（可选，仅会员类型需要）
 * @param data 兑换码数据（可选）
 * @returns 创建的兑换码记录
 */
export const createTestRedemptionCode = async (
    levelId?: number | null,
    data: TestRedemptionCodeInput = {}
): Promise<Prisma.redemptionCodesGetPayload<{}>> => {
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 8).toUpperCase()
    const defaultExpiredAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)

    // 处理可选字段，支持显式传入 null
    const duration = 'duration' in data ? data.duration : 30
    const pointAmount = 'pointAmount' in data ? data.pointAmount : 100

    const redemptionCode = await testPrisma.redemptionCodes.create({
        data: {
            code: data.code || `${TEST_CODE_PREFIX}${timestamp}_${random}`,
            type: data.type ?? RedemptionCodeType.MEMBERSHIP_AND_POINTS,
            levelId: levelId ?? data.levelId ?? null,
            duration,
            pointAmount,
            expiredAt: data.expiredAt ?? defaultExpiredAt,
            status: data.status ?? RedemptionCodeStatus.VALID,
            remark: data.remark ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return redemptionCode
}

/** 营销活动创建输入类型 */
export interface TestCampaignInput {
    name?: string
    type?: number
    levelId?: number | null
    duration?: number | null
    giftPoint?: number | null
    startAt?: Date
    endAt?: Date
    status?: number
    remark?: string | null
}

/**
 * 创建测试营销活动
 * @param levelId 会员级别 ID（可选）
 * @param data 营销活动数据（可选）
 * @returns 创建的营销活动记录
 */
export const createTestCampaign = async (
    levelId?: number | null,
    data: TestCampaignInput = {}
): Promise<Prisma.campaignsGetPayload<{}>> => {
    const timestamp = Date.now()
    const now = new Date()
    const defaultStartAt = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const defaultEndAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

    const campaign = await testPrisma.campaigns.create({
        data: {
            name: data.name || `${TEST_CAMPAIGN_NAME_PREFIX}${timestamp}`,
            type: data.type ?? CampaignType.REGISTER_GIFT,
            levelId: levelId ?? data.levelId ?? null,
            duration: data.duration ?? 30,
            giftPoint: data.giftPoint ?? 100,
            startAt: data.startAt ?? defaultStartAt,
            endAt: data.endAt ?? defaultEndAt,
            status: data.status ?? 1,
            remark: data.remark ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return campaign
}

/** 兑换记录创建输入类型 */
export interface TestRedemptionRecordInput {
    // 暂无额外字段
}

/**
 * 创建测试兑换记录
 * @param userId 用户 ID
 * @param codeId 兑换码 ID
 * @param data 兑换记录数据（可选）
 * @returns 创建的兑换记录
 */
export const createTestRedemptionRecord = async (
    userId: number,
    codeId: number,
    data: TestRedemptionRecordInput = {}
): Promise<Prisma.redemptionRecordsGetPayload<{}>> => {
    const record = await testPrisma.redemptionRecords.create({
        data: {
            userId,
            codeId,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return record
}

/** 订单创建输入类型 */
export interface TestOrderInput {
    orderNo?: string
    productId?: number
    amount?: number
    duration?: number
    durationUnit?: string
    orderType?: string
    status?: number
    expiredAt?: Date
    remark?: string
}

/** 产品创建输入类型 */
export interface TestProductInput {
    name?: string
    type?: number
    levelId?: number | null
    priceMonthly?: number
    priceYearly?: number
    giftPoint?: number
    status?: number
}

/**
 * 创建测试产品
 * @param levelId 会员级别 ID（可选）
 * @param data 产品数据（可选）
 * @returns 创建的产品记录
 */
export const createTestProduct = async (
    levelId?: number | null,
    data: TestProductInput = {}
): Promise<Prisma.productsGetPayload<{}>> => {
    const timestamp = Date.now()
    const random = Math.floor(Math.random() * 10000)

    const product = await getTestPrisma().products.create({
        data: {
            name: data.name || `测试产品_${timestamp}_${random}`,
            type: data.type ?? 1, // 1-会员商品
            levelId: levelId ?? data.levelId ?? null,
            priceMonthly: data.priceMonthly ?? 99,
            priceYearly: data.priceYearly ?? 999,
            giftPoint: data.giftPoint ?? 100,
            status: data.status ?? 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return product
}

/**
 * 创建测试订单
 * @param userId 用户 ID
 * @param productId 产品 ID
 * @param data 订单数据（可选）
 * @returns 创建的订单记录
 */
export const createTestOrder = async (
    userId: number,
    productId: number,
    data: TestOrderInput = {}
): Promise<Prisma.ordersGetPayload<{}>> => {
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 8).toUpperCase()
    const defaultExpiredAt = new Date(Date.now() + 30 * 60 * 1000) // 30分钟后过期

    const order = await getTestPrisma().orders.create({
        data: {
            userId,
            orderNo: data.orderNo || `TEST_ORDER_${timestamp}_${random}`,
            productId,
            amount: data.amount ?? 100,
            duration: data.duration ?? 1,
            durationUnit: data.durationUnit ?? 'year',
            orderType: data.orderType ?? 'purchase',
            status: data.status ?? 1,
            expiredAt: data.expiredAt ?? defaultExpiredAt,
            remark: data.remark ?? '测试订单',
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return order
}

/** 会员升级记录创建输入类型 */
export interface TestMembershipUpgradeRecordInput {
    orderId: number
    upgradePrice?: number
    pointCompensation?: number
}

/**
 * 创建测试会员升级记录
 * @param userId 用户 ID
 * @param fromMembershipId 原会员记录 ID
 * @param toMembershipId 新会员记录 ID
 * @param orderId 订单 ID
 * @param data 升级记录数据（可选）
 * @returns 创建的升级记录
 */
export const createTestMembershipUpgradeRecord = async (
    userId: number,
    fromMembershipId: number,
    toMembershipId: number,
    orderId: number,
    data: Partial<TestMembershipUpgradeRecordInput> = {}
): Promise<Prisma.membershipUpgradeRecordsGetPayload<{}>> => {
    const record = await getTestPrisma().membershipUpgradeRecords.create({
        data: {
            userId,
            fromMembershipId,
            toMembershipId,
            orderId,
            upgradePrice: data.upgradePrice ?? 0,
            pointCompensation: data.pointCompensation ?? 0,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return record
}

// ==================== 测试数据清理函数 ====================

/**
 * 清理测试数据（按外键顺序删除）
 * @param testIds 测试数据 ID 追踪对象
 */
export const cleanupTestData = async (testIds: TestIds): Promise<void> => {
    try {
        // 1. 删除用户相关的所有会员升级记录（包括系统自动创建的）- 必须先删除，因为有外键引用 userMemberships
        if (testIds.userIds.length > 0) {
            await testPrisma.membershipUpgradeRecords.deleteMany({
                where: { userId: { in: testIds.userIds } },
            })
        }

        // 2. 删除会员升级记录（按 ID）
        if (testIds.membershipUpgradeRecordIds.length > 0) {
            await testPrisma.membershipUpgradeRecords.deleteMany({
                where: { id: { in: testIds.membershipUpgradeRecordIds } },
            })
        }

        // 3. 删除兑换记录
        if (testIds.redemptionRecordIds.length > 0) {
            await testPrisma.redemptionRecords.deleteMany({
                where: { id: { in: testIds.redemptionRecordIds } },
            })
        }

        // 4. 删除用户相关的所有积分记录（包括系统自动创建的）
        if (testIds.userIds.length > 0) {
            await testPrisma.pointRecords.deleteMany({
                where: { userId: { in: testIds.userIds } },
            })
        }

        // 5. 删除积分记录（按 ID）
        if (testIds.pointRecordIds.length > 0) {
            await testPrisma.pointRecords.deleteMany({
                where: { id: { in: testIds.pointRecordIds } },
            })
        }

        // 6. 删除用户相关的所有会员记录（包括系统自动创建的）
        if (testIds.userIds.length > 0) {
            await testPrisma.userMemberships.deleteMany({
                where: { userId: { in: testIds.userIds } },
            })
        }

        // 7. 删除用户会员记录（按 ID）
        if (testIds.userMembershipIds.length > 0) {
            await testPrisma.userMemberships.deleteMany({
                where: { id: { in: testIds.userMembershipIds } },
            })
        }

        // 8. 删除订单
        if (testIds.orderIds.length > 0) {
            await testPrisma.orders.deleteMany({
                where: { id: { in: testIds.orderIds } },
            })
        }

        // 9. 删除产品
        if (testIds.productIds.length > 0) {
            await testPrisma.products.deleteMany({
                where: { id: { in: testIds.productIds } },
            })
        }

        // 10. 删除兑换码
        if (testIds.redemptionCodeIds.length > 0) {
            await testPrisma.redemptionCodes.deleteMany({
                where: { id: { in: testIds.redemptionCodeIds } },
            })
        }

        // 11. 删除营销活动
        if (testIds.campaignIds.length > 0) {
            await testPrisma.campaigns.deleteMany({
                where: { id: { in: testIds.campaignIds } },
            })
        }

        // 12. 删除会员级别
        if (testIds.membershipLevelIds.length > 0) {
            await testPrisma.membershipLevels.deleteMany({
                where: { id: { in: testIds.membershipLevelIds } },
            })
        }

        // 13. 删除用户
        if (testIds.userIds.length > 0) {
            await testPrisma.users.deleteMany({
                where: { id: { in: testIds.userIds } },
            })
        }
    } catch (error) {
        console.warn('清理测试数据时出错：', error)
    }
}

/**
 * 清理所有测试数据（使用测试标记前缀）
 * 用于清理残留的测试数据
 *
 * 删除顺序遵循外键依赖拓扑排序（叶表→父表）：
 * 1. 最深层叶表（无子表引用）
 * 2. 中间层（被叶表引用的表）
 * 3. 根表（users, membershipLevels 等）
 */
export const cleanupAllTestData = async (): Promise<void> => {
    try {
        // ===== 第一步：收集测试数据 ID =====
        const testUsers = await testPrisma.users.findMany({
            where: { phone: { startsWith: TEST_USER_PHONE_PREFIX } },
            select: { id: true },
        })
        const userIds = testUsers.map(u => u.id)

        const testCodes = await testPrisma.redemptionCodes.findMany({
            where: { code: { startsWith: TEST_CODE_PREFIX } },
            select: { id: true },
        })
        const codeIds = testCodes.map(c => c.id)

        const testLevels = await testPrisma.membershipLevels.findMany({
            where: { name: { startsWith: TEST_LEVEL_NAME_PREFIX } },
            select: { id: true },
        })
        const levelIds = testLevels.map(l => l.id)

        // ===== 第二步：删除叶表数据（按用户关联） =====
        if (userIds.length > 0) {
            // 案件分析结果（依赖 cases + caseSessions）
            const testCases = await testPrisma.cases.findMany({
                where: { userId: { in: userIds } },
                select: { id: true },
            })
            const caseIds = testCases.map(c => c.id)

            if (caseIds.length > 0) {
                // caseAnalyses → cases, caseSessions
                await testPrisma.caseAnalyses.deleteMany({
                    where: { caseId: { in: caseIds } },
                })
                // caseSessions → cases
                await testPrisma.caseSessions.deleteMany({
                    where: { caseId: { in: caseIds } },
                })
            }

            // 积分消耗记录（依赖 pointRecords + users）
            await testPrisma.pointConsumptionRecords.deleteMany({
                where: { userId: { in: userIds } },
            })

            // 查找用户的会员记录 ID，用于清理 membershipUpgradeRecords 的 fromMembershipId/toMembershipId
            const testMemberships = await testPrisma.userMemberships.findMany({
                where: { userId: { in: userIds } },
                select: { id: true },
            })
            const membershipIds = testMemberships.map(m => m.id)

            // 会员升级记录（依赖 users + orders + userMemberships）
            await testPrisma.membershipUpgradeRecords.deleteMany({
                where: { userId: { in: userIds } },
            })
            // 也清理引用测试用户会员的升级记录
            if (membershipIds.length > 0) {
                await testPrisma.membershipUpgradeRecords.deleteMany({
                    where: {
                        OR: [
                            { fromMembershipId: { in: membershipIds } },
                            { toMembershipId: { in: membershipIds } },
                        ],
                    },
                })
            }

            // 查找用户订单 ID，用于清理 paymentTransactions
            const testOrders = await testPrisma.orders.findMany({
                where: { userId: { in: userIds } },
                select: { id: true },
            })
            if (testOrders.length > 0) {
                // paymentTransactions → orders
                await testPrisma.paymentTransactions.deleteMany({
                    where: { orderId: { in: testOrders.map(o => o.id) } },
                })
            }

            // 兑换记录（依赖 users + redemptionCodes）
            await testPrisma.redemptionRecords.deleteMany({
                where: { userId: { in: userIds } },
            })

            // 识别记录（依赖 users）
            await testPrisma.docRecognitionRecords.deleteMany({
                where: { userId: { in: userIds } },
            })
            await testPrisma.imageRecognitionRecords.deleteMany({
                where: { userId: { in: userIds } },
            })
            await testPrisma.asrRecords.deleteMany({
                where: { userId: { in: userIds } },
            })
            await testPrisma.mineruTasks.deleteMany({
                where: { userId: { in: userIds } },
            })

            // 用户权益（依赖 users）
            await testPrisma.userBenefits.deleteMany({
                where: { userId: { in: userIds } },
            })

            // ===== 第三步：删除中间层（依赖 users 的表） =====
            // 积分记录（被 pointConsumptionRecords 引用，已在上方清理）
            await testPrisma.pointRecords.deleteMany({
                where: { userId: { in: userIds } },
            })

            // 用户会员记录（被 membershipUpgradeRecords, pointRecords 引用，已清理）
            await testPrisma.userMemberships.deleteMany({
                where: { userId: { in: userIds } },
            })

            // 订单（被 paymentTransactions, membershipUpgradeRecords 引用，已清理）
            await testPrisma.orders.deleteMany({
                where: { userId: { in: userIds } },
            })

            // 案件（被 caseSessions, caseMaterials, caseAnalyses 引用，已清理）
            if (caseIds.length > 0) {
                // 删除所有 case_materials（无论是通过 case_id 还是 draft_id 引用的）
                await testPrisma.caseMaterials.deleteMany({
                    where: { caseId: { in: caseIds } },
                })
                // 删除所有引用这些 document_drafts 的 case_materials（以防有其他方式的引用）
                await testPrisma.$executeRaw`DELETE FROM case_materials WHERE draft_id IN (SELECT id FROM document_drafts WHERE case_id = ANY(${caseIds}::integer[]))`
                // 删除与案件关联的 document_drafts（需要按外键顺序删除）
                await testPrisma.$executeRaw`DELETE FROM document_draft_snapshots WHERE draft_id IN (SELECT id FROM document_drafts WHERE case_id = ANY(${caseIds}::integer[]))`
                await testPrisma.$executeRaw`DELETE FROM document_draft_versions WHERE draft_id IN (SELECT id FROM document_drafts WHERE case_id = ANY(${caseIds}::integer[]))`
                await testPrisma.$executeRaw`DELETE FROM document_drafts WHERE case_id = ANY(${caseIds}::integer[])`
                await testPrisma.cases.deleteMany({
                    where: { id: { in: caseIds } },
                })
            }

            // 先清理用户的 document_drafts（含 case_id=null 的 draft-only 记录）
            // 这些 drafts 可能引用了用户的 document_templates，必须先删 drafts 才能删 templates
            await testPrisma.$executeRaw`DELETE FROM case_materials WHERE draft_id IN (SELECT id FROM document_drafts WHERE user_id = ANY(${userIds}::integer[]))`
            await testPrisma.$executeRaw`DELETE FROM document_draft_snapshots WHERE draft_id IN (SELECT id FROM document_drafts WHERE user_id = ANY(${userIds}::integer[]))`
            await testPrisma.$executeRaw`DELETE FROM document_draft_versions WHERE draft_id IN (SELECT id FROM document_drafts WHERE user_id = ANY(${userIds}::integer[]))`
            await testPrisma.$executeRaw`DELETE FROM document_drafts WHERE user_id = ANY(${userIds}::integer[])`
            // 删除用户关联的 document_templates
            await testPrisma.$executeRaw`DELETE FROM document_templates WHERE user_id = ANY(${userIds}::integer[])`
        }

        // ===== 第四步：删除兑换码关联数据 =====
        if (codeIds.length > 0) {
            await testPrisma.redemptionRecords.deleteMany({
                where: { codeId: { in: codeIds } },
            })
        }

        // ===== 第五步：删除测试产品（被 orders 引用，测试用户订单已清理） =====
        // 先清理引用测试产品的订单
        const testProducts = await testPrisma.products.findMany({
            where: { name: { startsWith: '测试产品_' } },
            select: { id: true },
        })
        if (testProducts.length > 0) {
            const productIds = testProducts.map(p => p.id)
            // 清理引用测试产品的支付记录和订单
            const productOrders = await testPrisma.orders.findMany({
                where: { productId: { in: productIds } },
                select: { id: true },
            })
            if (productOrders.length > 0) {
                await testPrisma.paymentTransactions.deleteMany({
                    where: { orderId: { in: productOrders.map(o => o.id) } },
                })
                await testPrisma.membershipUpgradeRecords.deleteMany({
                    where: { orderId: { in: productOrders.map(o => o.id) } },
                })
                await testPrisma.orders.deleteMany({
                    where: { productId: { in: productIds } },
                })
            }
        }
        await testPrisma.products.deleteMany({
            where: { name: { startsWith: '测试产品_' } },
        })

        // ===== 第六步：删除测试兑换码 =====
        await testPrisma.redemptionCodes.deleteMany({
            where: { code: { startsWith: TEST_CODE_PREFIX } },
        })

        // ===== 第七步：删除测试营销活动（campaigns 是叶表，无子表引用） =====
        await testPrisma.campaigns.deleteMany({
            where: { name: { startsWith: TEST_CAMPAIGN_NAME_PREFIX } },
        })

        // ===== 第八步：删除测试会员级别（先清理所有引用） =====
        if (levelIds.length > 0) {
            await testPrisma.redemptionCodes.deleteMany({
                where: { levelId: { in: levelIds } },
            })
            await testPrisma.levelNodeAccess.deleteMany({
                where: { levelId: { in: levelIds } },
            })
            await testPrisma.membershipBenefits.deleteMany({
                where: { levelId: { in: levelIds } },
            })
            await testPrisma.userMemberships.deleteMany({
                where: { levelId: { in: levelIds } },
            })
            await testPrisma.products.deleteMany({
                where: { levelId: { in: levelIds } },
            })
            await testPrisma.campaigns.deleteMany({
                where: { levelId: { in: levelIds } },
            })
        }
        await testPrisma.membershipLevels.deleteMany({
            where: { name: { startsWith: TEST_LEVEL_NAME_PREFIX } },
        })

        // ===== 第九步：删除测试用户（所有子表已清理） =====
        await testPrisma.users.deleteMany({
            where: { phone: { startsWith: TEST_USER_PHONE_PREFIX } },
        })

        console.log('已清理所有测试数据')
    } catch (error) {
        console.warn('清理所有测试数据时出错：', error)
    }
}

// ==================== 数据库连接管理 ====================

/**
 * 连接数据库
 */
export const connectTestDb = async (): Promise<void> => {
    await getTestPrisma().$connect()
}

/**
 * 断开数据库连接
 */
export { disconnectWorkerPrisma as disconnectTestDb } from '../../_infra/worker-prisma'

/**
 * 检查数据库连接是否可用
 * @returns 是否可用
 */
export const isTestDbAvailable = async (): Promise<boolean> => {
    try {
        const prisma = getTestPrisma()
        await prisma.$queryRaw`SELECT 1`
        return true
    } catch (error) {
        console.warn('数据库连接检查失败：', error)
        return false
    }
}

/**
 * 重置数据库序列
 * 确保测试创建的记录不会与种子数据冲突
 */
export const resetDatabaseSequences = async (): Promise<void> => {
    try {
        const prisma = getTestPrisma()
        // 先清理所有测试数据，避免残留数据导致唯一约束冲突
        await cleanupAllTestData()
        // 全表 sequence 重置：避免任何 (id) 冲突
        // 用 SELECT setval(name, MAX+1, false) 让下次 nextval 返回 MAX+1（绝不冲突）
        await prisma.$executeRawUnsafe(`
            DO $$
            DECLARE
                seq_record RECORD;
                table_name TEXT;
                max_id BIGINT;
            BEGIN
                FOR seq_record IN
                    SELECT
                        s.relname AS sequence_name,
                        d.adrelid::regclass::text AS table_name
                    FROM pg_class s
                    JOIN pg_attrdef d ON pg_get_expr(d.adbin, d.adrelid) LIKE 'nextval%' || s.relname || '%'
                    WHERE s.relkind = 'S'
                      AND s.relnamespace = 'public'::regnamespace
                LOOP
                    EXECUTE format(
                        'SELECT setval(%L, GREATEST(COALESCE((SELECT MAX(id) FROM %I), 0), 1000) + 1, false)',
                        seq_record.sequence_name,
                        seq_record.table_name
                    );
                END LOOP;
            END $$;
        `)
    } catch (error) {
        console.warn('重置数据库序列时出错：', error)
    }
}
