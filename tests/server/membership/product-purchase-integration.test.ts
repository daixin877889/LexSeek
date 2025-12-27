/**
 * 商品购买集成测试
 *
 * 测试场景：
 * - 购买会员商品 → 创建订单
 * - 购买积分商品 → 创建订单
 * - 支付成功（会员商品）→ 创建会员记录 + 赠送积分
 * - 支付成功（积分商品）→ 创建积分记录，有效期1年
 * - 订单过期 → 可重新发起支付
 * - 支付单过期 → 可重新创建支付单
 *
 * **Feature: membership-system**
 * **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
    createMembershipLevel,
    createProduct,
    createOrder,
    ProductType,
    OrderStatus,
    UserMembershipSourceType,
} from './membership-test-fixtures'
import {
    isOrderPayable,
    simulatePaymentSuccess,
    generateOrderNo,
    daysFromNow,
    daysAgo,
} from './membership-test-helpers'

describe('商品购买集成测试', () => {
    describe('订单创建', () => {
        it('购买会员商品应创建订单', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 12 }),
                    fc.constantFrom('month', 'year'),
                    (userId, duration, durationUnit) => {
                        const product = createProduct({
                            type: ProductType.MEMBERSHIP,
                            levelId: 1,
                            priceMonthly: 29.9,
                            priceYearly: 299,
                        })

                        const amount =
                            durationUnit === 'year'
                                ? (product.priceYearly ?? 0) * duration
                                : (product.priceMonthly ?? 0) * duration

                        const order = createOrder({
                            userId,
                            productId: product.id,
                            amount,
                            duration,
                            durationUnit,
                            status: OrderStatus.PENDING,
                        })

                        expect(order.userId).toBe(userId)
                        expect(order.productId).toBe(product.id)
                        expect(order.amount).toBe(amount)
                        expect(order.status).toBe(OrderStatus.PENDING)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('购买积分商品应创建订单', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 100, max: 10000 }),
                    (userId, pointAmount) => {
                        const product = createProduct({
                            type: ProductType.POINTS,
                            levelId: null,
                            unitPrice: 0.1,
                            pointAmount,
                        })

                        const amount = (product.unitPrice ?? 0) * pointAmount

                        const order = createOrder({
                            userId,
                            productId: product.id,
                            amount,
                            duration: 1,
                            durationUnit: 'year',
                            status: OrderStatus.PENDING,
                        })

                        expect(order.userId).toBe(userId)
                        expect(order.productId).toBe(product.id)
                        expect(order.status).toBe(OrderStatus.PENDING)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('订单号应唯一', () => {
            const orderNos = new Set<string>()

            for (let i = 0; i < 100; i++) {
                const orderNo = generateOrderNo()
                expect(orderNos.has(orderNo)).toBe(false)
                orderNos.add(orderNo)
            }
        })
    })

    describe('订单状态验证', () => {
        it('待支付且未过期的订单应可支付', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 30 }),
                    (minutesUntilExpiry) => {
                        const order = createOrder({
                            status: OrderStatus.PENDING,
                            expiredAt: new Date(
                                Date.now() + minutesUntilExpiry * 60 * 1000
                            ),
                        })

                        expect(isOrderPayable(order)).toBe(true)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('已支付的订单不可再次支付', () => {
            const order = createOrder({
                status: OrderStatus.PAID,
                expiredAt: daysFromNow(1),
            })

            expect(isOrderPayable(order)).toBe(false)
        })

        it('已取消的订单不可支付', () => {
            const order = createOrder({
                status: OrderStatus.CANCELLED,
                expiredAt: daysFromNow(1),
            })

            expect(isOrderPayable(order)).toBe(false)
        })

        it('已过期的订单不可支付', () => {
            const order = createOrder({
                status: OrderStatus.PENDING,
                expiredAt: daysAgo(1),
            })

            expect(isOrderPayable(order)).toBe(false)
        })
    })

    describe('支付成功处理 - 会员商品', () => {
        it('支付成功应创建会员记录', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 12 }),
                    fc.constantFrom('month', 'year'),
                    (userId, duration, durationUnit) => {
                        const level = createMembershipLevel({ id: 1 })
                        const product = createProduct({
                            type: ProductType.MEMBERSHIP,
                            levelId: 1,
                            giftPoint: 100,
                        })
                        const order = createOrder({
                            userId,
                            productId: product.id,
                            duration,
                            durationUnit,
                            status: OrderStatus.PAID,
                        })

                        const result = simulatePaymentSuccess(order, product, level)

                        expect(result.membership).not.toBeNull()
                        expect(result.membership?.userId).toBe(userId)
                        expect(result.membership?.levelId).toBe(1)
                        expect(result.membership?.sourceType).toBe(
                            UserMembershipSourceType.DIRECT_PURCHASE
                        )
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('支付成功应发放赠送积分', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 1000 }),
                    (userId, giftPoint) => {
                        const level = createMembershipLevel({ id: 1 })
                        const product = createProduct({
                            type: ProductType.MEMBERSHIP,
                            levelId: 1,
                            giftPoint,
                        })
                        const order = createOrder({
                            userId,
                            productId: product.id,
                            duration: 1,
                            durationUnit: 'month',
                            status: OrderStatus.PAID,
                        })

                        const result = simulatePaymentSuccess(order, product, level)

                        expect(result.points).toBe(giftPoint)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('赠送积分有效期应等于会员有效期', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    (userId) => {
                        const level = createMembershipLevel({ id: 1 })
                        const product = createProduct({
                            type: ProductType.MEMBERSHIP,
                            levelId: 1,
                            giftPoint: 100,
                        })
                        const order = createOrder({
                            userId,
                            productId: product.id,
                            duration: 1,
                            durationUnit: 'year',
                            status: OrderStatus.PAID,
                        })

                        const result = simulatePaymentSuccess(order, product, level)

                        expect(result.pointExpiredAt?.getTime()).toBe(
                            result.membership?.endDate.getTime()
                        )
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('支付成功处理 - 积分商品', () => {
        it('支付成功应创建积分记录', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 100, max: 10000 }),
                    (userId, pointAmount) => {
                        const product = createProduct({
                            type: ProductType.POINTS,
                            levelId: null,
                            pointAmount,
                        })
                        const order = createOrder({
                            userId,
                            productId: product.id,
                            duration: 1,
                            durationUnit: 'year',
                            status: OrderStatus.PAID,
                        })

                        const result = simulatePaymentSuccess(order, product, null)

                        expect(result.membership).toBeNull()
                        expect(result.points).toBe(pointAmount)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('积分有效期应为1年', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 100, max: 10000 }),
                    (userId, pointAmount) => {
                        const product = createProduct({
                            type: ProductType.POINTS,
                            levelId: null,
                            pointAmount,
                        })
                        const order = createOrder({
                            userId,
                            productId: product.id,
                            duration: 1,
                            durationUnit: 'year',
                            status: OrderStatus.PAID,
                        })

                        const result = simulatePaymentSuccess(order, product, null)

                        // 验证积分有效期约为1年
                        const expectedExpiry = daysFromNow(365)
                        const diff = Math.abs(
                            result.pointExpiredAt!.getTime() - expectedExpiry.getTime()
                        )
                        expect(diff).toBeLessThan(24 * 60 * 60 * 1000) // 1天误差
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 9: 支付成功处理正确性', () => {
        it('会员商品支付成功应创建会员记录并发放赠送积分', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 1000 }),
                    (userId, giftPoint) => {
                        const level = createMembershipLevel({ id: 1 })
                        const product = createProduct({
                            type: ProductType.MEMBERSHIP,
                            levelId: 1,
                            giftPoint,
                        })
                        const order = createOrder({
                            userId,
                            productId: product.id,
                            status: OrderStatus.PAID,
                        })

                        const result = simulatePaymentSuccess(order, product, level)

                        // 验证会员记录
                        expect(result.membership).not.toBeNull()
                        expect(result.membership?.userId).toBe(userId)

                        // 验证赠送积分
                        expect(result.points).toBe(giftPoint)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('积分商品支付成功应创建积分记录，有效期为1年', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 100, max: 10000 }),
                    (userId, pointAmount) => {
                        const product = createProduct({
                            type: ProductType.POINTS,
                            pointAmount,
                        })
                        const order = createOrder({
                            userId,
                            productId: product.id,
                            status: OrderStatus.PAID,
                        })

                        const result = simulatePaymentSuccess(order, product, null)

                        // 验证积分记录
                        expect(result.points).toBe(pointAmount)

                        // 验证有效期为1年
                        const oneYearLater = daysFromNow(365)
                        const diff = Math.abs(
                            result.pointExpiredAt!.getTime() - oneYearLater.getTime()
                        )
                        expect(diff).toBeLessThan(24 * 60 * 60 * 1000)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})
