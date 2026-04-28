/**
 * 订单管理端 Service 测试
 *
 * 重点：取消订单事务原子性 + 备注审计 + CSV 导出
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
    findOrdersForAdminService,
    findOrderForAdminService,
    updateOrderAdminRemarkService,
    cancelOrderByAdminService,
    exportOrdersService,
} from '../../../server/services/payment/order.admin.service'
import { OrderStatus, PaymentTransactionStatus, PaymentChannel, PaymentMethod } from '../../../shared/types/payment'

const testIds: TestIds = createEmptyTestIds()
let testUserId: number
let testOrderId: number

const fakeEvent = {
    node: { req: { socket: { remoteAddress: '127.0.0.1' }, headers: {} } },
} as any

beforeAll(async () => {
    if (!(await isTestDbAvailable())) throw new Error('测试数据库不可用')
})
afterEach(async () => { await cleanupTestData(testIds) })
afterAll(async () => { await disconnectTestDb() })

const setupOrderWithPendingPayment = async () => {
    const user = await createTestUser({ name: 'OrderAdminSvcTest' })
    testUserId = user.id
    testIds.userIds.push(user.id)

    const level = await createTestMembershipLevel()
    testIds.membershipLevelIds.push(level.id)

    const product = await createTestProduct(level.id, { name: 'TEST_VIP_SVC' })
    testIds.productIds.push(product.id)

    const order = await createTestOrder(user.id, product.id, {
        status: OrderStatus.PENDING,
    })
    testOrderId = order.id
    testIds.orderIds.push(order.id)

    await getTestPrisma().paymentTransactions.create({
        data: {
            transactionNo: `TXNS_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            orderId: order.id,
            amount: 99,
            paymentChannel: PaymentChannel.WECHAT,
            paymentMethod: PaymentMethod.MINI_PROGRAM,
            status: PaymentTransactionStatus.PENDING,
            expiredAt: new Date(Date.now() + 30 * 60 * 1000),
        },
    })
}

describe('order.admin.service', () => {
    it('cancelOrderByAdminService 同时改订单 + 关闭支付单 + 写审计', async () => {
        await setupOrderWithPendingPayment()
        await cancelOrderByAdminService(fakeEvent, testUserId, testOrderId, '客户误下单')

        const order = await findOrderForAdminService(testOrderId)
        expect(order!.status).toBe(OrderStatus.CANCELLED)
        expect(order!.adminRemark).toContain('[后台取消]')

        const pendingCount = await getTestPrisma().paymentTransactions.count({
            where: { orderId: testOrderId, status: PaymentTransactionStatus.PENDING },
        })
        expect(pendingCount).toBe(0)

        const auditCount = await getTestPrisma().permissionAuditLogs.count({
            where: { targetType: 'order', targetId: testOrderId, action: 'order_cancel' },
        })
        expect(auditCount).toBe(1)
    })

    it('cancelOrderByAdminService 对已支付订单抛错', async () => {
        await setupOrderWithPendingPayment()
        await getTestPrisma().orders.update({
            where: { id: testOrderId },
            data: { status: OrderStatus.PAID, paidAt: new Date() },
        })
        await expect(
            cancelOrderByAdminService(fakeEvent, testUserId, testOrderId, '试图取消'),
        ).rejects.toThrow(/仅待支付订单可取消/)
    })

    it('cancelOrderByAdminService 对不存在订单抛错', async () => {
        await expect(
            cancelOrderByAdminService(fakeEvent, 1, 99999999, 'x'),
        ).rejects.toThrow(/订单不存在/)
    })

    it('updateOrderAdminRemarkService 写备注 + 审计', async () => {
        await setupOrderWithPendingPayment()
        await updateOrderAdminRemarkService(fakeEvent, testUserId, testOrderId, '已联系用户')

        const order = await findOrderForAdminService(testOrderId)
        expect(order!.adminRemark).toBe('已联系用户')

        const auditCount = await getTestPrisma().permissionAuditLogs.count({
            where: { targetType: 'order', targetId: testOrderId, action: 'order_remark_update' },
        })
        expect(auditCount).toBe(1)
    })

    it('findOrderForAdminService 含 auditLogs + adminRemarkUpdaterName', async () => {
        await setupOrderWithPendingPayment()
        await updateOrderAdminRemarkService(fakeEvent, testUserId, testOrderId, '备注 A')
        const order = await findOrderForAdminService(testOrderId)
        expect(order!.auditLogs).toBeInstanceOf(Array)
        expect(order!.auditLogs.length).toBeGreaterThanOrEqual(1)
        expect(order!.adminRemarkUpdaterName).toBe('OrderAdminSvcTest')
    })

    it('findOrdersForAdminService 返回完整列表结构', async () => {
        await setupOrderWithPendingPayment()
        const r = await findOrdersForAdminService({}, { page: 1, pageSize: 10 })
        expect(r.items).toBeInstanceOf(Array)
        expect(r.total).toBeGreaterThan(0)
    })

    it('exportOrdersService 生成带 BOM + 中文表头的 CSV', async () => {
        await setupOrderWithPendingPayment()
        const csv = await exportOrdersService({}, 10000)
        expect(csv.charCodeAt(0)).toBe(0xFEFF)
        expect(csv).toContain('订单号')
        expect(csv).toContain('管理员备注')
    })

    it('exportOrdersService 超 10000 抛错', async () => {
        await expect(exportOrdersService({}, 10001)).rejects.toThrow(/上限/)
    })
})
