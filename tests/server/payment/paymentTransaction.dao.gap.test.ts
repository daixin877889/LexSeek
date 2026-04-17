/**
 * 支付单 DAO 层 catch 分支覆盖测试
 *
 * 补充 paymentTransaction.dao.ts 各函数 catch 分支（Proxy 故障注入）
 * 以及部分未覆盖的正常路径。
 *
 * **Feature: server-test-coverage**
 * **Validates: paymentTransaction.dao.ts catch 分支完整覆盖**
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
    generateTransactionNo,
    createPaymentTransactionDao,
    findPaymentTransactionByIdDao,
    findPaymentTransactionByNoDao,
    findPaymentTransactionsByOrderIdDao,
    findPendingTransactionByOrderIdDao,
    updatePaymentTransactionDao,
    findPaymentTransactionByOutTradeNoDao,
    findExpiredPendingTransactionsDao,
    expirePaymentTransactionsDao,
} from '../../../server/services/payment/paymentTransaction.dao'
import { PaymentTransactionStatus } from '../../../shared/types/payment'

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

describe('支付单 DAO - catch 分支与边界覆盖', () => {
    let dbAvailable = false
    const testIds: TestIds = createEmptyTestIds()
    const prisma = getTestPrisma()

    const createOrderWithProduct = async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)
        const level = await createTestMembershipLevel()
        testIds.membershipLevelIds.push(level.id)
        const product = await createTestProduct(level.id)
        testIds.productIds.push(product.id)
        const order = await createTestOrder(user.id, product.id)
        testIds.orderIds.push(order.id)
        return order
    }

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
    })

    afterEach(async () => {
        if (!dbAvailable) return
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

    describe('createPaymentTransactionDao', () => {
        it('应创建支付单（默认 PENDING 状态）', async () => {
            if (!dbAvailable) return
            const order = await createOrderWithProduct()
            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: 100,
                paymentChannel: 'wechat',
                paymentMethod: 'native',
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
                remark: 'gap',
            })
            expect(tx.id).toBeGreaterThan(0)
            expect(tx.status).toBe(PaymentTransactionStatus.PENDING)
            expect(tx.transactionNo).toMatch(/^PAY\d{14}\d{6}$/)
        })

        it('catch 分支', async () => {
            await withFaultyPrisma(async () => {
                await expect(
                    createPaymentTransactionDao({
                        orderId: 1,
                        amount: 100,
                        paymentChannel: 'wechat',
                        paymentMethod: 'native',
                        expiredAt: new Date(),
                    })
                ).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('findPaymentTransactionByIdDao / byNoDao / byOutTradeNoDao', () => {
        it('findPaymentTransactionByIdDao 应返回包含 order 的支付单', async () => {
            if (!dbAvailable) return
            const order = await createOrderWithProduct()
            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: 100,
                paymentChannel: 'wechat',
                paymentMethod: 'native',
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })
            const found = await findPaymentTransactionByIdDao(tx.id)
            expect(found).not.toBeNull()
            expect(found!.order).toBeDefined()
            expect(found!.order.id).toBe(order.id)
        })

        it('findPaymentTransactionByNoDao 应按交易号返回包含 order+product 的支付单', async () => {
            if (!dbAvailable) return
            const order = await createOrderWithProduct()
            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: 100,
                paymentChannel: 'wechat',
                paymentMethod: 'native',
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })
            const found = await findPaymentTransactionByNoDao(tx.transactionNo)
            expect(found).not.toBeNull()
            expect(found!.order.product).toBeDefined()
        })

        it('findPaymentTransactionByOutTradeNoDao 应按第三方单号查询', async () => {
            if (!dbAvailable) return
            const order = await createOrderWithProduct()
            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: 100,
                paymentChannel: 'wechat',
                paymentMethod: 'native',
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })
            const outTradeNo = `OUT_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
            await updatePaymentTransactionDao(tx.id, { outTradeNo })

            const found = await findPaymentTransactionByOutTradeNoDao(outTradeNo)
            expect(found).not.toBeNull()
            expect(found!.id).toBe(tx.id)
            expect(found!.order).toBeDefined()
        })

        it('catch 分支 - byId', async () => {
            await withFaultyPrisma(async () => {
                await expect(findPaymentTransactionByIdDao(1)).rejects.toThrow('injected-fault')
            })
        })

        it('catch 分支 - byNo', async () => {
            await withFaultyPrisma(async () => {
                await expect(findPaymentTransactionByNoDao('x')).rejects.toThrow('injected-fault')
            })
        })

        it('catch 分支 - byOutTradeNo', async () => {
            await withFaultyPrisma(async () => {
                await expect(findPaymentTransactionByOutTradeNoDao('x')).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('findPaymentTransactionsByOrderIdDao / findPendingTransactionByOrderIdDao', () => {
        it('findPaymentTransactionsByOrderIdDao 应返回订单的支付单列表', async () => {
            if (!dbAvailable) return
            const order = await createOrderWithProduct()
            await createPaymentTransactionDao({
                orderId: order.id,
                amount: 100,
                paymentChannel: 'wechat',
                paymentMethod: 'native',
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })
            const list = await findPaymentTransactionsByOrderIdDao(order.id)
            expect(list.length).toBeGreaterThanOrEqual(1)
        })

        it('findPendingTransactionByOrderIdDao 应返回未过期待支付单', async () => {
            if (!dbAvailable) return
            const order = await createOrderWithProduct()
            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: 100,
                paymentChannel: 'wechat',
                paymentMethod: 'native',
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })
            const pending = await findPendingTransactionByOrderIdDao(order.id)
            expect(pending).not.toBeNull()
            expect(pending!.id).toBe(tx.id)
        })

        it('findPendingTransactionByOrderIdDao 过期支付单应返回 null', async () => {
            if (!dbAvailable) return
            const order = await createOrderWithProduct()
            await createPaymentTransactionDao({
                orderId: order.id,
                amount: 100,
                paymentChannel: 'wechat',
                paymentMethod: 'native',
                expiredAt: new Date(Date.now() - 1000), // 已过期
            })
            const pending = await findPendingTransactionByOrderIdDao(order.id)
            expect(pending).toBeNull()
        })

        it('catch 分支 - byOrderId', async () => {
            await withFaultyPrisma(async () => {
                await expect(findPaymentTransactionsByOrderIdDao(1)).rejects.toThrow('injected-fault')
            })
        })

        it('catch 分支 - pendingByOrderId', async () => {
            await withFaultyPrisma(async () => {
                await expect(findPendingTransactionByOrderIdDao(1)).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('updatePaymentTransactionDao', () => {
        it('应更新状态与回调数据', async () => {
            if (!dbAvailable) return
            const order = await createOrderWithProduct()
            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: 100,
                paymentChannel: 'wechat',
                paymentMethod: 'native',
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })
            const updated = await updatePaymentTransactionDao(tx.id, {
                status: PaymentTransactionStatus.SUCCESS,
                paidAt: new Date(),
                callbackData: { ok: true } as any,
                errorMessage: undefined,
            })
            expect(updated.status).toBe(PaymentTransactionStatus.SUCCESS)
            expect(updated.paidAt).not.toBeNull()
        })

        it('catch 分支', async () => {
            await withFaultyPrisma(async () => {
                await expect(
                    updatePaymentTransactionDao(1, { status: PaymentTransactionStatus.FAILED })
                ).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('findExpiredPendingTransactionsDao / expirePaymentTransactionsDao', () => {
        it('应查询并批量置为过期', async () => {
            if (!dbAvailable) return
            const order = await createOrderWithProduct()
            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: 100,
                paymentChannel: 'wechat',
                paymentMethod: 'native',
                expiredAt: new Date(Date.now() - 1000), // 已过期
            })
            const expired = await findExpiredPendingTransactionsDao()
            expect(expired.some(t => t.id === tx.id)).toBe(true)

            const count = await expirePaymentTransactionsDao([tx.id])
            expect(count).toBe(1)

            const after = await prisma.paymentTransactions.findUnique({ where: { id: tx.id } })
            expect(after!.status).toBe(PaymentTransactionStatus.EXPIRED)
        })

        it('catch 分支 - findExpired', async () => {
            await withFaultyPrisma(async () => {
                await expect(findExpiredPendingTransactionsDao()).rejects.toThrow('injected-fault')
            })
        })

        it('catch 分支 - expireBatch', async () => {
            await withFaultyPrisma(async () => {
                await expect(expirePaymentTransactionsDao([1])).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('generateTransactionNo', () => {
        it('格式应为 PAY + 14位日期 + 6位随机数', () => {
            expect(generateTransactionNo()).toMatch(/^PAY\d{14}\d{6}$/)
        })
    })
})
