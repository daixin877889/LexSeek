/**
 * 用户端订单接口 admin_remark 隔离回归测试
 *
 * 防止未来修改 server/api/v1/payments/orders.get.ts 时把 adminRemark 字段
 * 加进序列化白名单，导致管理员备注泄漏到用户端。
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
import { getUserOrdersService } from '../../../server/services/payment/order.service'
import { decimalToNumberUtils } from '../../../shared/utils/decimalToNumber'

const testIds: TestIds = createEmptyTestIds()

beforeAll(async () => {
    if (!(await isTestDbAvailable())) throw new Error('测试数据库不可用')
})
afterEach(async () => { await cleanupTestData(testIds) })
afterAll(async () => { await disconnectTestDb() })

describe('用户端订单接口不暴露 admin_remark', () => {
    it('getUserOrdersService 配合接口字段 map 后不含 adminRemark', async () => {
        const user = await createTestUser({ name: 'UserApiRegression' })
        testIds.userIds.push(user.id)

        const level = await createTestMembershipLevel()
        testIds.membershipLevelIds.push(level.id)

        const product = await createTestProduct(level.id, { name: 'TEST_REGRESS' })
        testIds.productIds.push(product.id)

        const order = await createTestOrder(user.id, product.id)
        testIds.orderIds.push(order.id)

        // 设置 admin_remark（模拟管理员留言）
        const sentinel = '管理员内部备注_不应泄漏_RPGY3K'
        await getTestPrisma().orders.update({
            where: { id: order.id },
            data: {
                adminRemark: sentinel,
                adminRemarkUpdatedBy: user.id,
                adminRemarkUpdatedAt: new Date(),
            },
        })

        const result = await getUserOrdersService(user.id, { page: 1, pageSize: 10 })

        // 模拟 server/api/v1/payments/orders.get.ts 的字段 map（必须保持同步）
        const list = result.list.map((o) => ({
            id: o.id,
            orderNo: o.orderNo,
            productName: o.product?.name || '未知商品',
            productType: o.product?.type || 0,
            amount: decimalToNumberUtils(o.amount),
            duration: o.duration,
            durationUnit: o.durationUnit,
            status: o.status,
            paidAt: o.paidAt,
            expiredAt: o.expiredAt,
            createdAt: o.createdAt,
        }))

        for (const item of list) {
            const keys = Object.keys(item)
            expect(keys).not.toContain('adminRemark')
            expect(keys).not.toContain('admin_remark')
            expect(keys).not.toContain('adminRemarkUpdatedBy')
            expect(keys).not.toContain('adminRemarkUpdatedAt')

            const json = JSON.stringify(item)
            expect(json).not.toContain(sentinel)
        }
    })
})
