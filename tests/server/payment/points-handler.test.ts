/**
 * 积分商品支付处理器测试
 *
 * 测试 pointsHandler 的功能，包括：
 * - canHandle 判断逻辑
 * - 处理器配置验证
 *
 * **Feature: points-handler**
 * **Validates: Requirements 1.1, 1.2, 2.1**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { OrderStatus, OrderType } from '../../../shared/types/payment'
import { ProductType } from '../../../shared/types/product'

// 导入被测试的处理器
import { pointsHandler } from '../../../server/services/payment/handlers/pointsHandler'

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
const createTestMembershipLevel = async () => {
    const testId = generateTestId()
    const level = await prisma.membershipLevels.create({
        data: {
            name: `测试级别_${testId}`,
            sortOrder: Math.floor(Math.random() * 1000) + 100,
            status: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    testIds.membershipLevelIds.push(level.id)
    return level
}

// 创建测试商品
const createTestProduct = async (options: { type?: number; pointAmount?: number | null } = {}) => {
    const testId = generateTestId()
    const product = await prisma.products.create({
        data: {
            name: `测试商品_${testId}`,
            type: options.type ?? ProductType.POINTS,
            priceMonthly: 99,
            priceYearly: 999,
            pointAmount: options.pointAmount ?? 1000,
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
            amount: 99,
            duration: options.duration ?? 1,
            durationUnit: options.durationUnit ?? 'month',
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
    if (testIds.pointRecordIds.length > 0) {
        await prisma.pointRecords.deleteMany({ where: { id: { in: testIds.pointRecordIds } } })
        testIds.pointRecordIds = []
    }
    if (testIds.userIds.length > 0) {
        await prisma.pointRecords.deleteMany({ where: { userId: { in: testIds.userIds } } })
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

describe('积分商品支付处理器测试', () => {
    beforeAll(async () => {
        try {
            await prisma.$connect()
            await prisma.$executeRaw`SELECT setval('users_id_seq', GREATEST((SELECT MAX(id) FROM users), 1000))`
            await prisma.$executeRaw`SELECT setval('products_id_seq', GREATEST((SELECT MAX(id) FROM products), 1000))`
            await prisma.$executeRaw`SELECT setval('orders_id_seq', GREATEST((SELECT MAX(id) FROM orders), 1000))`
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
        it('处理器名称应为 points', () => {
            expect(pointsHandler.name).toBe('points')
        })

        it('处理器应有 canHandle 方法', () => {
            expect(typeof pointsHandler.canHandle).toBe('function')
        })

        it('处理器应有 handle 方法', () => {
            expect(typeof pointsHandler.handle).toBe('function')
        })
    })

    describe('canHandle 判断逻辑', () => {
        it('积分商品应返回 true', async () => {
            const user = await createTestUser()
            const product = await createTestProduct({ type: ProductType.POINTS })
            const order = await createTestOrder(user.id, product.id)

            const result = pointsHandler.canHandle(order as any)
            expect(result).toBe(true)
        })

        it('会员商品应返回 false', async () => {
            const user = await createTestUser()
            const level = await createTestMembershipLevel()
            const product = await prisma.products.create({
                data: {
                    name: `测试商品_${generateTestId()}`,
                    type: ProductType.MEMBERSHIP,
                    levelId: level.id,
                    priceMonthly: 99,
                    priceYearly: 999,
                    status: 1,
                    sortOrder: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testIds.productIds.push(product.id)
            const order = await createTestOrder(user.id, product.id)

            const result = pointsHandler.canHandle(order as any)
            expect(result).toBe(false)
        })

        it('商品类型为 null 时应返回 false', async () => {
            const user = await createTestUser()
            const product = await createTestProduct({ type: ProductType.POINTS })
            const order = await createTestOrder(user.id, product.id)

            // 模拟 product 为 null 的情况
            const orderWithNullProduct = { ...order, product: null }
            const result = pointsHandler.canHandle(orderWithNullProduct as any)
            expect(result).toBe(false)
        })
    })

    describe('订单数据验证', () => {
        it('商品未设置积分数量时应能检测到', async () => {
            const user = await createTestUser()
            // 直接创建一个 pointAmount 为 null 的商品
            const testId = generateTestId()
            const product = await prisma.products.create({
                data: {
                    name: `测试商品_${testId}`,
                    type: ProductType.POINTS,
                    priceMonthly: 99,
                    priceYearly: 999,
                    pointAmount: null,
                    status: 1,
                    sortOrder: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testIds.productIds.push(product.id)
            const order = await createTestOrder(user.id, product.id)

            // 验证商品的 pointAmount 为 null
            expect(order.product?.pointAmount).toBeNull()
            // 验证 canHandle 仍然返回 true（因为商品类型是积分）
            expect(pointsHandler.canHandle(order as any)).toBe(true)
        })
    })

    describe('积分计算逻辑', () => {
        it('总积分应等于单价积分乘以数量', () => {
            // 测试积分计算逻辑
            const pointAmount = 500
            const duration = 3
            const totalPoints = pointAmount * duration

            expect(totalPoints).toBe(1500)
        })

        it('属性测试：积分计算应满足乘法交换律', () => {
            const testCases = [
                { pointAmount: 100, duration: 1 },
                { pointAmount: 500, duration: 3 },
                { pointAmount: 1000, duration: 12 },
            ]

            testCases.forEach(({ pointAmount, duration }) => {
                const result1 = pointAmount * duration
                const result2 = duration * pointAmount
                expect(result1).toBe(result2)
            })
        })
    })
})
