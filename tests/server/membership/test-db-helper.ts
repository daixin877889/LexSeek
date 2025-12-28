/**
 * 测试数据库辅助模块
 *
 * 提供真实数据库操作的测试数据管理功能
 * 所有测试数据使用特定前缀标记，便于清理
 *
 * **Feature: test-infrastructure**
 * **Validates: Requirements 6.1, 6.2, 6.3**
 */

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '../../../generated/prisma/client'
import { config } from 'dotenv'

// 加载环境变量
config()

// 创建 Prisma 客户端实例（使用 pg 适配器）
const createTestPrismaClient = () => {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
        throw new Error('DATABASE_URL 环境变量未设置')
    }
    const pool = new PrismaPg({ connectionString })
    return new PrismaClient({ adapter: pool })
}

// 延迟初始化，避免在导入时就创建连接
let _testPrisma: ReturnType<typeof createTestPrismaClient> | null = null

export const getTestPrisma = () => {
    if (!_testPrisma) {
        _testPrisma = createTestPrismaClient()
    }
    return _testPrisma
}

// 为了兼容性，导出 testPrisma（延迟初始化）
export const testPrisma = new Proxy({} as ReturnType<typeof createTestPrismaClient>, {
    get(_, prop) {
        return (getTestPrisma() as any)[prop]
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
export const createTestUser = async (
    data: TestUserInput = {}
): Promise<Prisma.usersGetPayload<{}>> => {
    const timestamp = Date.now()
    const random = Math.floor(Math.random() * 10000)
    // 生成 11 位手机号：199 + 4位时间戳后缀 + 4位随机数
    const suffix = String(timestamp).slice(-4) + String(random).padStart(4, '0')
    const phone = data.phone || `199${suffix}`

    const user = await getTestPrisma().users.create({
        data: {
            name: data.name || `测试用户_${timestamp}`,
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

    const product = await getTestPrisma().products.create({
        data: {
            name: data.name || `测试产品_${timestamp}`,
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
        // 1. 删除会员升级记录
        if (testIds.membershipUpgradeRecordIds.length > 0) {
            await testPrisma.membershipUpgradeRecords.deleteMany({
                where: { id: { in: testIds.membershipUpgradeRecordIds } },
            })
        }

        // 2. 删除兑换记录
        if (testIds.redemptionRecordIds.length > 0) {
            await testPrisma.redemptionRecords.deleteMany({
                where: { id: { in: testIds.redemptionRecordIds } },
            })
        }

        // 3. 删除积分记录
        if (testIds.pointRecordIds.length > 0) {
            await testPrisma.pointRecords.deleteMany({
                where: { id: { in: testIds.pointRecordIds } },
            })
        }

        // 4. 删除用户会员记录
        if (testIds.userMembershipIds.length > 0) {
            await testPrisma.userMemberships.deleteMany({
                where: { id: { in: testIds.userMembershipIds } },
            })
        }

        // 5. 删除订单
        if (testIds.orderIds.length > 0) {
            await testPrisma.orders.deleteMany({
                where: { id: { in: testIds.orderIds } },
            })
        }

        // 6. 删除产品
        if (testIds.productIds.length > 0) {
            await testPrisma.products.deleteMany({
                where: { id: { in: testIds.productIds } },
            })
        }

        // 7. 删除兑换码
        if (testIds.redemptionCodeIds.length > 0) {
            await testPrisma.redemptionCodes.deleteMany({
                where: { id: { in: testIds.redemptionCodeIds } },
            })
        }

        // 8. 删除营销活动
        if (testIds.campaignIds.length > 0) {
            await testPrisma.campaigns.deleteMany({
                where: { id: { in: testIds.campaignIds } },
            })
        }

        // 9. 删除会员级别
        if (testIds.membershipLevelIds.length > 0) {
            await testPrisma.membershipLevels.deleteMany({
                where: { id: { in: testIds.membershipLevelIds } },
            })
        }

        // 10. 删除用户相关的所有积分记录（包括系统自动创建的）
        if (testIds.userIds.length > 0) {
            await testPrisma.pointRecords.deleteMany({
                where: { userId: { in: testIds.userIds } },
            })
        }

        // 11. 删除用户相关的所有会员记录（包括系统自动创建的）
        if (testIds.userIds.length > 0) {
            await testPrisma.userMemberships.deleteMany({
                where: { userId: { in: testIds.userIds } },
            })
        }

        // 12. 删除用户
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
 */
export const cleanupAllTestData = async (): Promise<void> => {
    try {
        // 1. 删除测试兑换记录（通过兑换码关联）
        const testCodes = await testPrisma.redemptionCodes.findMany({
            where: { code: { startsWith: TEST_CODE_PREFIX } },
            select: { id: true },
        })
        if (testCodes.length > 0) {
            await testPrisma.redemptionRecords.deleteMany({
                where: { codeId: { in: testCodes.map(c => c.id) } },
            })
        }

        // 2. 删除测试用户的积分记录
        const testUsers = await testPrisma.users.findMany({
            where: { phone: { startsWith: TEST_USER_PHONE_PREFIX } },
            select: { id: true },
        })
        if (testUsers.length > 0) {
            const userIds = testUsers.map(u => u.id)

            // 删除会员升级记录
            await testPrisma.membershipUpgradeRecords.deleteMany({
                where: { userId: { in: userIds } },
            })

            // 删除积分记录
            await testPrisma.pointRecords.deleteMany({
                where: { userId: { in: userIds } },
            })

            // 删除用户会员记录
            await testPrisma.userMemberships.deleteMany({
                where: { userId: { in: userIds } },
            })
        }

        // 3. 删除测试兑换码
        await testPrisma.redemptionCodes.deleteMany({
            where: { code: { startsWith: TEST_CODE_PREFIX } },
        })

        // 4. 删除测试营销活动
        await testPrisma.campaigns.deleteMany({
            where: { name: { startsWith: TEST_CAMPAIGN_NAME_PREFIX } },
        })

        // 5. 删除测试会员级别
        await testPrisma.membershipLevels.deleteMany({
            where: { name: { startsWith: TEST_LEVEL_NAME_PREFIX } },
        })

        // 6. 删除测试用户
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
export const disconnectTestDb = async (): Promise<void> => {
    if (_testPrisma) {
        await _testPrisma.$disconnect()
        _testPrisma = null
    }
}

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
