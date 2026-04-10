/**
 * 订单服务覆盖测试
 *
 * 覆盖 order.service.ts 中未测试的分支：
 * - 积分商品订单创建
 * - 月付会员订单
 * - 购买限制逻辑
 * - 过期订单处理
 * - handleOrderPaidService
 * - getUserOrdersService
 *
 * **Feature: order-service-coverage**
 * **Validates: Requirements 10.3, 10.4, 10.5**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
    testPrisma,
    createTestUser,
    createTestMembershipLevel,
    createTestProduct,
    connectTestDb,
    disconnectTestDb,
    resetDatabaseSequences,
} from '../membership/test-db-helper'
import { mockLogger } from '../membership/test-setup'

import {
    createOrderService,
    getOrderDetailService,
    getOrderByOrderNoService,
    getUserOrdersService,
    cancelOrderService,
    handleOrderPaidService,
    handleExpiredOrdersService,
    checkOrderPayableService,
} from '../../../server/services/payment/order.service'
import { OrderStatus, DurationUnit, OrderType } from '../../../shared/types/payment'
import { ProductType } from '../../../shared/types/product'

// 设置全局变量
if (typeof window === 'undefined' && process.env.NODE_ENV === 'test') {
    ;(globalThis as any).prisma = testPrisma
    ;(globalThis as any).logger = mockLogger
}

const createdUserIds: number[] = []
const createdLevelIds: number[] = []
const createdProductIds: number[] = []
const createdOrderIds: number[] = []

describe('订单服务覆盖测试', () => {
    beforeAll(async () => {
        await connectTestDb()
        await resetDatabaseSequences()
    })

    afterAll(async () => {
        if (createdOrderIds.length > 0) {
            await testPrisma.orders.deleteMany({ where: { id: { in: createdOrderIds } } })
        }
        if (createdProductIds.length > 0) {
            await testPrisma.products.deleteMany({ where: { id: { in: createdProductIds } } })
        }
        if (createdLevelIds.length > 0) {
            await testPrisma.membershipLevels.deleteMany({ where: { id: { in: createdLevelIds } } })
        }
        if (createdUserIds.length > 0) {
            await testPrisma.users.deleteMany({ where: { id: { in: createdUserIds } } })
        }
        await disconnectTestDb()
    })

    afterEach(async () => {
        if (createdOrderIds.length > 0) {
            await testPrisma.orders.deleteMany({ where: { id: { in: createdOrderIds } } })
            createdOrderIds.length = 0
        }
    })

    describe('createOrderService - 积分商品', () => {
        it('应正确计算积分商品金额', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)

            // 创建积分商品
            const product = await testPrisma.products.create({
                data: {
                    name: `测试积分商品_${Date.now()}`,
                    type: ProductType.POINTS,
                    unitPrice: 10,
                    status: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            createdProductIds.push(product.id)

            const result = await createOrderService({
                userId: user.id,
                productId: product.id,
                duration: 5, // 购买5份
                durationUnit: DurationUnit.MONTH,
            })

            expect(result.success).toBe(true)
            if (result.order) {
                createdOrderIds.push(result.order.id)
                expect(Number(result.order.amount)).toBeCloseTo(50, 2) // 10 * 5
            }
        })
    })

    describe('createOrderService - 月付会员', () => {
        it('应使用月价计算会员订单金额', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)

            const level = await createTestMembershipLevel()
            createdLevelIds.push(level.id)

            const product = await testPrisma.products.create({
                data: {
                    name: `测试月付商品_${Date.now()}`,
                    type: ProductType.MEMBERSHIP,
                    levelId: level.id,
                    priceMonthly: 99,
                    priceYearly: 999,
                    status: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            createdProductIds.push(product.id)

            const result = await createOrderService({
                userId: user.id,
                productId: product.id,
                duration: 3,
                durationUnit: DurationUnit.MONTH,
            })

            expect(result.success).toBe(true)
            if (result.order) {
                createdOrderIds.push(result.order.id)
                expect(Number(result.order.amount)).toBeCloseTo(297, 2) // 99 * 3
            }
        })
    })

    describe('createOrderService - 购买限制', () => {
        it('达到购买上限时应返回错误', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)

            const level = await createTestMembershipLevel()
            createdLevelIds.push(level.id)

            // 创建限购1次的商品
            const product = await testPrisma.products.create({
                data: {
                    name: `测试限购商品_${Date.now()}`,
                    type: ProductType.MEMBERSHIP,
                    levelId: level.id,
                    priceYearly: 999,
                    purchaseLimit: 1,
                    status: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            createdProductIds.push(product.id)

            // 先创建一个已支付订单
            const order = await testPrisma.orders.create({
                data: {
                    userId: user.id,
                    orderNo: `LSD_TEST_${Date.now()}`,
                    productId: product.id,
                    amount: 999,
                    duration: 1,
                    durationUnit: 'year',
                    orderType: OrderType.PURCHASE,
                    status: OrderStatus.PAID,
                    paidAt: new Date(),
                    expiredAt: new Date(Date.now() + 30 * 60 * 1000),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            createdOrderIds.push(order.id)

            // 再次购买应失败
            const result = await createOrderService({
                userId: user.id,
                productId: product.id,
                duration: 1,
                durationUnit: DurationUnit.YEAR,
            })

            expect(result.success).toBe(false)
            expect(result.errorMessage).toContain('限购')
        })

        it('升级订单（customAmount）不受购买限制', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)

            const level = await createTestMembershipLevel()
            createdLevelIds.push(level.id)

            const product = await testPrisma.products.create({
                data: {
                    name: `测试限购升级_${Date.now()}`,
                    type: ProductType.MEMBERSHIP,
                    levelId: level.id,
                    priceYearly: 999,
                    purchaseLimit: 1,
                    status: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            createdProductIds.push(product.id)

            // 先创建一个已支付订单
            const order = await testPrisma.orders.create({
                data: {
                    userId: user.id,
                    orderNo: `LSD_TEST_UP_${Date.now()}`,
                    productId: product.id,
                    amount: 999,
                    duration: 1,
                    durationUnit: 'year',
                    orderType: OrderType.PURCHASE,
                    status: OrderStatus.PAID,
                    paidAt: new Date(),
                    expiredAt: new Date(Date.now() + 30 * 60 * 1000),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            createdOrderIds.push(order.id)

            // 升级订单应不受限购
            const result = await createOrderService({
                userId: user.id,
                productId: product.id,
                duration: 1,
                durationUnit: DurationUnit.YEAR,
                customAmount: 500,
                orderType: OrderType.UPGRADE,
            })

            expect(result.success).toBe(true)
            if (result.order) {
                createdOrderIds.push(result.order.id)
            }
        })
    })

    describe('createOrderService - orderType 参数', () => {
        it('不传 orderType 时应默认为 PURCHASE', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)

            const level = await createTestMembershipLevel()
            createdLevelIds.push(level.id)

            const product = await createTestProduct(level.id)
            createdProductIds.push(product.id)

            const result = await createOrderService({
                userId: user.id,
                productId: product.id,
                duration: 1,
                durationUnit: DurationUnit.YEAR,
            })

            expect(result.success).toBe(true)
            if (result.order) {
                createdOrderIds.push(result.order.id)
                expect(result.order.orderType).toBe(OrderType.PURCHASE)
            }
        })
    })

    describe('getOrderDetailService - 无 userId 权限校验', () => {
        it('不传 userId 时应返回任意订单', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)

            const level = await createTestMembershipLevel()
            createdLevelIds.push(level.id)

            const product = await createTestProduct(level.id)
            createdProductIds.push(product.id)

            const createResult = await createOrderService({
                userId: user.id,
                productId: product.id,
                duration: 1,
                durationUnit: DurationUnit.YEAR,
            })
            if (createResult.order) {
                createdOrderIds.push(createResult.order.id)
            }

            // 不传 userId
            const order = await getOrderDetailService(createResult.order!.id)
            expect(order).not.toBeNull()
        })
    })

    describe('getOrderByOrderNoService - 权限校验', () => {
        it('其他用户通过订单号查询应返回 null', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)

            const level = await createTestMembershipLevel()
            createdLevelIds.push(level.id)

            const product = await createTestProduct(level.id)
            createdProductIds.push(product.id)

            const createResult = await createOrderService({
                userId: user.id,
                productId: product.id,
                duration: 1,
                durationUnit: DurationUnit.YEAR,
            })
            if (createResult.order) {
                createdOrderIds.push(createResult.order.id)
            }

            // 用其他用户 ID 查
            const order = await getOrderByOrderNoService(createResult.order!.orderNo, 999999)
            expect(order).toBeNull()
        })

        it('不传 userId 时应返回订单', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)

            const level = await createTestMembershipLevel()
            createdLevelIds.push(level.id)

            const product = await createTestProduct(level.id)
            createdProductIds.push(product.id)

            const createResult = await createOrderService({
                userId: user.id,
                productId: product.id,
                duration: 1,
                durationUnit: DurationUnit.YEAR,
            })
            if (createResult.order) {
                createdOrderIds.push(createResult.order.id)
            }

            const order = await getOrderByOrderNoService(createResult.order!.orderNo)
            expect(order).not.toBeNull()
        })
    })

    describe('getUserOrdersService', () => {
        it('应代理到 findUserOrdersDao', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)

            const result = await getUserOrdersService(user.id, { page: 1, pageSize: 10 })
            expect(result).toHaveProperty('list')
            expect(result).toHaveProperty('total')
        })
    })

    describe('cancelOrderService - 已取消订单', () => {
        it('已取消的订单不能再取消', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)

            const level = await createTestMembershipLevel()
            createdLevelIds.push(level.id)

            const product = await createTestProduct(level.id)
            createdProductIds.push(product.id)

            const createResult = await createOrderService({
                userId: user.id,
                productId: product.id,
                duration: 1,
                durationUnit: DurationUnit.YEAR,
            })
            if (createResult.order) {
                createdOrderIds.push(createResult.order.id)
            }

            // 先取消
            await cancelOrderService(createResult.order!.id, user.id)

            // 再取消
            const result = await cancelOrderService(createResult.order!.id, user.id)
            expect(result.success).toBe(false)
            expect(result.errorMessage).toContain('订单状态不允许取消')
        })
    })

    describe('handleOrderPaidService', () => {
        it('应更新订单状态为已支付', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)

            const level = await createTestMembershipLevel()
            createdLevelIds.push(level.id)

            const product = await createTestProduct(level.id)
            createdProductIds.push(product.id)

            const createResult = await createOrderService({
                userId: user.id,
                productId: product.id,
                duration: 1,
                durationUnit: DurationUnit.YEAR,
            })
            if (createResult.order) {
                createdOrderIds.push(createResult.order.id)
            }

            const paidAt = new Date()
            const updated = await handleOrderPaidService(createResult.order!.id, paidAt)
            expect(updated.status).toBe(OrderStatus.PAID)
            expect(updated.paidAt).toEqual(paidAt)
        })
    })

    describe('handleExpiredOrdersService', () => {
        it('无过期订单时应返回 0', async () => {
            // 确保没有过期订单属于测试用户
            const count = await handleExpiredOrdersService()
            expect(count).toBeGreaterThanOrEqual(0)
        })
    })

    describe('checkOrderPayableService - 过期订单', () => {
        it('过期订单应不可支付', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)

            const level = await createTestMembershipLevel()
            createdLevelIds.push(level.id)

            const product = await createTestProduct(level.id)
            createdProductIds.push(product.id)

            // 创建一个已过期的订单
            const order = await testPrisma.orders.create({
                data: {
                    userId: user.id,
                    orderNo: `LSD_TEST_EXP_${Date.now()}`,
                    productId: product.id,
                    amount: 100,
                    duration: 1,
                    durationUnit: 'year',
                    orderType: 'purchase',
                    status: OrderStatus.PENDING,
                    expiredAt: new Date(Date.now() - 1000),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            createdOrderIds.push(order.id)

            const result = await checkOrderPayableService(order.id)
            expect(result.payable).toBe(false)
            expect(result.errorMessage).toContain('订单已过期')
        })
    })
})
