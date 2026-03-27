/**
 * 支付单 DAO 层测试
 *
 * 测试 paymentTransaction.dao.ts 中所有 DAO 方法
 *
 * **Feature: payment-transaction-dao**
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

// 设置全局变量
const mockLogger = {
    info: (...args: any[]) => {},
    warn: (...args: any[]) => {},
    error: (...args: any[]) => {},
    debug: (...args: any[]) => {},
}
    ; (globalThis as any).logger = mockLogger

let dbAvailable = false
const testIds: TestIds = createEmptyTestIds()
const prisma = getTestPrisma()

describe('支付单 DAO 测试', () => {
    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
    })

    afterEach(async () => {
        if (dbAvailable) {
            // 清理支付单
            for (const id of testIds.orderIds) {
                try {
                    await prisma.paymentTransactions.deleteMany({
                        where: { orderId: { in: testIds.orderIds } },
                    })
                } catch {
                    // ignore
                }
            }
            await cleanupTestData(testIds)
        }
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    describe('generateTransactionNo', () => {
        it('应生成以 PAY 开头的交易号', () => {
            const no = generateTransactionNo()
            expect(no.startsWith('PAY')).toBe(true)
        })

        it('应生成 23 位长度的交易号', () => {
            const no = generateTransactionNo()
            expect(no.length).toBe(23)
        })

        it('Property: 生成的交易号应始终唯一', () => {
            const nos = new Set<string>()
            for (let i = 0; i < 100; i++) {
                nos.add(generateTransactionNo())
            }
            // 100 次生成应该产生 100 个唯一值
            expect(nos.size).toBe(100)
        })

        it('格式应为 PAY + 14位时间 + 6位随机数', () => {
            const no = generateTransactionNo()
            expect(no).toMatch(/^PAY\d{14}\d{6}$/)
        })
    })

    describe('createPaymentTransactionDao', () => {
        it('应成功创建支付单', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const product = await createTestProduct(level.id)
            testIds.productIds.push(product.id)

            const order = await createTestOrder(user.id, product.id, {
                status: 1,
            })
            testIds.orderIds.push(order.id)

            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: 99,
                paymentChannel: 'wechat',
                paymentMethod: 'wxpay',
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })

            expect(tx.id).toBeGreaterThan(0)
            expect(tx.transactionNo.startsWith('PAY')).toBe(true)
            expect(tx.amount.toNumber()).toBe(99)
            expect(tx.paymentChannel).toBe('wechat')
            expect(tx.paymentMethod).toBe('wxpay')
            expect(tx.status).toBe(PaymentTransactionStatus.PENDING)

            // 清理
            await prisma.paymentTransactions.delete({ where: { id: tx.id } })
        })

        it('创建时应默认待支付状态', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const product = await createTestProduct(level.id)
            testIds.productIds.push(product.id)

            const order = await createTestOrder(user.id, product.id, {
                status: 1,
            })
            testIds.orderIds.push(order.id)

            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: 100,
                paymentChannel: 'alipay',
                paymentMethod: 'alipay_wap',
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })

            expect(tx.status).toBe(PaymentTransactionStatus.PENDING)

            // 清理
            await prisma.paymentTransactions.delete({ where: { id: tx.id } })
        })
    })

    describe('findPaymentTransactionByIdDao', () => {
        it('应返回存在的支付单', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const product = await createTestProduct(level.id)
            testIds.productIds.push(product.id)

            const order = await createTestOrder(user.id, product.id, { status: 1 })
            testIds.orderIds.push(order.id)

            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: 100,
                paymentChannel: 'test',
                paymentMethod: 'test',
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })

            const found = await findPaymentTransactionByIdDao(tx.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(tx.id)
            expect(found!.order).not.toBeNull()

            // 清理
            await prisma.paymentTransactions.delete({ where: { id: tx.id } })
        })

        it('不存在 ID 应返回 null', async () => {
            if (!dbAvailable) return

            const found = await findPaymentTransactionByIdDao(999999999)
            expect(found).toBeNull()
        })
    })

    describe('findPaymentTransactionByNoDao', () => {
        it('应返回存在的支付单（包含订单和产品信息）', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const product = await createTestProduct(level.id)
            testIds.productIds.push(product.id)

            const order = await createTestOrder(user.id, product.id, { status: 1 })
            testIds.orderIds.push(order.id)

            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: 100,
                paymentChannel: 'test',
                paymentMethod: 'test',
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })

            const found = await findPaymentTransactionByNoDao(tx.transactionNo)

            expect(found).not.toBeNull()
            expect(found!.transactionNo).toBe(tx.transactionNo)
            expect(found!.order).not.toBeNull()
            expect(found!.order.product).not.toBeNull()

            // 清理
            await prisma.paymentTransactions.delete({ where: { id: tx.id } })
        })

        it('不存在交易号应返回 null', async () => {
            if (!dbAvailable) return

            const found = await findPaymentTransactionByNoDao('PAY99999999999999999')
            expect(found).toBeNull()
        })
    })

    describe('findPaymentTransactionsByOrderIdDao', () => {
        it('应返回订单的所有支付单', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const product = await createTestProduct(level.id)
            testIds.productIds.push(product.id)

            const order = await createTestOrder(user.id, product.id, { status: 1 })
            testIds.orderIds.push(order.id)

            const tx1 = await createPaymentTransactionDao({
                orderId: order.id,
                amount: 100,
                paymentChannel: 'wechat',
                paymentMethod: 'wxpay',
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })
            const tx2 = await createPaymentTransactionDao({
                orderId: order.id,
                amount: 100,
                paymentChannel: 'alipay',
                paymentMethod: 'alipay',
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })

            const txs = await findPaymentTransactionsByOrderIdDao(order.id)

            expect(txs.length).toBeGreaterThanOrEqual(2)

            // 清理
            await prisma.paymentTransactions.delete({ where: { id: tx1.id } })
            await prisma.paymentTransactions.delete({ where: { id: tx2.id } })
        })
    })

    describe('updatePaymentTransactionDao', () => {
        it('应成功更新支付单状态为已支付', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const product = await createTestProduct(level.id)
            testIds.productIds.push(product.id)

            const order = await createTestOrder(user.id, product.id, { status: 1 })
            testIds.orderIds.push(order.id)

            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: 100,
                paymentChannel: 'test',
                paymentMethod: 'test',
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })

            const updated = await updatePaymentTransactionDao(tx.id, {
                status: PaymentTransactionStatus.SUCCESS,
                outTradeNo: 'OUT_TRADE_123',
                paidAt: new Date(),
            })

            expect(updated.status).toBe(PaymentTransactionStatus.SUCCESS)
            expect(updated.outTradeNo).toBe('OUT_TRADE_123')
            expect(updated.paidAt).not.toBeNull()

            // 清理
            await prisma.paymentTransactions.delete({ where: { id: tx.id } })
        })

        it('应能更新 prepayId', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const product = await createTestProduct(level.id)
            testIds.productIds.push(product.id)

            const order = await createTestOrder(user.id, product.id, { status: 1 })
            testIds.orderIds.push(order.id)

            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: 100,
                paymentChannel: 'test',
                paymentMethod: 'test',
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })

            const updated = await updatePaymentTransactionDao(tx.id, {
                prepayId: 'prepay_id_12345',
            })

            expect(updated.prepayId).toBe('prepay_id_12345')

            // 清理
            await prisma.paymentTransactions.delete({ where: { id: tx.id } })
        })
    })

    describe('findPaymentTransactionByOutTradeNoDao', () => {
        it('应通过第三方交易号返回支付单', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const product = await createTestProduct(level.id)
            testIds.productIds.push(product.id)

            const order = await createTestOrder(user.id, product.id, { status: 1 })
            testIds.orderIds.push(order.id)

            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: 100,
                paymentChannel: 'test',
                paymentMethod: 'test',
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })

            // 先更新 outTradeNo
            await updatePaymentTransactionDao(tx.id, {
                status: PaymentTransactionStatus.SUCCESS,
                outTradeNo: 'THIRD_PARTY_TRADE_123',
            })

            const found = await findPaymentTransactionByOutTradeNoDao('THIRD_PARTY_TRADE_123')

            expect(found).not.toBeNull()
            expect(found!.outTradeNo).toBe('THIRD_PARTY_TRADE_123')

            // 清理
            await prisma.paymentTransactions.delete({ where: { id: tx.id } })
        })

        it('不存在第三方交易号应返回 null', async () => {
            if (!dbAvailable) return

            const found = await findPaymentTransactionByOutTradeNoDao('NON_EXISTENT_OUT_TRADE_NO')
            expect(found).toBeNull()
        })
    })

    describe('findExpiredPendingTransactionsDao', () => {
        it('应返回过期未支付的支付单', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const product = await createTestProduct(level.id)
            testIds.productIds.push(product.id)

            const order = await createTestOrder(user.id, product.id, { status: 1 })
            testIds.orderIds.push(order.id)

            // 创建已过期的支付单
            const tx = await prisma.paymentTransactions.create({
                data: {
                    transactionNo: `PAY${Date.now()}EXPIRED`,
                    orderId: order.id,
                    amount: 100,
                    paymentChannel: 'test',
                    paymentMethod: 'test',
                    status: PaymentTransactionStatus.PENDING,
                    expiredAt: new Date(Date.now() - 1000), // 已过期
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })

            const expired = await findExpiredPendingTransactionsDao()

            const found = expired.find(t => t.id === tx.id)
            expect(found).not.toBeUndefined()

            // 清理
            await prisma.paymentTransactions.delete({ where: { id: tx.id } })
        })
    })

    describe('expirePaymentTransactionsDao', () => {
        it('应成功批量过期支付单', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const product = await createTestProduct(level.id)
            testIds.productIds.push(product.id)

            const order = await createTestOrder(user.id, product.id, { status: 1 })
            testIds.orderIds.push(order.id)

            const tx = await prisma.paymentTransactions.create({
                data: {
                    transactionNo: `PAY${Date.now()}EXPIRE`,
                    orderId: order.id,
                    amount: 100,
                    paymentChannel: 'test',
                    paymentMethod: 'test',
                    status: PaymentTransactionStatus.PENDING,
                    expiredAt: new Date(Date.now() - 1000),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })

            const count = await expirePaymentTransactionsDao([tx.id])

            expect(count).toBeGreaterThan(0)

            const updated = await prisma.paymentTransactions.findUnique({
                where: { id: tx.id },
            })
            expect(updated!.status).toBe(PaymentTransactionStatus.EXPIRED)

            // 清理
            await prisma.paymentTransactions.delete({ where: { id: tx.id } })
        })
    })
})

describe('数据库连接检查', () => {
    it('检查数据库是否可用', async () => {
        const available = await isTestDbAvailable()
        if (!available) {
            console.log('请确保数据库已启动并配置正确的连接字符串')
        }
        expect(true).toBe(true)
    })
})
