/**
 * 订单管理端 DAO 测试
 *
 * Validates: server/services/payment/order.admin.dao.ts
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
    findOrdersForAdminDao,
    findOrderForAdminDao,
    updateOrderAdminRemarkDao,
    updateOrderForAdminCancelDao,
    findOrdersForAdminExportDao,
} from '../../../server/services/payment/order.admin.dao'
import { OrderStatus, OrderType } from '../../../shared/types/payment'

const testIds: TestIds = createEmptyTestIds()
let testUserId: number
let testProductId: number
let testOrderId: number
let testLevelId: number

beforeAll(async () => {
    if (!(await isTestDbAvailable())) {
        throw new Error('测试数据库不可用')
    }
})

afterEach(async () => {
    await cleanupTestData(testIds)
})

afterAll(async () => {
    await disconnectTestDb()
})

const setupOrderFixture = async () => {
    const user = await createTestUser({ name: 'AdminDaoTestUser' })
    testUserId = user.id
    testIds.userIds.push(user.id)

    const level = await createTestMembershipLevel()
    testLevelId = level.id
    testIds.membershipLevelIds.push(level.id)

    const product = await createTestProduct(level.id, { name: 'TEST_VIP_MONTHLY' })
    testProductId = product.id
    testIds.productIds.push(product.id)

    const order = await createTestOrder(user.id, product.id, {
        status: OrderStatus.PENDING,
        orderType: OrderType.PURCHASE,
    })
    testOrderId = order.id
    testIds.orderIds.push(order.id)
}

describe('order.admin.dao', () => {
    describe('findOrdersForAdminDao', () => {
        it('按订单号关键字搜索能命中', async () => {
            await setupOrderFixture()
            const order = await getTestPrisma().orders.findUnique({ where: { id: testOrderId } })
            const result = await findOrdersForAdminDao(
                { keyword: order!.orderNo },
                { page: 1, pageSize: 10 },
            )
            expect(result.total).toBeGreaterThan(0)
            expect(result.items.some((o) => o.id === testOrderId)).toBe(true)
        })

        it('按状态筛选只返回该状态', async () => {
            await setupOrderFixture()
            const result = await findOrdersForAdminDao(
                { status: OrderStatus.PENDING },
                { page: 1, pageSize: 10 },
            )
            expect(result.items.every((o) => o.status === OrderStatus.PENDING)).toBe(true)
            expect(result.items.some((o) => o.id === testOrderId)).toBe(true)
        })

        it('分页参数生效', async () => {
            await setupOrderFixture()
            const r = await findOrdersForAdminDao({}, { page: 1, pageSize: 1 })
            expect(r.items.length).toBeLessThanOrEqual(1)
            expect(r.pageSize).toBe(1)
        })

        it('返回项含 user 和 product 关联', async () => {
            await setupOrderFixture()
            const r = await findOrdersForAdminDao({}, { page: 1, pageSize: 50 })
            const found = r.items.find((o) => o.id === testOrderId)
            expect(found).toBeDefined()
            expect(found!.user).toBeDefined()
            expect(found!.user.phone).toBeDefined()
            expect(found!.product).toBeDefined()
            expect(found!.product.name).toBeDefined()
        })
    })

    describe('findOrderForAdminDao', () => {
        it('返回订单 + user + product + paymentTransactions', async () => {
            await setupOrderFixture()
            const order = await findOrderForAdminDao(testOrderId)
            expect(order).not.toBeNull()
            expect(order!.id).toBe(testOrderId)
            expect(order!.user).toBeDefined()
            expect(order!.product).toBeDefined()
            expect(order!.paymentTransactions).toBeInstanceOf(Array)
        })

        it('不存在的 ID 返回 null', async () => {
            const order = await findOrderForAdminDao(99999999)
            expect(order).toBeNull()
        })
    })

    describe('updateOrderAdminRemarkDao', () => {
        it('写入 admin_remark + updated_by + updated_at', async () => {
            await setupOrderFixture()
            const before = await findOrderForAdminDao(testOrderId)
            expect(before!.adminRemark).toBeNull()

            await updateOrderAdminRemarkDao(testOrderId, '测试备注', testUserId)

            const after = await findOrderForAdminDao(testOrderId)
            expect(after!.adminRemark).toBe('测试备注')
            expect(after!.adminRemarkUpdatedBy).toBe(testUserId)
            expect(after!.adminRemarkUpdatedAt).not.toBeNull()
        })

        it('支持清空备注（传 null）', async () => {
            await setupOrderFixture()
            await updateOrderAdminRemarkDao(testOrderId, '初始', testUserId)
            await updateOrderAdminRemarkDao(testOrderId, null, testUserId)
            const order = await findOrderForAdminDao(testOrderId)
            expect(order!.adminRemark).toBeNull()
        })
    })

    describe('updateOrderForAdminCancelDao', () => {
        it('订单状态改为 CANCELLED 且 admin_remark 含取消原因前缀', async () => {
            await setupOrderFixture()
            await updateOrderForAdminCancelDao(testOrderId, '客户误下单', testUserId)
            const order = await findOrderForAdminDao(testOrderId)
            expect(order!.status).toBe(OrderStatus.CANCELLED)
            expect(order!.adminRemark).toContain('[后台取消]')
            expect(order!.adminRemark).toContain('客户误下单')
            expect(order!.adminRemarkUpdatedBy).toBe(testUserId)
        })
    })

    describe('findOrdersForAdminExportDao', () => {
        it('返回数组（不带分页字段）', async () => {
            await setupOrderFixture()
            const orders = await findOrdersForAdminExportDao({}, 100)
            expect(Array.isArray(orders)).toBe(true)
            expect(orders.some((o: any) => o.id === testOrderId)).toBe(true)
        })

        it('respect limit', async () => {
            await setupOrderFixture()
            const orders = await findOrdersForAdminExportDao({}, 1)
            expect(orders.length).toBeLessThanOrEqual(1)
        })
    })
})
