/**
 * 会员商品支付处理器测试
 *
 * 测试 membershipHandler 的功能，包括：
 * - canHandle 判断逻辑
 * - 处理器配置验证
 *
 * **Feature: membership-handler**
 * **Validates: Requirements 1.1, 1.2, 2.1**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { resolve } from 'node:path'
import { OrderStatus, OrderType } from '../../../shared/types/payment'
import { ProductType } from '../../../shared/types/product'

// 导入被测试的处理器
import { membershipHandler } from '../../../server/services/payment/handlers/membershipHandler'

// 加载测试环境变量（强制指向 .env.testing，避免误连生产库）
config({ path: resolve(__dirname, '../../../.env.testing') })

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
const createTestProduct = async (
    levelId: number | null,
    options: { type?: number; giftPoint?: number } = {}
) => {
    const testId = generateTestId()
    const product = await prisma.products.create({
        data: {
            name: `测试商品_${testId}`,
            type: options.type ?? ProductType.MEMBERSHIP,
            levelId: levelId,
            priceMonthly: 99,
            priceYearly: 999,
            giftPoint: options.giftPoint ?? 100,
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
        duration?: number
        durationUnit?: string
    } = {}
) => {
    const order = await prisma.orders.create({
        data: {
            orderNo: `LSD${Date.now()}${Math.random().toString().slice(2, 8)}`,
            userId,
            productId,
            amount: 999,
            duration: options.duration ?? 1,
            durationUnit: options.durationUnit ?? 'year',
            orderType: options.orderType ?? OrderType.PURCHASE,
            status: options.status ?? OrderStatus.PAID,
            expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            createdAt: new Date(),
            updatedAt: new Date(),
        },
        include: { product: true },
    })
    testIds.orderIds.push(order.id)
    return order
}

// 清理测试数据
const cleanupTestData = async () => {
    try {
        // 1. 按 userId 兜底删除会员升级记录（handler 可能自动创建）
        if (testIds.userIds.length > 0) {
            await prisma.membershipUpgradeRecords.deleteMany({
                where: { userId: { in: testIds.userIds } },
            })
        }

        // 2. 按 userId 兜底删除积分记录（handler 可能自动创建）
        if (testIds.userIds.length > 0) {
            await prisma.pointRecords.deleteMany({
                where: { userId: { in: testIds.userIds } },
            })
        }
        if (testIds.pointRecordIds.length > 0) {
            await prisma.pointRecords.deleteMany({
                where: { id: { in: testIds.pointRecordIds } },
            })
        }

        // 3. 按 userId 兜底删除会员记录（handler 可能自动创建）
        if (testIds.userIds.length > 0) {
            await prisma.userMemberships.deleteMany({
                where: { userId: { in: testIds.userIds } },
            })
        }
        if (testIds.userMembershipIds.length > 0) {
            await prisma.userMemberships.deleteMany({
                where: { id: { in: testIds.userMembershipIds } },
            })
        }

        // 4. 删除订单
        if (testIds.orderIds.length > 0) {
            await prisma.orders.deleteMany({
                where: { id: { in: testIds.orderIds } },
            })
        }

        // 5. 删除商品
        if (testIds.productIds.length > 0) {
            await prisma.products.deleteMany({
                where: { id: { in: testIds.productIds } },
            })
        }

        // 6. 删除会员级别
        if (testIds.membershipLevelIds.length > 0) {
            await prisma.membershipLevels.deleteMany({
                where: { id: { in: testIds.membershipLevelIds } },
            })
        }

        // 7. 删除用户
        if (testIds.userIds.length > 0) {
            await prisma.users.deleteMany({
                where: { id: { in: testIds.userIds } },
            })
        }
    } catch (error) {
        console.warn('清理测试数据时出错：', error)
    }

    // 重置追踪数组
    testIds.userIds = []
    testIds.productIds = []
    testIds.orderIds = []
    testIds.membershipLevelIds = []
    testIds.userMembershipIds = []
    testIds.pointRecordIds = []
}

describe('会员商品支付处理器测试', () => {
    beforeAll(async () => {
        try {
            await prisma.$connect()
            // 重置数据库序列
            await prisma.$executeRaw`SELECT setval('users_id_seq', GREATEST((SELECT MAX(id) FROM users), 1000))`
            await prisma.$executeRaw`SELECT setval('membership_levels_id_seq', GREATEST((SELECT MAX(id) FROM membership_levels), 1000))`
            await prisma.$executeRaw`SELECT setval('products_id_seq', GREATEST((SELECT MAX(id) FROM products), 1000))`
            await prisma.$executeRaw`SELECT setval('orders_id_seq', GREATEST((SELECT MAX(id) FROM orders), 1000))`
            await prisma.$executeRaw`SELECT setval('user_memberships_id_seq', GREATEST((SELECT MAX(id) FROM user_memberships), 1000))`
            await prisma.$executeRaw`SELECT setval('point_records_id_seq', GREATEST((SELECT MAX(id) FROM point_records), 1000))`
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

    describe('处理器配置', () => {
        it('处理器名称应为 membership', () => {
            expect(membershipHandler.name).toBe('membership')
        })

        it('处理器应有 canHandle 方法', () => {
            expect(typeof membershipHandler.canHandle).toBe('function')
        })

        it('处理器应有 handle 方法', () => {
            expect(typeof membershipHandler.handle).toBe('function')
        })
    })

    describe('canHandle 判断逻辑', () => {
        it('会员商品 + 新购订单类型应返回 true', async () => {
            const user = await createTestUser()
            const level = await createTestMembershipLevel()
            const product = await createTestProduct(level.id, { type: ProductType.MEMBERSHIP })
            const order = await createTestOrder(user.id, product.id, { orderType: OrderType.PURCHASE })

            const result = membershipHandler.canHandle(order as any)
            expect(result).toBe(true)
        })

        it('会员商品 + 升级订单类型应返回 false', async () => {
            const user = await createTestUser()
            const level = await createTestMembershipLevel()
            const product = await createTestProduct(level.id, { type: ProductType.MEMBERSHIP })
            const order = await createTestOrder(user.id, product.id, { orderType: OrderType.UPGRADE })

            const result = membershipHandler.canHandle(order as any)
            expect(result).toBe(false)
        })

        it('积分商品应返回 false', async () => {
            const user = await createTestUser()
            const product = await createTestProduct(null, { type: ProductType.POINTS })
            const order = await createTestOrder(user.id, product.id, { orderType: OrderType.PURCHASE })

            const result = membershipHandler.canHandle(order as any)
            expect(result).toBe(false)
        })

        it('商品类型为 null 时应返回 false', async () => {
            const user = await createTestUser()
            const product = await createTestProduct(null, { type: ProductType.POINTS })
            const order = await createTestOrder(user.id, product.id)

            // 模拟 product 为 null 的情况
            const orderWithNullProduct = { ...order, product: null }
            const result = membershipHandler.canHandle(orderWithNullProduct as any)
            expect(result).toBe(false)
        })
    })

    describe('订单数据验证', () => {
        it('商品未关联会员级别时 handle 应抛出错误', async () => {
            const user = await createTestUser()
            // 创建未关联级别的会员商品
            const product = await createTestProduct(null, { type: ProductType.MEMBERSHIP })
            const order = await createTestOrder(user.id, product.id)

            // 验证 handle 会抛出错误
            await expect(membershipHandler.handle(order as any, prisma)).rejects.toThrow(
                '会员商品未关联会员级别'
            )
        })
    })

    describe('handle 方法测试', () => {
        it('应正确创建会员记录', async () => {
            const user = await createTestUser()
            const level = await createTestMembershipLevel()
            const product = await createTestProduct(level.id, {
                type: ProductType.MEMBERSHIP,
                giftPoint: 0,
            })
            const order = await createTestOrder(user.id, product.id, {
                orderType: OrderType.PURCHASE,
                duration: 1,
                durationUnit: 'year',
            })

            await membershipHandler.handle(order as any, prisma)

            // 验证会员记录已创建
            const memberships = await prisma.userMemberships.findMany({
                where: { userId: user.id },
                orderBy: { createdAt: 'desc' },
            })

            expect(memberships.length).toBeGreaterThanOrEqual(1)
            expect(memberships[0].levelId).toBe(level.id)
            expect(memberships[0].userId).toBe(user.id)
        })

        it('有赠送积分的会员商品应同时创建积分记录', async () => {
            const user = await createTestUser()
            const level = await createTestMembershipLevel()
            const product = await createTestProduct(level.id, {
                type: ProductType.MEMBERSHIP,
                giftPoint: 200,
            })
            const order = await createTestOrder(user.id, product.id, {
                orderType: OrderType.PURCHASE,
                duration: 1,
                durationUnit: 'year',
            })

            await membershipHandler.handle(order as any, prisma)

            // 验证会员记录已创建
            const memberships = await prisma.userMemberships.findMany({
                where: { userId: user.id },
                orderBy: { createdAt: 'desc' },
            })
            expect(memberships.length).toBeGreaterThanOrEqual(1)

            // 验证积分记录已创建
            const pointRecords = await prisma.pointRecords.findMany({
                where: { userId: user.id },
                orderBy: { createdAt: 'desc' },
            })
            expect(pointRecords.length).toBeGreaterThanOrEqual(1)
            expect(pointRecords[0].pointAmount).toBe(200)
        })

        it('赠送积分为 0 时不应创建积分记录', async () => {
            const user = await createTestUser()
            const level = await createTestMembershipLevel()
            const product = await createTestProduct(level.id, {
                type: ProductType.MEMBERSHIP,
                giftPoint: 0,
            })
            const order = await createTestOrder(user.id, product.id, {
                orderType: OrderType.PURCHASE,
                duration: 1,
                durationUnit: 'year',
            })

            await membershipHandler.handle(order as any, prisma)

            // 验证没有积分记录
            const pointRecords = await prisma.pointRecords.findMany({
                where: { userId: user.id },
                orderBy: { createdAt: 'desc' },
            })
            expect(pointRecords.length).toBe(0)
        })

        it('不同时长单位应正确处理', async () => {
            const user = await createTestUser()
            const level = await createTestMembershipLevel()
            const product = await createTestProduct(level.id, {
                type: ProductType.MEMBERSHIP,
                giftPoint: 0,
            })
            const order = await createTestOrder(user.id, product.id, {
                orderType: OrderType.PURCHASE,
                duration: 30,
                durationUnit: 'day',
            })

            await membershipHandler.handle(order as any, prisma)

            const memberships = await prisma.userMemberships.findMany({
                where: { userId: user.id },
                orderBy: { createdAt: 'desc' },
            })

            expect(memberships.length).toBeGreaterThanOrEqual(1)
            // 30 天的会员，endDate 应大于 startDate
            const membership = memberships[0]
            expect(new Date(membership.endDate).getTime()).toBeGreaterThan(
                new Date(membership.startDate).getTime()
            )
        })

        it('赠送积分的生效时间应与会员开始时间一致', async () => {
            const user = await createTestUser()
            const level = await createTestMembershipLevel()
            const product = await createTestProduct(level.id, {
                type: ProductType.MEMBERSHIP,
                giftPoint: 500,
            })
            const order = await createTestOrder(user.id, product.id, {
                orderType: OrderType.PURCHASE,
                duration: 1,
                durationUnit: 'year',
            })

            await membershipHandler.handle(order as any, prisma)

            const memberships = await prisma.userMemberships.findMany({
                where: { userId: user.id },
                orderBy: { createdAt: 'desc' },
            })
            const pointRecords = await prisma.pointRecords.findMany({
                where: { userId: user.id },
                orderBy: { createdAt: 'desc' },
            })

            expect(memberships.length).toBeGreaterThanOrEqual(1)
            expect(pointRecords.length).toBeGreaterThanOrEqual(1)

            const membership = memberships[0]
            const pointRecord = pointRecords[0]

            // 积分的生效时间应和会员开始时间一致
            expect(pointRecord.effectiveAt.toISOString()).toBe(
                membership.startDate.toISOString()
            )
            // 积分的过期时间应和会员结束时间一致
            expect(pointRecord.expiredAt.toISOString()).toBe(
                membership.endDate.toISOString()
            )
        })
    })
})
