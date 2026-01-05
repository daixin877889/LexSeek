/**
 * 产品管理服务测试
 *
 * 测试管理后台产品管理的服务层功能，包括：
 * - 产品列表查询（分页、筛选）
 * - 产品 CRUD 操作
 * - 产品状态切换
 *
 * **Feature: admin-product-management**
 * **Validates: Requirements 1.4, 1.5, 1.6, 2.4, 3.2, 4.1, 5.2**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import { prisma } from '../../../server/utils/db'
import {
    getProductsForAdminService,
    createProductService,
    updateProductService,
    toggleProductStatusService,
    deleteProductService,
    getProductByIdService,
} from '../../../server/services/product/product.service'
import { ProductType, ProductStatus } from '../../../shared/types/product'

// 测试数据追踪
const testProductIds: number[] = []
let testLevelId: number | null = null

describe('产品管理服务测试', () => {
    beforeAll(async () => {
        // 获取一个测试用的会员级别
        const level = await prisma.membershipLevels.findFirst({
            where: { deletedAt: null, status: 1 },
            select: { id: true },
        })
        testLevelId = level?.id || null
    })

    afterEach(async () => {
        // 清理测试创建的产品
        if (testProductIds.length > 0) {
            await prisma.products.deleteMany({
                where: { id: { in: testProductIds } },
            })
            testProductIds.length = 0
        }
    })

    afterAll(async () => {
        await prisma.$disconnect()
    })

    describe('getProductsForAdminService 测试', () => {
        it('应返回分页的产品列表', async () => {
            const result = await getProductsForAdminService({ page: 1, pageSize: 10 })

            expect(result).toHaveProperty('list')
            expect(result).toHaveProperty('total')
            expect(Array.isArray(result.list)).toBe(true)
            expect(typeof result.total).toBe('number')
        })

        it('应正确按类型筛选', async () => {
            const result = await getProductsForAdminService({
                page: 1,
                pageSize: 100,
                type: ProductType.MEMBERSHIP,
            })

            for (const product of result.list) {
                expect(product.type).toBe(ProductType.MEMBERSHIP)
            }
        })

        it('应正确按状态筛选', async () => {
            const result = await getProductsForAdminService({
                page: 1,
                pageSize: 100,
                status: ProductStatus.ON_SHELF,
            })

            for (const product of result.list) {
                expect(product.status).toBe(ProductStatus.ON_SHELF)
            }
        })
    })

    describe('createProductService 测试', () => {
        it('应成功创建会员产品', async () => {
            if (!testLevelId) {
                console.log('没有可用的会员级别，跳过测试')
                return
            }

            const product = await createProductService({
                name: '测试会员产品_' + Date.now(),
                type: ProductType.MEMBERSHIP,
                levelId: testLevelId,
                priceYearly: 199,
                status: ProductStatus.OFF_SHELF,
            })
            testProductIds.push(product.id)

            expect(product.id).toBeGreaterThan(0)
            expect(product.type).toBe(ProductType.MEMBERSHIP)
            expect(product.levelId).toBe(testLevelId)
            expect(product.priceYearly).toBe(199)
        })

        it('应成功创建积分产品', async () => {
            const product = await createProductService({
                name: '测试积分产品_' + Date.now(),
                type: ProductType.POINTS,
                pointAmount: 1000,
                unitPrice: 10,
                status: ProductStatus.OFF_SHELF,
            })
            testProductIds.push(product.id)

            expect(product.id).toBeGreaterThan(0)
            expect(product.type).toBe(ProductType.POINTS)
            expect(product.pointAmount).toBe(1000)
            expect(product.unitPrice).toBe(10)
        })
    })

    describe('updateProductService 测试', () => {
        it('应成功更新产品信息', async () => {
            // 先创建一个产品
            const created = await createProductService({
                name: '测试产品_更新前_' + Date.now(),
                type: ProductType.POINTS,
                pointAmount: 500,
                unitPrice: 5,
                status: ProductStatus.OFF_SHELF,
            })
            testProductIds.push(created.id)

            // 更新产品
            const updated = await updateProductService(created.id, {
                name: '测试产品_更新后',
                pointAmount: 1000,
                unitPrice: 8,
            })

            expect(updated.name).toBe('测试产品_更新后')
            expect(updated.pointAmount).toBe(1000)
            expect(updated.unitPrice).toBe(8)
        })

        it('更新不存在的产品应抛出错误', async () => {
            await expect(
                updateProductService(999999, { name: '不存在' })
            ).rejects.toThrow('产品不存在')
        })
    })

    describe('toggleProductStatusService 测试', () => {
        it('应成功切换产品状态', async () => {
            // 创建一个下架的产品
            const created = await createProductService({
                name: '测试产品_状态切换_' + Date.now(),
                type: ProductType.POINTS,
                pointAmount: 100,
                unitPrice: 1,
                status: ProductStatus.OFF_SHELF,
            })
            testProductIds.push(created.id)

            // 切换状态（下架 -> 上架）
            const toggled = await toggleProductStatusService(created.id)
            expect(toggled.status).toBe(ProductStatus.ON_SHELF)

            // 再次切换（上架 -> 下架）
            const toggledAgain = await toggleProductStatusService(created.id)
            expect(toggledAgain.status).toBe(ProductStatus.OFF_SHELF)
        })

        it('切换不存在的产品状态应抛出错误', async () => {
            await expect(
                toggleProductStatusService(999999)
            ).rejects.toThrow('产品不存在')
        })
    })

    describe('deleteProductService 测试', () => {
        it('应成功软删除产品', async () => {
            // 创建一个产品
            const created = await createProductService({
                name: '测试产品_删除_' + Date.now(),
                type: ProductType.POINTS,
                pointAmount: 100,
                unitPrice: 1,
                status: ProductStatus.OFF_SHELF,
            })
            // 不加入 testProductIds，因为会被删除

            // 删除产品
            await deleteProductService(created.id)

            // 验证产品已被软删除
            const found = await getProductByIdService(created.id)
            expect(found).toBeNull()

            // 验证数据库中 deletedAt 已设置
            const dbProduct = await prisma.products.findUnique({
                where: { id: created.id },
            })
            expect(dbProduct).not.toBeNull()
            expect(dbProduct!.deletedAt).not.toBeNull()

            // 清理
            await prisma.products.delete({ where: { id: created.id } })
        })

        it('删除不存在的产品应抛出错误', async () => {
            await expect(
                deleteProductService(999999)
            ).rejects.toThrow('产品不存在')
        })
    })
})

/**
 * Property 1: 产品筛选结果一致性
 *
 * 对于任意筛选条件，返回的所有产品都应满足该筛选条件
 */
describe('Property 1: 产品筛选结果一致性', () => {
    it('按类型筛选的结果应全部匹配该类型', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.constantFrom(ProductType.MEMBERSHIP, ProductType.POINTS),
                async (type) => {
                    const result = await getProductsForAdminService({
                        page: 1,
                        pageSize: 100,
                        type,
                    })

                    for (const product of result.list) {
                        expect(product.type).toBe(type)
                    }
                    return true
                }
            ),
            { numRuns: 10 }
        )
    })

    it('按状态筛选的结果应全部匹配该状态', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.constantFrom(ProductStatus.ON_SHELF, ProductStatus.OFF_SHELF),
                async (status) => {
                    const result = await getProductsForAdminService({
                        page: 1,
                        pageSize: 100,
                        status,
                    })

                    for (const product of result.list) {
                        expect(product.status).toBe(status)
                    }
                    return true
                }
            ),
            { numRuns: 10 }
        )
    })
})

/**
 * Property 3: 产品状态切换幂等性
 *
 * 连续两次切换状态应恢复原状态
 */
describe('Property 3: 产品状态切换幂等性', () => {
    const createdIds: number[] = []

    afterEach(async () => {
        if (createdIds.length > 0) {
            await prisma.products.deleteMany({
                where: { id: { in: createdIds } },
            })
            createdIds.length = 0
        }
    })

    it('连续两次切换状态应恢复原状态', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.constantFrom(ProductStatus.ON_SHELF, ProductStatus.OFF_SHELF),
                async (initialStatus) => {
                    // 创建产品
                    const product = await createProductService({
                        name: '测试产品_幂等性_' + Date.now() + '_' + Math.random(),
                        type: ProductType.POINTS,
                        pointAmount: 100,
                        unitPrice: 1,
                        status: initialStatus,
                    })
                    createdIds.push(product.id)

                    // 第一次切换
                    const toggled1 = await toggleProductStatusService(product.id)
                    expect(toggled1.status).not.toBe(initialStatus)

                    // 第二次切换
                    const toggled2 = await toggleProductStatusService(product.id)
                    expect(toggled2.status).toBe(initialStatus)

                    return true
                }
            ),
            { numRuns: 10 }
        )
    })
})

/**
 * Property 8: 分页数据完整性
 *
 * 分页查询的总数应等于所有页数据的总和
 */
describe('Property 8: 分页数据完整性（产品）', () => {
    it('分页查询的数据应完整', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 20 }),
                async (pageSize) => {
                    // 获取第一页和总数
                    const firstPage = await getProductsForAdminService({
                        page: 1,
                        pageSize,
                    })

                    const totalPages = Math.ceil(firstPage.total / pageSize)
                    let totalItems = 0

                    // 遍历所有页
                    for (let page = 1; page <= totalPages; page++) {
                        const result = await getProductsForAdminService({
                            page,
                            pageSize,
                        })
                        totalItems += result.list.length
                    }

                    // 验证总数一致
                    expect(totalItems).toBe(firstPage.total)
                    return true
                }
            ),
            { numRuns: 5 }
        )
    })
})
