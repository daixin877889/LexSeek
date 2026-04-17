/**
 * 订单 DAO 层 catch 分支覆盖测试
 *
 * 补充 order.dao.ts 各函数 catch 分支（Proxy 故障注入）
 * 以及未覆盖的正常路径（findOrderByIdDao、findOrderByOrderNoDao、updateOrderStatusDao、
 * cancelExpiredOrdersDao、countUserProductOrdersDao）。
 *
 * **Feature: server-test-coverage**
 * **Validates: order.dao.ts catch 分支完整覆盖**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
    getTestPrisma,
    createTestUser,
    createTestProduct,
    createTestOrder,
    createTestMembershipLevel,
    cleanupTestData,
    createEmptyTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    type TestIds,
} from '../membership/test-db-helper'
import {
    createOrderDao,
    findOrderByIdDao,
    findOrderByOrderNoDao,
    findUserOrdersDao,
    updateOrderStatusDao,
    findExpiredPendingOrdersDao,
    cancelExpiredOrdersDao,
    countUserProductOrdersDao,
    countUserProductsOrdersDao,
    generateOrderNo,
} from '../../../server/services/payment/order.dao'
import { OrderStatus, OrderType } from '../../../shared/types/payment'

/** 故障注入 */
const withFaultyPrisma = async (fn: () => Promise<void>) => {
    const original = (globalThis as any).prisma
    ; (globalThis as any).prisma = new Proxy({}, {
        get: () => {
            throw new Error('injected-fault')
        },
    })
    try {
        await fn()
    } finally {
        ; (globalThis as any).prisma = original
    }
}

describe('订单 DAO - catch 分支与边界覆盖', () => {
    let dbAvailable = false
    const testIds: TestIds = createEmptyTestIds()
    const prisma = getTestPrisma()

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
    })

    afterEach(async () => {
        if (!dbAvailable) return
        // 先清理订单附加的 paymentTransactions
        if (testIds.orderIds.length > 0) {
            await prisma.paymentTransactions.deleteMany({
                where: { orderId: { in: testIds.orderIds } },
            })
        }
        await cleanupTestData(testIds)
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
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    describe('createOrderDao - 正常路径与 catch', () => {
        it('应成功创建订单（默认 orderType=purchase）', async () => {
            if (!dbAvailable) return
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)
            const product = await createTestProduct(level.id)
            testIds.productIds.push(product.id)

            const order = await createOrderDao({
                userId: user.id,
                productId: product.id,
                amount: 100,
                duration: 1,
                durationUnit: 'year',
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
                remark: 'gap-test',
            })
            testIds.orderIds.push(order.id)

            expect(order.id).toBeGreaterThan(0)
            expect(order.orderType).toBe('purchase')
            expect(order.status).toBe(OrderStatus.PENDING)
            expect(order.orderNo).toMatch(/^LSD\d{14}\d{6}$/)
        })

        it('prisma 抛错应透传（catch 分支）', async () => {
            await withFaultyPrisma(async () => {
                await expect(
                    createOrderDao({
                        userId: 1,
                        productId: 1,
                        amount: 100,
                        duration: 1,
                        durationUnit: 'year',
                        expiredAt: new Date(),
                    })
                ).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('findOrderByIdDao / findOrderByOrderNoDao', () => {
        it('findOrderByIdDao 应返回包含 product + user 的订单', async () => {
            if (!dbAvailable) return
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)
            const product = await createTestProduct(level.id)
            testIds.productIds.push(product.id)
            const order = await createTestOrder(user.id, product.id)
            testIds.orderIds.push(order.id)

            const found = await findOrderByIdDao(order.id)
            expect(found).not.toBeNull()
            expect(found!.id).toBe(order.id)
            expect(found!.product).toBeDefined()
            expect(found!.user).toBeDefined()
            expect(found!.user.id).toBe(user.id)
        })

        it('findOrderByOrderNoDao 应按订单号查询', async () => {
            if (!dbAvailable) return
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)
            const product = await createTestProduct(level.id)
            testIds.productIds.push(product.id)
            const order = await createTestOrder(user.id, product.id)
            testIds.orderIds.push(order.id)

            const found = await findOrderByOrderNoDao(order.orderNo)
            expect(found).not.toBeNull()
            expect(found!.id).toBe(order.id)
        })

        it('findOrderByIdDao catch 分支', async () => {
            await withFaultyPrisma(async () => {
                await expect(findOrderByIdDao(1)).rejects.toThrow('injected-fault')
            })
        })

        it('findOrderByOrderNoDao catch 分支', async () => {
            await withFaultyPrisma(async () => {
                await expect(findOrderByOrderNoDao('x')).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('updateOrderStatusDao', () => {
        it('应更新订单状态与 paidAt', async () => {
            if (!dbAvailable) return
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)
            const product = await createTestProduct(level.id)
            testIds.productIds.push(product.id)
            const order = await createTestOrder(user.id, product.id)
            testIds.orderIds.push(order.id)

            const now = new Date()
            const updated = await updateOrderStatusDao(order.id, OrderStatus.PAID, now)
            expect(updated.status).toBe(OrderStatus.PAID)
            expect(updated.paidAt).not.toBeNull()
        })

        it('catch 分支', async () => {
            await withFaultyPrisma(async () => {
                await expect(
                    updateOrderStatusDao(1, OrderStatus.CANCELLED)
                ).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('findExpiredPendingOrdersDao / cancelExpiredOrdersDao', () => {
        it('应查询过期未支付订单并批量取消', async () => {
            if (!dbAvailable) return
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)
            const product = await createTestProduct(level.id)
            testIds.productIds.push(product.id)
            const order = await createTestOrder(user.id, product.id, {
                status: OrderStatus.PENDING,
                expiredAt: new Date(Date.now() - 1000),
            })
            testIds.orderIds.push(order.id)

            const expired = await findExpiredPendingOrdersDao()
            expect(expired.some(o => o.id === order.id)).toBe(true)

            const count = await cancelExpiredOrdersDao([order.id])
            expect(count).toBe(1)

            const after = await prisma.orders.findUnique({ where: { id: order.id } })
            expect(after!.status).toBe(OrderStatus.CANCELLED)
        })

        it('findExpiredPendingOrdersDao catch 分支', async () => {
            await withFaultyPrisma(async () => {
                await expect(findExpiredPendingOrdersDao()).rejects.toThrow('injected-fault')
            })
        })

        it('cancelExpiredOrdersDao catch 分支', async () => {
            await withFaultyPrisma(async () => {
                await expect(cancelExpiredOrdersDao([1])).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('countUserProductOrdersDao / countUserProductsOrdersDao', () => {
        it('应按 PURCHASE + PAID 统计购买次数', async () => {
            if (!dbAvailable) return
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)
            const product = await createTestProduct(level.id)
            testIds.productIds.push(product.id)

            // 一条已支付的购买订单
            const o1 = await createTestOrder(user.id, product.id, {
                status: OrderStatus.PAID,
                orderType: OrderType.PURCHASE,
            })
            // 一条已支付的升级订单（不应计入）
            const o2 = await createTestOrder(user.id, product.id, {
                status: OrderStatus.PAID,
                orderType: OrderType.UPGRADE,
            })
            // 一条待支付订单（不应计入）
            const o3 = await createTestOrder(user.id, product.id, {
                status: OrderStatus.PENDING,
                orderType: OrderType.PURCHASE,
            })
            testIds.orderIds.push(o1.id, o2.id, o3.id)

            const count = await countUserProductOrdersDao(user.id, product.id)
            expect(count).toBe(1)

            const map = await countUserProductsOrdersDao(user.id, [product.id])
            expect(map.get(product.id)).toBe(1)
        })

        it('countUserProductOrdersDao catch 分支', async () => {
            await withFaultyPrisma(async () => {
                await expect(countUserProductOrdersDao(1, 1)).rejects.toThrow('injected-fault')
            })
        })

        it('countUserProductsOrdersDao catch 分支', async () => {
            await withFaultyPrisma(async () => {
                await expect(countUserProductsOrdersDao(1, [1])).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('findUserOrdersDao - catch 分支', () => {
        it('prisma 抛错应透传', async () => {
            await withFaultyPrisma(async () => {
                await expect(findUserOrdersDao(1)).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('generateOrderNo 基础校验', () => {
        it('格式符合 LSD + 14位日期 + 6位随机', () => {
            const no = generateOrderNo()
            expect(no).toMatch(/^LSD\d{14}\d{6}$/)
        })
    })
})
