/**
 * 支付管理端 DAO 测试
 *
 * Validates: server/services/payment/paymentTransaction.admin.dao.ts
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
    findPaymentTransactionsForAdminDao,
    findPaymentTransactionForAdminDao,
    updatePaymentTransactionAdminRemarkDao,
    closePendingPaymentsForOrderDao,
    findPaymentTransactionsForAdminExportDao,
} from '../../../server/services/payment/paymentTransaction.admin.dao'
import { PaymentTransactionStatus, PaymentChannel, PaymentMethod, OrderStatus } from '../../../shared/types/payment'

const testIds: TestIds = createEmptyTestIds()
let testUserId: number
let testOrderId: number
let testPaymentId: number

beforeAll(async () => {
    if (!(await isTestDbAvailable())) throw new Error('测试数据库不可用')
})
afterEach(async () => { await cleanupTestData(testIds) })
afterAll(async () => { await disconnectTestDb() })

const setupPaymentFixture = async (status: PaymentTransactionStatus = PaymentTransactionStatus.PENDING) => {
    const user = await createTestUser({ name: 'PaymentAdminTest' })
    testUserId = user.id
    testIds.userIds.push(user.id)

    const level = await createTestMembershipLevel()
    testIds.membershipLevelIds.push(level.id)

    const product = await createTestProduct(level.id, { name: 'TEST_VIP' })
    testIds.productIds.push(product.id)

    const order = await createTestOrder(user.id, product.id, { status: OrderStatus.PENDING })
    testOrderId = order.id
    testIds.orderIds.push(order.id)

    const random = Math.random().toString(36).substring(2, 8).toUpperCase()
    const payment = await getTestPrisma().paymentTransactions.create({
        data: {
            transactionNo: `TEST_TXN_${Date.now()}_${random}`,
            orderId: order.id,
            amount: 99,
            paymentChannel: PaymentChannel.WECHAT,
            paymentMethod: PaymentMethod.MINI_PROGRAM,
            status,
            expiredAt: new Date(Date.now() + 30 * 60 * 1000),
        },
    })
    testPaymentId = payment.id
    return payment
}

describe('paymentTransaction.admin.dao', () => {
    it('按支付单号关键字搜索命中', async () => {
        const payment = await setupPaymentFixture()
        const r = await findPaymentTransactionsForAdminDao(
            { keyword: payment.transactionNo },
            { page: 1, pageSize: 10 },
        )
        expect(r.items.some((p) => p.id === testPaymentId)).toBe(true)
    })

    it('按渠道筛选只返回该渠道', async () => {
        await setupPaymentFixture()
        const r = await findPaymentTransactionsForAdminDao(
            { paymentChannel: PaymentChannel.WECHAT },
            { page: 1, pageSize: 50 },
        )
        expect(r.items.every((p) => p.paymentChannel === PaymentChannel.WECHAT)).toBe(true)
    })

    it('按状态筛选只返回该状态', async () => {
        await setupPaymentFixture()
        const r = await findPaymentTransactionsForAdminDao(
            { status: PaymentTransactionStatus.PENDING },
            { page: 1, pageSize: 50 },
        )
        expect(r.items.every((p) => p.status === PaymentTransactionStatus.PENDING)).toBe(true)
    })

    it('详情含 order + user', async () => {
        await setupPaymentFixture()
        const p = await findPaymentTransactionForAdminDao(testPaymentId)
        expect(p).not.toBeNull()
        expect(p!.order).toBeDefined()
        expect(p!.order.user).toBeDefined()
        expect(p!.order.user.phone).toBeDefined()
    })

    it('updateAdminRemark 写入字段', async () => {
        await setupPaymentFixture()
        await updatePaymentTransactionAdminRemarkDao(testPaymentId, '已核对', testUserId)
        const p = await findPaymentTransactionForAdminDao(testPaymentId)
        expect(p!.adminRemark).toBe('已核对')
        expect(p!.adminRemarkUpdatedBy).toBe(testUserId)
        expect(p!.adminRemarkUpdatedAt).not.toBeNull()
    })

    it('closePendingPaymentsForOrderDao 把订单下所有 PENDING 改为 EXPIRED', async () => {
        await setupPaymentFixture()
        const count = await closePendingPaymentsForOrderDao(testOrderId)
        expect(count).toBeGreaterThanOrEqual(1)
        const p = await findPaymentTransactionForAdminDao(testPaymentId)
        expect(p!.status).toBe(PaymentTransactionStatus.EXPIRED)
    })

    it('closePendingPaymentsForOrderDao 不影响非 PENDING 状态的支付单', async () => {
        await setupPaymentFixture(PaymentTransactionStatus.SUCCESS)
        const count = await closePendingPaymentsForOrderDao(testOrderId)
        expect(count).toBe(0)
        const p = await findPaymentTransactionForAdminDao(testPaymentId)
        expect(p!.status).toBe(PaymentTransactionStatus.SUCCESS)
    })

    it('findPaymentTransactionsForAdminExportDao 返回数组', async () => {
        await setupPaymentFixture()
        const list = await findPaymentTransactionsForAdminExportDao({}, 100)
        expect(Array.isArray(list)).toBe(true)
        expect(list.some((p: any) => p.id === testPaymentId)).toBe(true)
    })
})
