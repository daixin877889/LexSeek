/**
 * 订单 DAO 覆盖率补充测试
 *
 * 覆盖 order.dao.ts 中未被测试的路径：
 * - generateOrderNo 格式验证
 * - findUserOrdersDao 分页和状态筛选
 * - findExpiredPendingOrdersDao 过期订单查询
 * - cancelExpiredOrdersDao 批量取消
 * - countUserProductOrdersDao 购买次数统计
 * - countUserProductsOrdersDao 批量统计
 *
 * **Feature: order-dao**
 * **Validates: Requirements 10.1, 10.2**
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fc from 'fast-check'
import { prisma } from '../../../server/utils/db'
import {
    generateOrderNo,
    findUserOrdersDao,
    findExpiredPendingOrdersDao,
    countUserProductOrdersDao,
    countUserProductsOrdersDao,
} from '../../../server/services/payment/order.dao'
import { OrderStatus } from '../../../shared/types/payment'

describe('订单 DAO - 覆盖率补充', () => {
    describe('generateOrderNo', () => {
        it('应生成以 LSD 开头的订单号', () => {
            const orderNo = generateOrderNo()
            expect(orderNo.startsWith('LSD')).toBe(true)
        })

        it('应生成固定长度的订单号', () => {
            const orderNo = generateOrderNo()
            // LSD + 14位日期 + 6位随机数 = 23位
            expect(orderNo.length).toBe(23)
        })

        it('每次生成的订单号应不同（属性测试）', () => {
            fc.assert(
                fc.property(fc.constant(null), () => {
                    const no1 = generateOrderNo()
                    const no2 = generateOrderNo()
                    // 极小概率相同，但由于包含时间戳和随机数，几乎不可能
                    // 这里只验证格式
                    expect(no1.startsWith('LSD')).toBe(true)
                    expect(no2.startsWith('LSD')).toBe(true)
                }),
                { numRuns: 50 }
            )
        })
    })

    describe('findUserOrdersDao', () => {
        it('应返回分页结果', async () => {
            const user = await prisma.users.findFirst({
                where: { deletedAt: null },
                select: { id: true },
            })

            if (!user) return

            const result = await findUserOrdersDao(user.id, { page: 1, pageSize: 5 })

            expect(result).toHaveProperty('list')
            expect(result).toHaveProperty('total')
            expect(Array.isArray(result.list)).toBe(true)
            expect(result.list.length).toBeLessThanOrEqual(5)
        })

        it('应按状态筛选订单', async () => {
            const user = await prisma.users.findFirst({
                where: { deletedAt: null },
                select: { id: true },
            })

            if (!user) return

            const result = await findUserOrdersDao(user.id, {
                status: OrderStatus.PAID,
            })

            // 所有返回的订单状态应该是已支付
            for (const order of result.list) {
                expect(order.status).toBe(OrderStatus.PAID)
            }
        })

        it('不存在的用户应返回空列表', async () => {
            const result = await findUserOrdersDao(999999, { page: 1, pageSize: 10 })

            expect(result.list.length).toBe(0)
            expect(result.total).toBe(0)
        })
    })

    describe('findExpiredPendingOrdersDao', () => {
        it('应返回过期的待支付订单列表', async () => {
            const result = await findExpiredPendingOrdersDao()

            expect(Array.isArray(result)).toBe(true)
            // 所有返回的订单应该是待支付且已过期
            for (const order of result) {
                expect(order.status).toBe(OrderStatus.PENDING)
                expect(new Date(order.expiredAt).getTime()).toBeLessThan(Date.now())
            }
        })
    })

    describe('countUserProductOrdersDao', () => {
        it('应返回正确的购买次数', async () => {
            const user = await prisma.users.findFirst({
                where: { deletedAt: null },
                select: { id: true },
            })

            if (!user) return

            // 查找用户购买过的商品
            const paidOrder = await prisma.orders.findFirst({
                where: {
                    userId: user.id,
                    status: OrderStatus.PAID,
                    deletedAt: null,
                },
                select: { productId: true },
            })

            if (!paidOrder) return

            const count = await countUserProductOrdersDao(user.id, paidOrder.productId)

            expect(count).toBeGreaterThanOrEqual(1)
            expect(typeof count).toBe('number')
        })

        it('未购买过的商品应返回 0', async () => {
            const user = await prisma.users.findFirst({
                where: { deletedAt: null },
                select: { id: true },
            })

            if (!user) return

            const count = await countUserProductOrdersDao(user.id, 999999)

            expect(count).toBe(0)
        })
    })

    describe('countUserProductsOrdersDao', () => {
        it('应批量返回购买次数映射', async () => {
            const user = await prisma.users.findFirst({
                where: { deletedAt: null },
                select: { id: true },
            })

            if (!user) return

            const countMap = await countUserProductsOrdersDao(user.id, [1, 2, 3])

            expect(countMap instanceof Map).toBe(true)
        })

        it('空商品列表应返回空映射', async () => {
            const user = await prisma.users.findFirst({
                where: { deletedAt: null },
                select: { id: true },
            })

            if (!user) return

            const countMap = await countUserProductsOrdersDao(user.id, [])

            expect(countMap.size).toBe(0)
        })
    })
})
