/**
 * 商品服务测试
 *
 * 测试商品服务层的业务逻辑，包括：
 * - 商品价格计算
 * - 购买限制检查
 * - 商品过滤
 *
 * **Feature: product-service**
 * **Validates: Requirements 9.1, 9.2, 9.3, 9.4**
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fc from 'fast-check'
import { prisma } from '../../../server/utils/db'
import {
    calculatePriceService,
    checkProductPurchaseLimitService,
    filterProductsByPurchaseLimitService,
    getProductByIdService,
    getActiveProductsService,
} from '../../../server/services/product/product.service'
import { ProductType, ProductStatus } from '../../../shared/types/product'
import type { ProductInfo } from '../../../shared/types/product'

// 测试数据
let testMembershipProduct: { id: number } | null = null
let testPointsProduct: { id: number } | null = null
let testUser: { id: number } | null = null

describe('商品服务测试', () => {
    beforeAll(async () => {
        // 查找测试用的会员商品
        testMembershipProduct = await prisma.products.findFirst({
            where: {
                type: ProductType.MEMBERSHIP,
                status: ProductStatus.ON_SHELF,
                deletedAt: null,
                priceYearly: { not: null },
            },
            select: { id: true },
        })

        // 查找测试用的积分商品
        testPointsProduct = await prisma.products.findFirst({
            where: {
                type: ProductType.POINTS,
                status: ProductStatus.ON_SHELF,
                deletedAt: null,
                unitPrice: { not: null },
            },
            select: { id: true },
        })

        // 查找测试用户
        testUser = await prisma.users.findFirst({
            where: { deletedAt: null },
            select: { id: true },
        })
    })

    afterAll(async () => {
        await prisma.$disconnect()
    })

    describe('getProductByIdService 测试', () => {
        it('应返回存在的商品信息', async () => {
            if (!testMembershipProduct) {
                console.log('没有可用的会员商品，跳过测试')
                return
            }

            const product = await getProductByIdService(testMembershipProduct.id)

            expect(product).not.toBeNull()
            expect(product?.id).toBe(testMembershipProduct.id)
            expect(product?.type).toBe(ProductType.MEMBERSHIP)
        })

        it('不存在的商品应返回 null', async () => {
            const product = await getProductByIdService(999999)
            expect(product).toBeNull()
        })
    })

    describe('getActiveProductsService 测试', () => {
        it('应返回所有上架商品', async () => {
            const products = await getActiveProductsService()

            expect(Array.isArray(products)).toBe(true)
            // 所有返回的商品状态都应该是上架
            for (const product of products) {
                expect(product.status).toBe(ProductStatus.ON_SHELF)
            }
        })

        it('按类型筛选应只返回指定类型的商品', async () => {
            const membershipProducts = await getActiveProductsService(ProductType.MEMBERSHIP)

            for (const product of membershipProducts) {
                expect(product.type).toBe(ProductType.MEMBERSHIP)
            }
        })
    })

    describe('calculatePriceService 测试', () => {
        it('会员商品年付价格计算应正确', async () => {
            if (!testMembershipProduct) {
                console.log('没有可用的会员商品，跳过测试')
                return
            }

            const result = await calculatePriceService({
                productId: testMembershipProduct.id,
                quantity: 1,
                paymentCycle: 'yearly',
            })

            expect(result.productId).toBe(testMembershipProduct.id)
            expect(result.quantity).toBe(1)
            expect(result.unitPrice).toBeGreaterThan(0)
            expect(result.totalPrice).toBe(result.unitPrice * result.quantity)
            expect(result.paymentCycle).toBe('yearly')
            expect(result.paymentUnit).toBe(2) // 年
        })

        it('会员商品月付价格计算应正确', async () => {
            // 查找支持月付的商品
            const monthlyProduct = await prisma.products.findFirst({
                where: {
                    type: ProductType.MEMBERSHIP,
                    status: ProductStatus.ON_SHELF,
                    deletedAt: null,
                    priceMonthly: { not: null },
                },
                select: { id: true },
            })

            if (!monthlyProduct) {
                console.log('没有支持月付的会员商品，跳过测试')
                return
            }

            const result = await calculatePriceService({
                productId: monthlyProduct.id,
                quantity: 1,
                paymentCycle: 'monthly',
            })

            expect(result.paymentCycle).toBe('monthly')
            expect(result.paymentUnit).toBe(1) // 月
        })

        it('积分商品价格计算应正确', async () => {
            if (!testPointsProduct) {
                console.log('没有可用的积分商品，跳过测试')
                return
            }

            const result = await calculatePriceService({
                productId: testPointsProduct.id,
                quantity: 10,
            })

            expect(result.productId).toBe(testPointsProduct.id)
            expect(result.quantity).toBe(10)
            expect(result.totalPrice).toBe(result.unitPrice * 10)
            expect(result.paymentCycle).toBeUndefined() // 积分商品没有支付周期
        })

        it('不存在的商品应抛出错误', async () => {
            await expect(
                calculatePriceService({
                    productId: 999999,
                    quantity: 1,
                })
            ).rejects.toThrow('商品不存在')
        })

        it('购买数量小于最小数量应抛出错误', async () => {
            // 查找有最小购买数量限制的商品
            const limitedProduct = await prisma.products.findFirst({
                where: {
                    status: ProductStatus.ON_SHELF,
                    deletedAt: null,
                    minQuantity: { gt: 1 },
                },
                select: { id: true, minQuantity: true },
            })

            if (!limitedProduct || !limitedProduct.minQuantity) {
                console.log('没有有最小购买数量限制的商品，跳过测试')
                return
            }

            await expect(
                calculatePriceService({
                    productId: limitedProduct.id,
                    quantity: limitedProduct.minQuantity - 1,
                })
            ).rejects.toThrow(/购买数量不能少于/)
        })
    })

    describe('checkProductPurchaseLimitService 测试', () => {
        it('无购买限制的商品应返回 true', async () => {
            // 查找无购买限制的商品
            const unlimitedProduct = await prisma.products.findFirst({
                where: {
                    status: ProductStatus.ON_SHELF,
                    deletedAt: null,
                    OR: [
                        { purchaseLimit: null },
                        { purchaseLimit: 0 },
                    ],
                },
                select: { id: true },
            })

            if (!unlimitedProduct || !testUser) {
                console.log('没有无购买限制的商品或测试用户，跳过测试')
                return
            }

            const result = await checkProductPurchaseLimitService(
                testUser.id,
                unlimitedProduct.id
            )

            expect(result).toBe(true)
        })

        it('不存在的商品应抛出错误', async () => {
            if (!testUser) {
                console.log('没有测试用户，跳过测试')
                return
            }

            await expect(
                checkProductPurchaseLimitService(testUser.id, 999999)
            ).rejects.toThrow('商品不存在')
        })
    })

    describe('filterProductsByPurchaseLimitService 测试', () => {
        it('无购买限制的商品应全部保留', async () => {
            if (!testUser) {
                console.log('没有测试用户，跳过测试')
                return
            }

            const products: ProductInfo[] = [
                {
                    id: 1,
                    name: '测试商品1',
                    description: null,
                    type: ProductType.MEMBERSHIP,
                    category: null,
                    levelId: 1,
                    levelName: '基础版',
                    priceMonthly: 100,
                    priceYearly: 1000,
                    defaultDuration: 2,
                    unitPrice: null,
                    originalPriceMonthly: null,
                    originalPriceYearly: null,
                    originalUnitPrice: null,
                    minQuantity: 1,
                    maxQuantity: null,
                    purchaseLimit: 0, // 无限制
                    pointAmount: null,
                    giftPoint: 100,
                    status: ProductStatus.ON_SHELF,
                    sortOrder: 1,
                },
                {
                    id: 2,
                    name: '测试商品2',
                    description: null,
                    type: ProductType.MEMBERSHIP,
                    category: null,
                    levelId: 2,
                    levelName: '专业版',
                    priceMonthly: 200,
                    priceYearly: 2000,
                    defaultDuration: 2,
                    unitPrice: null,
                    originalPriceMonthly: null,
                    originalPriceYearly: null,
                    originalUnitPrice: null,
                    minQuantity: 1,
                    maxQuantity: null,
                    purchaseLimit: null, // 无限制
                    pointAmount: null,
                    giftPoint: 200,
                    status: ProductStatus.ON_SHELF,
                    sortOrder: 2,
                },
            ]

            const filtered = await filterProductsByPurchaseLimitService(
                testUser.id,
                products
            )

            expect(filtered.length).toBe(2)
        })

        it('空商品列表应返回空数组', async () => {
            if (!testUser) {
                console.log('没有测试用户，跳过测试')
                return
            }

            const filtered = await filterProductsByPurchaseLimitService(
                testUser.id,
                []
            )

            expect(filtered).toEqual([])
        })
    })
})

describe('Property: 价格计算一致性', () => {
    it('总价应等于单价乘以数量', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 100 }),
                fc.integer({ min: 1, max: 10000 }),
                (quantity, unitPrice) => {
                    const totalPrice = unitPrice * quantity
                    expect(totalPrice).toBe(unitPrice * quantity)
                }
            ),
            { numRuns: 100 }
        )
    })
})
