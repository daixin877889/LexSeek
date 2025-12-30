/**
 * 订单限购统计测试
 *
 * 测试 countUserProductOrdersDao 和 countUserProductsOrdersDao 函数
 * 验证只统计 orderType = 'purchase' 的订单
 *
 * **Feature: order-purchase-limit**
 * **Validates: Requirements 1.1, 1.2**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
    getTestPrisma,
    createTestUser,
    createTestMembershipLevel,
    createTestProduct,
    createTestOrder,
    cleanupTestData,
    createEmptyTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    resetDatabaseSequences,
    type TestIds,
} from '../membership/test-db-helper'
import { OrderStatus, OrderType } from '../../../shared/types/payment'
import {
    countUserProductOrdersDao,
    countUserProductsOrdersDao,
} from '../../../server/services/payment/order.dao'

// 测试数据 ID 追踪
let testIds: TestIds

// 数据库连接
const prisma = getTestPrisma()

// 检查数据库是否可用
let dbAvailable = false

describe('订单限购统计测试', () => {
    testIds = createEmptyTestIds()

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
        if (!dbAvailable) {
            console.warn('数据库不可用，跳过集成测试')
        } else {
            // 重置数据库序列，避免与种子数据冲突
            await resetDatabaseSequences()
        }
    })

    afterEach(async () => {
        if (dbAvailable) {
            await cleanupTestData(testIds)
            Object.keys(testIds).forEach(key => {
                (testIds as any)[key] = []
            })
        }
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    describe('countUserProductOrdersDao', () => {
        it('应只统计 orderType = purchase 的订单', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const product = await createTestProduct(level.id, { purchaseLimit: 1 })
            testIds.productIds.push(product.id)

            // 创建一个新购订单
            const order1 = await createTestOrder(user.id, product.id, {
                orderType: OrderType.PURCHASE,
                status: OrderStatus.PAID,
            })
            testIds.orderIds.push(order1.id)

            // 创建一个升级订单
            const order2 = await createTestOrder(user.id, product.id, {
                orderType: OrderType.UPGRADE,
                status: OrderStatus.PAID,
            })
            testIds.orderIds.push(order2.id)

            // 创建一个续费订单
            const order3 = await createTestOrder(user.id, product.id, {
                orderType: OrderType.RENEW,
                status: OrderStatus.PAID,
            })
            testIds.orderIds.push(order3.id)

            // 统计购买次数（应该只有 1 次）
            const count = await countUserProductOrdersDao(user.id, product.id)
            expect(count).toBe(1)
        })

        it('应不统计未支付的订单', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const product = await createTestProduct(level.id)
            testIds.productIds.push(product.id)

            // 创建一个已支付订单
            const order1 = await createTestOrder(user.id, product.id, {
                orderType: OrderType.PURCHASE,
                status: OrderStatus.PAID,
            })
            testIds.orderIds.push(order1.id)

            // 创建一个待支付订单
            const order2 = await createTestOrder(user.id, product.id, {
                orderType: OrderType.PURCHASE,
                status: OrderStatus.PENDING,
            })
            testIds.orderIds.push(order2.id)

            // 创建一个已取消订单
            const order3 = await createTestOrder(user.id, product.id, {
                orderType: OrderType.PURCHASE,
                status: OrderStatus.CANCELLED,
            })
            testIds.orderIds.push(order3.id)

            // 统计购买次数（应该只有 1 次）
            const count = await countUserProductOrdersDao(user.id, product.id)
            expect(count).toBe(1)
        })

        it('没有购买记录时应返回 0', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const product = await createTestProduct(level.id)
            testIds.productIds.push(product.id)

            const count = await countUserProductOrdersDao(user.id, product.id)
            expect(count).toBe(0)
        })
    })

    describe('countUserProductsOrdersDao', () => {
        it('应只统计 orderType = purchase 的订单', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const product1 = await createTestProduct(level.id)
            const product2 = await createTestProduct(level.id)
            testIds.productIds.push(product1.id, product2.id)

            // 商品1：1个新购 + 1个升级
            const order1 = await createTestOrder(user.id, product1.id, {
                orderType: OrderType.PURCHASE,
                status: OrderStatus.PAID,
            })
            const order2 = await createTestOrder(user.id, product1.id, {
                orderType: OrderType.UPGRADE,
                status: OrderStatus.PAID,
            })
            testIds.orderIds.push(order1.id, order2.id)

            // 商品2：2个新购 + 1个续费
            const order3 = await createTestOrder(user.id, product2.id, {
                orderType: OrderType.PURCHASE,
                status: OrderStatus.PAID,
            })
            const order4 = await createTestOrder(user.id, product2.id, {
                orderType: OrderType.PURCHASE,
                status: OrderStatus.PAID,
            })
            const order5 = await createTestOrder(user.id, product2.id, {
                orderType: OrderType.RENEW,
                status: OrderStatus.PAID,
            })
            testIds.orderIds.push(order3.id, order4.id, order5.id)

            // 批量统计
            const countMap = await countUserProductsOrdersDao(user.id, [product1.id, product2.id])

            expect(countMap.get(product1.id)).toBe(1) // 只有 1 个新购
            expect(countMap.get(product2.id)).toBe(2) // 只有 2 个新购
        })

        it('没有购买记录的商品应不在结果中', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const product1 = await createTestProduct(level.id)
            const product2 = await createTestProduct(level.id)
            testIds.productIds.push(product1.id, product2.id)

            // 只给商品1创建订单
            const order = await createTestOrder(user.id, product1.id, {
                orderType: OrderType.PURCHASE,
                status: OrderStatus.PAID,
            })
            testIds.orderIds.push(order.id)

            const countMap = await countUserProductsOrdersDao(user.id, [product1.id, product2.id])

            expect(countMap.get(product1.id)).toBe(1)
            expect(countMap.get(product2.id)).toBeUndefined()
        })
    })
})
