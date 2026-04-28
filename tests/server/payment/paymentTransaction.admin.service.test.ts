/**
 * 支付管理端 Service 测试
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { getHeader } from 'h3'
;(globalThis as any).getHeader = getHeader

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
    findPaymentTransactionsForAdminService,
    findPaymentTransactionForAdminService,
    updatePaymentAdminRemarkService,
    exportPaymentTransactionsService,
} from '../../../server/services/payment/paymentTransaction.admin.service'
import { PaymentTransactionStatus, PaymentChannel, PaymentMethod, OrderStatus } from '../../../shared/types/payment'

const testIds: TestIds = createEmptyTestIds()
let testUserId: number
let testPaymentId: number

beforeAll(async () => {
    if (!(await isTestDbAvailable())) throw new Error('测试数据库不可用')
})
afterEach(async () => { await cleanupTestData(testIds) })
afterAll(async () => { await disconnectTestDb() })

const setupPaymentFixture = async () => {
    const user = await createTestUser({ name: 'PayAdminSvcTest' })
    testUserId = user.id
    testIds.userIds.push(user.id)

    const level = await createTestMembershipLevel()
    testIds.membershipLevelIds.push(level.id)

    const product = await createTestProduct(level.id, { name: 'TEST_PAY_SVC' })
    testIds.productIds.push(product.id)

    const order = await createTestOrder(user.id, product.id, { status: OrderStatus.PENDING })
    testIds.orderIds.push(order.id)

    const payment = await getTestPrisma().paymentTransactions.create({
        data: {
            transactionNo: `PSVC_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            orderId: order.id,
            amount: 99,
            paymentChannel: PaymentChannel.WECHAT,
            paymentMethod: PaymentMethod.MINI_PROGRAM,
            status: PaymentTransactionStatus.PENDING,
            expiredAt: new Date(Date.now() + 30 * 60 * 1000),
        },
    })
    testPaymentId = payment.id
}

describe('paymentTransaction.admin.service', () => {
    it('findPaymentTransactionsForAdminService 返回完整列表', async () => {
        await setupPaymentFixture()
        const r = await findPaymentTransactionsForAdminService({}, { page: 1, pageSize: 10 })
        expect(r.items).toBeInstanceOf(Array)
        expect(r.total).toBeGreaterThan(0)
    })

    it('updatePaymentAdminRemarkService 写备注 + 审计', async () => {
        await setupPaymentFixture()
        const fakeEvent = { node: { req: { socket: { remoteAddress: '127.0.0.1' }, headers: {} } } } as any
        await updatePaymentAdminRemarkService(fakeEvent, testUserId, testPaymentId, '已退款')
        const p = await findPaymentTransactionForAdminService(testPaymentId)
        expect(p!.adminRemark).toBe('已退款')

        const auditCount = await getTestPrisma().permissionAuditLogs.count({
            where: {
                targetType: 'payment_transaction',
                targetId: testPaymentId,
                action: 'payment_remark_update',
            },
        })
        expect(auditCount).toBe(1)
    })

    it('updatePaymentAdminRemarkService 不存在的支付单抛错', async () => {
        const fakeEvent = { node: { req: { socket: { remoteAddress: '127.0.0.1' }, headers: {} } } } as any
        await expect(
            updatePaymentAdminRemarkService(fakeEvent, 1, 99999999, 'x'),
        ).rejects.toThrow(/支付单不存在/)
    })

    it('findPaymentTransactionForAdminService 返回 auditLogs + adminRemarkUpdaterName', async () => {
        await setupPaymentFixture()
        const fakeEvent = { node: { req: { socket: { remoteAddress: '127.0.0.1' }, headers: {} } } } as any
        await updatePaymentAdminRemarkService(fakeEvent, testUserId, testPaymentId, '备注 X')
        const p = await findPaymentTransactionForAdminService(testPaymentId)
        expect(p!.auditLogs).toBeInstanceOf(Array)
        expect(p!.auditLogs.length).toBeGreaterThanOrEqual(1)
        expect(p!.adminRemarkUpdaterName).toBe('PayAdminSvcTest')
    })

    it('exportPaymentTransactionsService 生成带 BOM 的 CSV', async () => {
        const csv = await exportPaymentTransactionsService({}, 10000)
        expect(csv.charCodeAt(0)).toBe(0xFEFF)
        expect(csv).toContain('支付单号')
        expect(csv).toContain('管理员备注')
    })

    it('exportPaymentTransactionsService 超 10000 抛错', async () => {
        await expect(exportPaymentTransactionsService({}, 10001)).rejects.toThrow(/上限/)
    })
})
