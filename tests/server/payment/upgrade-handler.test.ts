/**
 * 会员升级处理器测试
 *
 * 测试 upgradeHandler 的功能，包括：
 * - parseMembershipIdFromRemark 函数
 * - canHandle 判断逻辑
 * - handle 处理逻辑
 *
 * **Feature: upgrade-handler**
 * **Validates: Requirements 1.1, 1.2, 2.1**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { OrderStatus, OrderType } from '../../../shared/types/payment'
import { ProductType } from '../../../shared/types/product'
import { MembershipStatus, UserMembershipSourceType } from '../../../shared/types/membership'

// 导入被测试的处理器
import { upgradeHandler } from '../../../server/services/payment/handlers/upgradeHandler'

// 加载环境变量
config()

// 创建测试数据库连接
const createTestPrisma = () => {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
        throw new Error('DATABASE_URL 环境变量未设置')
    }
    const pool = new PrismaPg({ connectionString })
    return new PrismaClient({ adapter: pool })
}

const prisma = createTestPrisma()

// 测试数据 ID 追踪
const testIds = {
    userIds: [] as number[],
    productIds: [] as number[],
    orderIds: [] as number[],
    membershipLevelIds: [] as number[],
    userMembershipIds: [] as number[],
    membershipUpgradeRecordIds: [] as number[],
    pointRecordIds: [] as number[],
}

// 生成唯一的测试标识
const generateTestId = () => `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

// 创建测试用户
const createTestUser = async () => {
    const testId = generateTestId()
    const user = await prisma.users.create({
        data: {
            phone: `138${Date.now().toString().slice(-8)}`,
            name: `测试用户_${testId}`,
            password: 'test_password_hash',
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    testIds.userIds.push(user.id)
    return user
}

// 创建测试会员级别
const createTestMembershipLevel = async (options: { sortOrder?: number; name?: string } = {}) => {
    const testId = generateTestId()
    const level = await prisma.membershipLevels.create({
        data: {
            name: options.name ?? `测试级别_${testId}`,
            sortOrder: options.sortOrder ?? Math.floor(Math.random() * 1000) + 100,
            status: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    testIds.membershipLevelIds.push(level.id)
    return level
}

// 创建测试商品
const createTestProduct = async (levelId: number, options: { type?: number; priceYearly?: number } = {}) => {
    const testId = generateTestId()
    const product = await prisma.products.create({
        data: {
            name: `测试商品_${testId}`,
            type: options.type ?? ProductType.MEMBERSHIP,
            level: { connect: { id: levelId } },
            priceMonthly: 99,
            priceYearly: options.priceYearly ?? 999,
            giftPoint: 100,
            status: 1,
            sortOrder: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    testIds.productIds.push(product.id)
    return product
}

// 创建测试订单
const createTestOrder = async (
    userId: number,
    productId: number,
    options: {
        orderType?: string
        status?: number
        remark?: string | null
    } = {}
) => {
    const order = await prisma.orders.create({
        data: {
            orderNo: `LSD${Date.now()}${Math.random().toString().slice(2, 8)}`,
            userId,
            productId,
            amount: 500,
            duration: 1,
            durationUnit: 'year',
            orderType: options.orderType ?? OrderType.UPGRADE,
            status: options.status ?? OrderStatus.PAID,
            remark: options.remark ?? null,
            expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            createdAt: new Date(),
            updatedAt: new Date(),
        },
        include: { product: true },
    })
    testIds.orderIds.push(order.id)
    return order
}

// 创建测试会员记录
const createTestUserMembership = async (
    userId: number,
    levelId: number,
    options: {
        status?: number
        startDate?: Date
        endDate?: Date
        sourceType?: string
        sourceId?: number
    } = {}
) => {
    const now = new Date()
    const membership = await prisma.userMemberships.create({
        data: {
            userId,
            levelId,
            startDate: options.startDate ?? now,
            endDate: options.endDate ?? new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
            status: options.status ?? MembershipStatus.ACTIVE,
            sourceType: options.sourceType ?? UserMembershipSourceType.DIRECT_PURCHASE,
            sourceId: options.sourceId ?? null,
            createdAt: now,
            updatedAt: now,
        },
    })
    testIds.userMembershipIds.push(membership.id)
    return membership
}

// 清理测试数据
const cleanupTestData = async () => {
    // 按依赖顺序删除
    if (testIds.pointRecordIds.length > 0) {
        await prisma.pointRecords.deleteMany({ where: { id: { in: testIds.pointRecordIds } } })
        testIds.pointRecordIds = []
    }
    if (testIds.membershipUpgradeRecordIds.length > 0) {
        await prisma.membershipUpgradeRecords.deleteMany({ where: { id: { in: testIds.membershipUpgradeRecordIds } } })
        testIds.membershipUpgradeRecordIds = []
    }
    if (testIds.orderIds.length > 0) {
        await prisma.orders.deleteMany({ where: { id: { in: testIds.orderIds } } })
        testIds.orderIds = []
    }
    if (testIds.userMembershipIds.length > 0) {
        await prisma.userMemberships.deleteMany({ where: { id: { in: testIds.userMembershipIds } } })
        testIds.userMembershipIds = []
    }
    if (testIds.productIds.length > 0) {
        await prisma.products.deleteMany({ where: { id: { in: testIds.productIds } } })
        testIds.productIds = []
    }
    if (testIds.membershipLevelIds.length > 0) {
        await prisma.membershipLevels.deleteMany({ where: { id: { in: testIds.membershipLevelIds } } })
        testIds.membershipLevelIds = []
    }
    if (testIds.userIds.length > 0) {
        await prisma.users.deleteMany({ where: { id: { in: testIds.userIds } } })
        testIds.userIds = []
    }
}

describe('会员升级处理器测试', () => {
    beforeAll(async () => {
        try {
            await prisma.$connect()
            // 重置数据库序列，避免与种子数据冲突
            await prisma.$executeRaw`SELECT setval('users_id_seq', GREATEST((SELECT MAX(id) FROM users), 1000))`
            await prisma.$executeRaw`SELECT setval('membership_levels_id_seq', GREATEST((SELECT MAX(id) FROM membership_levels), 1000))`
            await prisma.$executeRaw`SELECT setval('products_id_seq', GREATEST((SELECT MAX(id) FROM products), 1000))`
            await prisma.$executeRaw`SELECT setval('orders_id_seq', GREATEST((SELECT MAX(id) FROM orders), 1000))`
            await prisma.$executeRaw`SELECT setval('user_memberships_id_seq', GREATEST((SELECT MAX(id) FROM user_memberships), 1000))`
            await prisma.$executeRaw`SELECT setval('point_records_id_seq', GREATEST((SELECT MAX(id) FROM point_records), 1000))`
            await prisma.$executeRaw`SELECT setval('membership_upgrade_records_id_seq', GREATEST((SELECT MAX(id) FROM membership_upgrade_records), 1000))`
        } catch (error) {
            console.warn('数据库连接失败，跳过测试')
        }
    })

    afterEach(async () => {
        await cleanupTestData()
    })

    afterAll(async () => {
        await prisma.$disconnect()
    })

    describe('canHandle 判断逻辑', () => {
        it('会员商品 + 升级订单类型应返回 true', async () => {
            const user = await createTestUser()
            const level = await createTestMembershipLevel()
            const product = await createTestProduct(level.id, { type: ProductType.MEMBERSHIP })
            const order = await createTestOrder(user.id, product.id, { orderType: OrderType.UPGRADE })

            const result = upgradeHandler.canHandle(order as any)
            expect(result).toBe(true)
        })

        it('会员商品 + 新购订单类型应返回 false', async () => {
            const user = await createTestUser()
            const level = await createTestMembershipLevel()
            const product = await createTestProduct(level.id, { type: ProductType.MEMBERSHIP })
            const order = await createTestOrder(user.id, product.id, { orderType: OrderType.PURCHASE })

            const result = upgradeHandler.canHandle(order as any)
            expect(result).toBe(false)
        })

        it('积分商品 + 升级订单类型应返回 false', async () => {
            const user = await createTestUser()
            const level = await createTestMembershipLevel()
            const product = await createTestProduct(level.id, { type: ProductType.POINTS })
            const order = await createTestOrder(user.id, product.id, { orderType: OrderType.UPGRADE })

            const result = upgradeHandler.canHandle(order as any)
            expect(result).toBe(false)
        })
    })

    describe('parseMembershipIdFromRemark 解析逻辑', () => {
        it('应正确解析 JSON 格式的 remark 中的 membershipId', async () => {
            const user = await createTestUser()
            const currentLevel = await createTestMembershipLevel({ sortOrder: 1 })
            const targetLevel = await createTestMembershipLevel({ sortOrder: 2 })

            // 创建当前会员
            const membership = await createTestUserMembership(user.id, currentLevel.id)

            // 创建目标商品
            const product = await createTestProduct(targetLevel.id)

            // 创建带 membershipId 的升级订单
            const remark = JSON.stringify({ membershipId: membership.id })
            const order = await createTestOrder(user.id, product.id, {
                orderType: OrderType.UPGRADE,
                remark,
            })

            // 执行升级处理
            await upgradeHandler.handle(order as any, prisma)

            // 验证升级记录
            const upgradeRecords = await prisma.membershipUpgradeRecords.findMany({
                where: { userId: user.id, fromMembershipId: membership.id },
            })
            expect(upgradeRecords.length).toBe(1)
            testIds.membershipUpgradeRecordIds.push(upgradeRecords[0].id)

            // 清理新创建的会员记录
            const newMemberships = await prisma.userMemberships.findMany({
                where: { userId: user.id, id: { not: membership.id } },
            })
            newMemberships.forEach(m => testIds.userMembershipIds.push(m.id))

            // 清理新创建的积分记录
            const newPointRecords = await prisma.pointRecords.findMany({
                where: { userId: user.id },
            })
            newPointRecords.forEach(r => testIds.pointRecordIds.push(r.id))
        })

        it('remark 为 null 时应使用当前生效的会员', async () => {
            const user = await createTestUser()
            const currentLevel = await createTestMembershipLevel({ sortOrder: 1 })
            const targetLevel = await createTestMembershipLevel({ sortOrder: 2 })

            // 创建当前会员
            const membership = await createTestUserMembership(user.id, currentLevel.id)

            // 创建目标商品
            const product = await createTestProduct(targetLevel.id)

            // 创建不带 remark 的升级订单
            const order = await createTestOrder(user.id, product.id, {
                orderType: OrderType.UPGRADE,
                remark: null,
            })

            // 执行升级处理
            await upgradeHandler.handle(order as any, prisma)

            // 验证升级记录（应该使用当前生效的会员）
            const upgradeRecords = await prisma.membershipUpgradeRecords.findMany({
                where: { userId: user.id, fromMembershipId: membership.id },
            })
            expect(upgradeRecords.length).toBe(1)
            testIds.membershipUpgradeRecordIds.push(upgradeRecords[0].id)

            // 清理
            const newMemberships = await prisma.userMemberships.findMany({
                where: { userId: user.id, id: { not: membership.id } },
            })
            newMemberships.forEach(m => testIds.userMembershipIds.push(m.id))

            const newPointRecords = await prisma.pointRecords.findMany({
                where: { userId: user.id },
            })
            newPointRecords.forEach(r => testIds.pointRecordIds.push(r.id))
        })

        it('remark 为非 JSON 字符串时应使用当前生效的会员', async () => {
            const user = await createTestUser()
            const currentLevel = await createTestMembershipLevel({ sortOrder: 1 })
            const targetLevel = await createTestMembershipLevel({ sortOrder: 2 })

            // 创建当前会员
            const membership = await createTestUserMembership(user.id, currentLevel.id)

            // 创建目标商品
            const product = await createTestProduct(targetLevel.id)

            // 创建带普通字符串 remark 的升级订单
            const order = await createTestOrder(user.id, product.id, {
                orderType: OrderType.UPGRADE,
                remark: '普通备注文本',
            })

            // 执行升级处理
            await upgradeHandler.handle(order as any, prisma)

            // 验证升级记录
            const upgradeRecords = await prisma.membershipUpgradeRecords.findMany({
                where: { userId: user.id, fromMembershipId: membership.id },
            })
            expect(upgradeRecords.length).toBe(1)
            testIds.membershipUpgradeRecordIds.push(upgradeRecords[0].id)

            // 清理
            const newMemberships = await prisma.userMemberships.findMany({
                where: { userId: user.id, id: { not: membership.id } },
            })
            newMemberships.forEach(m => testIds.userMembershipIds.push(m.id))

            const newPointRecords = await prisma.pointRecords.findMany({
                where: { userId: user.id },
            })
            newPointRecords.forEach(r => testIds.pointRecordIds.push(r.id))
        })
    })

    describe('handle 处理逻辑', () => {
        it('商品未关联会员级别时应抛出错误', async () => {
            const user = await createTestUser()

            // 创建未关联级别的商品
            const product = await prisma.products.create({
                data: {
                    name: `测试商品_${generateTestId()}`,
                    type: ProductType.MEMBERSHIP,
                    // 不关联级别
                    priceMonthly: 99,
                    priceYearly: 999,
                    giftPoint: 100,
                    status: 1,
                    sortOrder: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testIds.productIds.push(product.id)

            const order = await createTestOrder(user.id, product.id, { orderType: OrderType.UPGRADE })

            // 执行升级处理应抛出错误
            await expect(upgradeHandler.handle(order as any, prisma)).rejects.toThrow('会员商品未关联会员级别')
        })

        it('升级成功后应创建新会员记录', async () => {
            const user = await createTestUser()
            const currentLevel = await createTestMembershipLevel({ sortOrder: 1 })
            const targetLevel = await createTestMembershipLevel({ sortOrder: 2 })

            // 创建当前会员
            const membership = await createTestUserMembership(user.id, currentLevel.id)

            // 创建目标商品
            const product = await createTestProduct(targetLevel.id)

            // 创建升级订单
            const order = await createTestOrder(user.id, product.id, { orderType: OrderType.UPGRADE })

            // 执行升级处理
            await upgradeHandler.handle(order as any, prisma)

            // 验证新会员记录
            const newMembership = await prisma.userMemberships.findFirst({
                where: {
                    userId: user.id,
                    levelId: targetLevel.id,
                    status: MembershipStatus.ACTIVE,
                },
            })
            expect(newMembership).not.toBeNull()
            testIds.userMembershipIds.push(newMembership!.id)

            // 验证旧会员记录已结算
            const oldMembership = await prisma.userMemberships.findUnique({
                where: { id: membership.id },
            })
            expect(oldMembership!.status).toBe(MembershipStatus.SETTLED)

            // 清理升级记录
            const upgradeRecords = await prisma.membershipUpgradeRecords.findMany({
                where: { userId: user.id },
            })
            upgradeRecords.forEach(r => testIds.membershipUpgradeRecordIds.push(r.id))

            // 清理积分记录
            const pointRecords = await prisma.pointRecords.findMany({
                where: { userId: user.id },
            })
            pointRecords.forEach(r => testIds.pointRecordIds.push(r.id))
        })
    })
})
