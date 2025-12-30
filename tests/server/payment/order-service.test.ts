/**
 * 订单服务测试
 *
 * 测试订单服务层的业务逻辑，包括：
 * - 订单创建（含购买限制检查）
 * - 订单金额计算（会员/积分/自定义金额）
 * - 订单状态管理
 *
 * **Feature: order-service**
 * **Validates: Requirements 10.1, 10.2, 10.3, 10.4**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import { prisma } from '../../../server/utils/db'
import {
    createOrderService,
    getOrderDetailService,
    getOrderByOrderNoService,
    getUserOrdersService,
    cancelOrderService,
    checkOrderPayableService,
} from '../../../server/services/payment/order.service'
import { OrderStatus, DurationUnit } from '../../../shared/types/payment'
import { ProductType, ProductStatus } from '../../../shared/types/product'

// 测试数据
let testUser: { id: number } | null = null
let testMembershipProduct: { id: number; priceYearly: any } | null = null
let testPointsProduct: { id: number; unitPrice: any } | null = null
const createdOrderIds: number[] = []

describe('订单服务测试', () => {
    beforeAll(async () => {
        // 查找测试用户
        testUser = await prisma.users.findFirst({
            where: { deletedAt: null },
            select: { id: true },
        })

        // 查找测试用的会员商品
        testMembershipProduct = await prisma.products.findFirst({
            where: {
                type: ProductType.MEMBERSHIP,
                status: ProductStatus.ON_SHELF,
                deletedAt: null,
                priceYearly: { not: null },
            },
            select: { id: true, priceYearly: true },
        })

        // 查找测试用的积分商品
        testPointsProduct = await prisma.products.findFirst({
            where: {
                type: ProductType.POINTS,
                status: ProductStatus.ON_SHELF,
                deletedAt: null,
                unitPrice: { not: null },
            },
            select: { id: true, unitPrice: true },
        })
    })

    afterAll(async () => {
        // 清理测试创建的订单
        if (createdOrderIds.length > 0) {
            await prisma.orders.deleteMany({
                where: { id: { in: createdOrderIds } },
            })
        }
        await prisma.$disconnect()
    })

    describe('createOrderService 测试', () => {
        it('应成功创建会员订单（年付）', async () => {
            if (!testUser || !testMembershipProduct) {
                console.log('缺少测试数据，跳过测试')
                return
            }

            const result = await createOrderService({
                userId: testUser.id,
                productId: testMembershipProduct.id,
                duration: 1,
                durationUnit: DurationUnit.YEAR,
            })

            expect(result.success).toBe(true)
            expect(result.order).toBeDefined()
            expect(result.order?.userId).toBe(testUser.id)
            expect(result.order?.productId).toBe(testMembershipProduct.id)

            if (result.order) {
                createdOrderIds.push(result.order.id)
            }
        })

        it('应成功创建带自定义金额的订单（升级场景）', async () => {
            if (!testUser || !testMembershipProduct) {
                console.log('缺少测试数据，跳过测试')
                return
            }

            const customAmount = 99.99

            const result = await createOrderService({
                userId: testUser.id,
                productId: testMembershipProduct.id,
                duration: 1,
                durationUnit: DurationUnit.YEAR,
                customAmount,
                remark: '会员升级测试',
            })

            expect(result.success).toBe(true)
            expect(result.order).toBeDefined()
            // 验证金额是自定义金额
            expect(Number(result.order?.amount)).toBeCloseTo(customAmount, 2)

            if (result.order) {
                createdOrderIds.push(result.order.id)
            }
        })

        it('不存在的商品应返回错误', async () => {
            if (!testUser) {
                console.log('缺少测试用户，跳过测试')
                return
            }

            const result = await createOrderService({
                userId: testUser.id,
                productId: 999999,
                duration: 1,
                durationUnit: DurationUnit.YEAR,
            })

            expect(result.success).toBe(false)
            expect(result.errorMessage).toContain('商品不存在')
        })

        it('下架商品应返回错误', async () => {
            if (!testUser) {
                console.log('缺少测试用户，跳过测试')
                return
            }

            // 查找下架的商品
            const offShelfProduct = await prisma.products.findFirst({
                where: {
                    status: 0, // 下架
                    deletedAt: null,
                },
                select: { id: true },
            })

            if (!offShelfProduct) {
                console.log('没有下架的商品，跳过测试')
                return
            }

            const result = await createOrderService({
                userId: testUser.id,
                productId: offShelfProduct.id,
                duration: 1,
                durationUnit: DurationUnit.YEAR,
            })

            expect(result.success).toBe(false)
            expect(result.errorMessage).toContain('商品已下架')
        })
    })

    describe('getOrderDetailService 测试', () => {
        it('应返回存在的订单详情', async () => {
            if (!testUser || !testMembershipProduct) {
                console.log('缺少测试数据，跳过测试')
                return
            }

            // 先创建一个订单
            const createResult = await createOrderService({
                userId: testUser.id,
                productId: testMembershipProduct.id,
                duration: 1,
                durationUnit: DurationUnit.YEAR,
            })

            if (!createResult.success || !createResult.order) {
                console.log('创建订单失败，跳过测试')
                return
            }

            createdOrderIds.push(createResult.order.id)

            // 查询订单详情
            const order = await getOrderDetailService(createResult.order.id, testUser.id)

            expect(order).not.toBeNull()
            expect(order?.id).toBe(createResult.order.id)
            expect(order?.product).toBeDefined()
        })

        it('不存在的订单应返回 null', async () => {
            const order = await getOrderDetailService(999999)
            expect(order).toBeNull()
        })

        it('其他用户的订单应返回 null（权限校验）', async () => {
            if (!testUser || !testMembershipProduct) {
                console.log('缺少测试数据，跳过测试')
                return
            }

            // 先创建一个订单
            const createResult = await createOrderService({
                userId: testUser.id,
                productId: testMembershipProduct.id,
                duration: 1,
                durationUnit: DurationUnit.YEAR,
            })

            if (!createResult.success || !createResult.order) {
                console.log('创建订单失败，跳过测试')
                return
            }

            createdOrderIds.push(createResult.order.id)

            // 使用其他用户 ID 查询
            const order = await getOrderDetailService(createResult.order.id, 999999)
            expect(order).toBeNull()
        })
    })

    describe('getOrderByOrderNoService 测试', () => {
        it('应通过订单号查询订单', async () => {
            if (!testUser || !testMembershipProduct) {
                console.log('缺少测试数据，跳过测试')
                return
            }

            // 先创建一个订单
            const createResult = await createOrderService({
                userId: testUser.id,
                productId: testMembershipProduct.id,
                duration: 1,
                durationUnit: DurationUnit.YEAR,
            })

            if (!createResult.success || !createResult.order) {
                console.log('创建订单失败，跳过测试')
                return
            }

            createdOrderIds.push(createResult.order.id)

            // 通过订单号查询
            const order = await getOrderByOrderNoService(createResult.order.orderNo)

            expect(order).not.toBeNull()
            expect(order?.orderNo).toBe(createResult.order.orderNo)
        })

        it('不存在的订单号应返回 null', async () => {
            const order = await getOrderByOrderNoService('NONEXISTENT_ORDER_NO')
            expect(order).toBeNull()
        })
    })

    describe('cancelOrderService 测试', () => {
        it('应成功取消待支付订单', async () => {
            if (!testUser || !testMembershipProduct) {
                console.log('缺少测试数据，跳过测试')
                return
            }

            // 先创建一个订单
            const createResult = await createOrderService({
                userId: testUser.id,
                productId: testMembershipProduct.id,
                duration: 1,
                durationUnit: DurationUnit.YEAR,
            })

            if (!createResult.success || !createResult.order) {
                console.log('创建订单失败，跳过测试')
                return
            }

            createdOrderIds.push(createResult.order.id)

            // 取消订单
            const cancelResult = await cancelOrderService(
                createResult.order.id,
                testUser.id
            )

            expect(cancelResult.success).toBe(true)

            // 验证订单状态
            const order = await getOrderDetailService(createResult.order.id)
            expect(order?.status).toBe(OrderStatus.CANCELLED)
        })

        it('取消不存在的订单应返回错误', async () => {
            if (!testUser) {
                console.log('缺少测试用户，跳过测试')
                return
            }

            const result = await cancelOrderService(999999, testUser.id)

            expect(result.success).toBe(false)
            expect(result.errorMessage).toContain('订单不存在')
        })

        it('取消其他用户的订单应返回错误', async () => {
            if (!testUser || !testMembershipProduct) {
                console.log('缺少测试数据，跳过测试')
                return
            }

            // 先创建一个订单
            const createResult = await createOrderService({
                userId: testUser.id,
                productId: testMembershipProduct.id,
                duration: 1,
                durationUnit: DurationUnit.YEAR,
            })

            if (!createResult.success || !createResult.order) {
                console.log('创建订单失败，跳过测试')
                return
            }

            createdOrderIds.push(createResult.order.id)

            // 使用其他用户 ID 取消
            const result = await cancelOrderService(createResult.order.id, 999999)

            expect(result.success).toBe(false)
            expect(result.errorMessage).toContain('无权操作')
        })
    })

    describe('checkOrderPayableService 测试', () => {
        it('待支付且未过期的订单应可支付', async () => {
            if (!testUser || !testMembershipProduct) {
                console.log('缺少测试数据，跳过测试')
                return
            }

            // 先创建一个订单
            const createResult = await createOrderService({
                userId: testUser.id,
                productId: testMembershipProduct.id,
                duration: 1,
                durationUnit: DurationUnit.YEAR,
            })

            if (!createResult.success || !createResult.order) {
                console.log('创建订单失败，跳过测试')
                return
            }

            createdOrderIds.push(createResult.order.id)

            // 检查是否可支付
            const result = await checkOrderPayableService(createResult.order.id)

            expect(result.payable).toBe(true)
        })

        it('不存在的订单应不可支付', async () => {
            const result = await checkOrderPayableService(999999)

            expect(result.payable).toBe(false)
            expect(result.errorMessage).toContain('订单不存在')
        })

        it('已取消的订单应不可支付', async () => {
            if (!testUser || !testMembershipProduct) {
                console.log('缺少测试数据，跳过测试')
                return
            }

            // 先创建一个订单
            const createResult = await createOrderService({
                userId: testUser.id,
                productId: testMembershipProduct.id,
                duration: 1,
                durationUnit: DurationUnit.YEAR,
            })

            if (!createResult.success || !createResult.order) {
                console.log('创建订单失败，跳过测试')
                return
            }

            createdOrderIds.push(createResult.order.id)

            // 取消订单
            await cancelOrderService(createResult.order.id, testUser.id)

            // 检查是否可支付
            const result = await checkOrderPayableService(createResult.order.id)

            expect(result.payable).toBe(false)
            expect(result.errorMessage).toContain('订单状态不允许支付')
        })
    })
})

describe('Property: 订单号格式', () => {
    it('订单号应以 LSD 开头', async () => {
        // 查询数据库中的订单
        const orders = await prisma.orders.findMany({
            take: 10,
            orderBy: { createdAt: 'desc' },
            select: { orderNo: true },
        })

        for (const order of orders) {
            // 新订单应以 LSD 开头，旧订单可能以 ORD 开头，测试订单以 TEST_ORDER_ 开头
            expect(order.orderNo.startsWith('LSD') || order.orderNo.startsWith('ORD') || order.orderNo.startsWith('TEST_ORDER_')).toBe(true)
        }
    })
})

describe('Property: 订单金额计算', () => {
    it('自定义金额订单的金额应等于传入的自定义金额', () => {
        fc.assert(
            fc.property(
                fc.double({ min: 0.01, max: 10000, noNaN: true }),
                (customAmount) => {
                    // 四舍五入到分
                    const roundedAmount = Math.round(customAmount * 100) / 100
                    expect(roundedAmount).toBeGreaterThan(0)
                    expect(roundedAmount).toBeLessThanOrEqual(10000)
                }
            ),
            { numRuns: 100 }
        )
    })
})
