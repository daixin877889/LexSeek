/**
 * 商品服务覆盖测试
 *
 * 补充覆盖 product.service.ts 中的：
 * - calculatePriceService 边界条件
 * - 不支持的商品类型
 * - maxQuantity 检查
 * - 不支持月付/年付的商品
 * - 积分商品价格缺失
 *
 * **Feature: product-service-coverage**
 * **Validates: Requirements 9.5, 9.6**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { prisma } from '../../../server/utils/db'
import {
    calculatePriceService,
    getProductByIdService,
    getProductsForAdminService,
    toggleProductStatusService,
    deleteProductService,
    updateProductService,
} from '../../../server/services/product/product.service'
import { ProductType, ProductStatus } from '../../../shared/types/product'

const testProductIds: number[] = []

describe('商品服务覆盖测试', () => {
    afterEach(async () => {
        if (testProductIds.length > 0) {
            await prisma.products.deleteMany({ where: { id: { in: testProductIds } } })
            testProductIds.length = 0
        }
    })

    afterAll(async () => {
        await prisma.$disconnect()
    })

    describe('calculatePriceService - 边界条件', () => {
        it('不支持月付的会员商品应抛出错误', async () => {
            // 创建一个只有年价的会员商品
            const product = await prisma.products.create({
                data: {
                    name: `测试仅年付_${Date.now()}`,
                    type: ProductType.MEMBERSHIP,
                    priceYearly: 999,
                    priceMonthly: null,
                    status: ProductStatus.ON_SHELF,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testProductIds.push(product.id)

            await expect(
                calculatePriceService({
                    productId: product.id,
                    quantity: 1,
                    paymentCycle: 'monthly',
                })
            ).rejects.toThrow('该会员商品不支持月付')
        })

        it('不支持年付的会员商品应抛出错误', async () => {
            const product = await prisma.products.create({
                data: {
                    name: `测试仅月付_${Date.now()}`,
                    type: ProductType.MEMBERSHIP,
                    priceMonthly: 99,
                    priceYearly: null,
                    status: ProductStatus.ON_SHELF,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testProductIds.push(product.id)

            await expect(
                calculatePriceService({
                    productId: product.id,
                    quantity: 1,
                    paymentCycle: 'yearly',
                })
            ).rejects.toThrow('该会员商品不支持年付')
        })

        it('积分商品价格配置错误应抛出', async () => {
            const product = await prisma.products.create({
                data: {
                    name: `测试无价积分_${Date.now()}`,
                    type: ProductType.POINTS,
                    unitPrice: null,
                    status: ProductStatus.ON_SHELF,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testProductIds.push(product.id)

            await expect(
                calculatePriceService({
                    productId: product.id,
                    quantity: 1,
                })
            ).rejects.toThrow('积分商品价格配置错误')
        })

        it('超过最大购买数量应抛出错误', async () => {
            const product = await prisma.products.create({
                data: {
                    name: `测试限量_${Date.now()}`,
                    type: ProductType.POINTS,
                    unitPrice: 10,
                    minQuantity: 1,
                    maxQuantity: 5,
                    status: ProductStatus.ON_SHELF,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testProductIds.push(product.id)

            await expect(
                calculatePriceService({
                    productId: product.id,
                    quantity: 10,
                })
            ).rejects.toThrow(/购买数量不能超过/)
        })

        it('下架商品应抛出错误', async () => {
            const product = await prisma.products.create({
                data: {
                    name: `测试下架_${Date.now()}`,
                    type: ProductType.MEMBERSHIP,
                    priceYearly: 999,
                    status: ProductStatus.OFF_SHELF,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testProductIds.push(product.id)

            await expect(
                calculatePriceService({
                    productId: product.id,
                    quantity: 1,
                })
            ).rejects.toThrow('商品已下架')
        })
    })

    describe('getProductsForAdminService', () => {
        it('应返回产品列表和总数', async () => {
            const result = await getProductsForAdminService()
            expect(result).toHaveProperty('list')
            expect(result).toHaveProperty('total')
            expect(Array.isArray(result.list)).toBe(true)
        })

        it('按类型筛选应正确过滤', async () => {
            const result = await getProductsForAdminService({ type: ProductType.MEMBERSHIP })
            for (const item of result.list) {
                expect(item.type).toBe(ProductType.MEMBERSHIP)
            }
        })

        it('按状态筛选应正确过滤', async () => {
            const result = await getProductsForAdminService({ status: ProductStatus.ON_SHELF })
            for (const item of result.list) {
                expect(item.status).toBe(ProductStatus.ON_SHELF)
            }
        })

        it('分页应正确工作', async () => {
            const result = await getProductsForAdminService({ page: 1, pageSize: 2 })
            expect(result.list.length).toBeLessThanOrEqual(2)
        })
    })

    describe('toggleProductStatusService', () => {
        it('应切换上架商品为下架', async () => {
            const product = await prisma.products.create({
                data: {
                    name: `测试切换_${Date.now()}`,
                    type: ProductType.POINTS,
                    unitPrice: 10,
                    status: ProductStatus.ON_SHELF,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testProductIds.push(product.id)

            const toggled = await toggleProductStatusService(product.id)
            expect(toggled.status).toBe(ProductStatus.OFF_SHELF)
        })

        it('应切换下架商品为上架', async () => {
            const product = await prisma.products.create({
                data: {
                    name: `测试切换2_${Date.now()}`,
                    type: ProductType.POINTS,
                    unitPrice: 10,
                    status: ProductStatus.OFF_SHELF,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testProductIds.push(product.id)

            const toggled = await toggleProductStatusService(product.id)
            expect(toggled.status).toBe(ProductStatus.ON_SHELF)
        })

        it('不存在的产品应抛出错误', async () => {
            await expect(toggleProductStatusService(999999)).rejects.toThrow('产品不存在')
        })
    })

    describe('deleteProductService', () => {
        it('应软删除产品', async () => {
            const product = await prisma.products.create({
                data: {
                    name: `测试删除_${Date.now()}`,
                    type: ProductType.POINTS,
                    unitPrice: 10,
                    status: ProductStatus.ON_SHELF,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testProductIds.push(product.id)

            await deleteProductService(product.id)

            const deleted = await getProductByIdService(product.id)
            expect(deleted).toBeNull()
        })

        it('不存在的产品应抛出错误', async () => {
            await expect(deleteProductService(999999)).rejects.toThrow('产品不存在')
        })
    })

    describe('updateProductService', () => {
        it('不存在的产品应抛出错误', async () => {
            await expect(
                updateProductService(999999, { name: '新名称' })
            ).rejects.toThrow('产品不存在')
        })

        it('应成功更新各字段', async () => {
            const product = await prisma.products.create({
                data: {
                    name: `测试更新_${Date.now()}`,
                    type: ProductType.POINTS,
                    unitPrice: 10,
                    status: ProductStatus.ON_SHELF,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testProductIds.push(product.id)

            const updated = await updateProductService(product.id, {
                name: '更新后的名称',
                description: '新描述',
                unitPrice: 20,
                minQuantity: 2,
                maxQuantity: 100,
                purchaseLimit: 5,
                sortOrder: 10,
            })

            expect(updated.name).toBe('更新后的名称')
            expect(updated.description).toBe('新描述')
            expect(updated.unitPrice).toBe(20)
            expect(updated.minQuantity).toBe(2)
            expect(updated.sortOrder).toBe(10)
        })
    })
})
