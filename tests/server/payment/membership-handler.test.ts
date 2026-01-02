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
import { OrderStatus, OrderType } from '../../../shared/types/payment'
import { ProductType } from '../../../shared/types/product'

// 导入被测试的处理器
import { membershipHandler } from '../../../server/services/payment/handlers/membershipHandler'

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
    // 按依赖顺序删除
    if (testIds.pointRecordIds.length > 0) {
        await prisma.pointRecords.deleteMany({ where: { id: { in: testIds.pointRecordIds } } })
        testIds.pointRecordIds = []
    }
    // 清理用户相关的积分记录
    if (testIds.userIds.length > 0) {
        await prisma.pointRecords.deleteMany({ where: { userId: { in: testIds.userIds } } })
    }
    if (testIds.userMembershipIds.length > 0) {
        await prisma.userMemberships.deleteMany({ where: { id: { in: testIds.userMembershipIds } } })
        testIds.userMembershipIds = []
    }
    // 清理用户相关的会员记录
    if (testIds.userIds.length > 0) {
        await prisma.userMemberships.deleteMany({ where: { userId: { in: testIds.userIds } } })
    }
    if (testIds.orderIds.length > 0) {
        await prisma.orders.deleteMany({ where: { id: { in: testIds.orderIds } } })
        testIds.orderIds = []
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
})
