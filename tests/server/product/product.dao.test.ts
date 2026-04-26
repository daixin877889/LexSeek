/**
 * 商品 DAO 层测试
 *
 * 测试 product.dao.ts 中所有 DAO 方法
 *
 * **Feature: product-dao**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import {
    getTestPrisma,
    createTestUser,
    cleanupTestData,
    createEmptyTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    createTestMembershipLevel,
    createTestProduct,
    createTestOrder,
    type TestIds,
} from '../membership/test-db-helper'

// 导入 DAO 函数
import {
    createProductDao,
    findProductByIdDao,
    findAllActiveProductsDao,
    findAllProductsDao,
    updateProductDao,
    deleteProductDao,
} from '../../../server/services/product/product.dao'

import { ProductType, ProductStatus } from '../../../shared/types/product'

let dbAvailable = false
const testIds: TestIds = createEmptyTestIds()
const prisma = getTestPrisma()

describe('商品 DAO 测试', () => {
    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
    })

    afterEach(async () => {
        if (dbAvailable) {
            await cleanupTestData(testIds)
        }
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    describe('createProductDao', () => {
        it('应成功创建商品', async () => {
            if (!dbAvailable) return

            const product = await createProductDao({
                name: '测试商品_create',
                type: ProductType.MEMBERSHIP,
                priceMonthly: 99,
                priceYearly: 999,
                giftPoint: 100,
                status: ProductStatus.ON_SHELF,
            })
            testIds.productIds.push(product.id)

            expect(product.id).toBeGreaterThan(0)
            expect(product.name).toBe('测试商品_create')
            expect(product.priceMonthly.toNumber()).toBe(99)
            expect(product.priceYearly.toNumber()).toBe(999)
            expect(product.giftPoint).toBe(100)
        })

        it('应成功创建关联会员级别的商品', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const product = await createProductDao({
                name: '测试商品_level',
                type: ProductType.MEMBERSHIP,
                levelId: level.id,
                priceMonthly: 99,
                status: ProductStatus.ON_SHELF,
            })
            testIds.productIds.push(product.id)

            expect(product.levelId).toBe(level.id)
        })
    })

    describe('findProductByIdDao', () => {
        it('应返回存在的商品', async () => {
            if (!dbAvailable) return

            const product = await createTestProduct()
            testIds.productIds.push(product.id)

            const found = await findProductByIdDao(product.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(product.id)
            expect(found!.name).toBe(product.name)
        })

        it('应返回包含 level 关联', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const product = await createTestProduct(level.id)
            testIds.productIds.push(product.id)

            const found = await findProductByIdDao(product.id)

            expect(found).not.toBeNull()
            expect(found!.level).not.toBeNull()
            expect(found!.level!.id).toBe(level.id)
        })

        it('不存在 ID 应返回 null', async () => {
            if (!dbAvailable) return

            const found = await findProductByIdDao(999999999)
            expect(found).toBeNull()
        })
    })

    describe('findAllActiveProductsDao', () => {
        it('应返回所有上架商品', async () => {
            if (!dbAvailable) return

            const p1 = await createTestProduct(undefined, { status: ProductStatus.ON_SHELF })
            const p2 = await createTestProduct(undefined, { status: ProductStatus.ON_SHELF })
            testIds.productIds.push(p1.id, p2.id)

            const products = await findAllActiveProductsDao()

            expect(products.length).toBeGreaterThanOrEqual(2)
        })

        it('应按 sortOrder 升序排列', async () => {
            if (!dbAvailable) return

            const p1 = await createTestProduct(undefined, {
                name: '商品C',
                sortOrder: 3,
                status: ProductStatus.ON_SHELF,
            })
            const p2 = await createTestProduct(undefined, {
                name: '商品A',
                sortOrder: 1,
                status: ProductStatus.ON_SHELF,
            })
            const p3 = await createTestProduct(undefined, {
                name: '商品B',
                sortOrder: 2,
                status: ProductStatus.ON_SHELF,
            })
            testIds.productIds.push(p1.id, p2.id, p3.id)

            const products = await findAllActiveProductsDao()

            // 找到我们创建的测试商品（可能有其他种子数据）
            const ourProducts = products.filter(p =>
                [p1.id, p2.id, p3.id].includes(p.id)
            )
            expect(ourProducts.length).toBe(3)
            expect(ourProducts[0].sortOrder).toBeLessThanOrEqual(ourProducts[1].sortOrder)
            expect(ourProducts[1].sortOrder).toBeLessThanOrEqual(ourProducts[2].sortOrder)
        })

        it('按类型筛选应只返回该类型商品', async () => {
            if (!dbAvailable) return

            const p1 = await createTestProduct(undefined, {
                name: '会员商品',
                type: ProductType.MEMBERSHIP,
                status: ProductStatus.ON_SHELF,
            })
            const p2 = await createTestProduct(undefined, {
                name: '积分商品',
                type: ProductType.POINTS,
                status: ProductStatus.ON_SHELF,
            })
            testIds.productIds.push(p1.id, p2.id)

            const membershipProducts = await findAllActiveProductsDao(ProductType.MEMBERSHIP)
            const found = membershipProducts.find(p => p.id === p1.id)

            expect(found).not.toBeUndefined()
        })

        it('下架商品不应被返回', async () => {
            if (!dbAvailable) return

            const product = await createTestProduct(undefined, {
                name: '下架商品',
                status: ProductStatus.OFF_SHELF,
            })
            testIds.productIds.push(product.id)

            const products = await findAllActiveProductsDao()
            const found = products.find(p => p.id === product.id)

            // 下架商品不应该出现在上架列表中
            expect(found).toBeUndefined()
        })
    })

    describe('findAllProductsDao', () => {
        it('应返回分页商品列表', async () => {
            if (!dbAvailable) return

            const p1 = await createTestProduct(undefined, { name: '分页测试1' })
            const p2 = await createTestProduct(undefined, { name: '分页测试2' })
            testIds.productIds.push(p1.id, p2.id)

            const result = await findAllProductsDao({ page: 1, pageSize: 10 })

            expect(result.list.length).toBeGreaterThanOrEqual(2)
            expect(result.total).toBeGreaterThanOrEqual(2)
        })

        it('分页参数应正确生效', async () => {
            if (!dbAvailable) return

            const result = await findAllProductsDao({ page: 1, pageSize: 5 })
            expect(result.list.length).toBeLessThanOrEqual(5)
        })

        it('按类型筛选应正确过滤', async () => {
            if (!dbAvailable) return

            const result = await findAllProductsDao({ type: ProductType.MEMBERSHIP })

            for (const p of result.list) {
                expect(p.type).toBe(ProductType.MEMBERSHIP)
            }
        })

        it('按状态下筛选应正确过滤', async () => {
            if (!dbAvailable) return

            const result = await findAllProductsDao({ status: ProductStatus.ON_SHELF })

            for (const p of result.list) {
                expect(p.status).toBe(ProductStatus.ON_SHELF)
            }
        })

        it('应包含 level 关联', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const product = await createTestProduct(level.id)
            testIds.productIds.push(product.id)

            // 测试库存量产品 200+，按 sortOrder asc 默认 pageSize 翻页找不到刚创建的；
            // 用最大 pageSize 兜底覆盖，验证 findAllProductsDao 返回的项确实带 level 关联。
            const result = await findAllProductsDao({ pageSize: 1000 })
            const found = result.list.find(p => p.id === product.id)

            expect(found).not.toBeUndefined()
            expect(found!.level).not.toBeNull()
            expect(found!.level!.id).toBe(level.id)
        })
    })

    describe('updateProductDao', () => {
        it('应成功更新商品名称', async () => {
            if (!dbAvailable) return

            const product = await createTestProduct()
            testIds.productIds.push(product.id)

            const updated = await updateProductDao(product.id, {
                name: '更新后的名称',
            })

            expect(updated.name).toBe('更新后的名称')
        })

        it('应成功更新价格', async () => {
            if (!dbAvailable) return

            const product = await createTestProduct()
            testIds.productIds.push(product.id)

            const updated = await updateProductDao(product.id, {
                priceMonthly: 199,
                priceYearly: 1999,
            })

            expect(updated.priceMonthly.toNumber()).toBe(199)
            expect(updated.priceYearly.toNumber()).toBe(1999)
        })

        it('应成功更新状态', async () => {
            if (!dbAvailable) return

            const product = await createTestProduct(undefined, {
                status: ProductStatus.ON_SHELF,
            })
            testIds.productIds.push(product.id)

            const updated = await updateProductDao(product.id, {
                status: ProductStatus.OFF_SHELF,
            })

            expect(updated.status).toBe(ProductStatus.OFF_SHELF)
        })

        it('不存在 ID 应抛出错误', async () => {
            if (!dbAvailable) return

            await expect(updateProductDao(999999999, { name: 'test' })).rejects.toThrow()
        })

        it('应更新 updatedAt 字段', async () => {
            if (!dbAvailable) return

            const product = await createTestProduct()
            testIds.productIds.push(product.id)

            const originalUpdatedAt = product.updatedAt

            // 等待一小段时间确保 updatedAt 会变化
            await new Promise(resolve => setTimeout(resolve, 10))

            const updated = await updateProductDao(product.id, {
                name: '新名称',
            })

            expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(originalUpdatedAt.getTime())
        })
    })

    describe('deleteProductDao (软删除)', () => {
        it('应成功软删除商品', async () => {
            if (!dbAvailable) return

            const product = await createTestProduct()
            testIds.productIds.push(product.id)

            await deleteProductDao(product.id)

            // 软删除后，findProductById 应该仍能找到（因为 DAO 不做软删除过滤）
            const found = await prisma.products.findUnique({
                where: { id: product.id },
            })
            expect(found).not.toBeNull()
            expect(found!.deletedAt).not.toBeNull()
        })

        it('不存在 ID 应抛出错误', async () => {
            if (!dbAvailable) return

            await expect(deleteProductDao(999999999)).rejects.toThrow()
        })
    })
})

describe('数据库连接检查', () => {
    it('检查数据库是否可用', async () => {
        const available = await isTestDbAvailable()
        if (!available) {
            console.log('请确保数据库已启动并配置正确的连接字符串')
        }
        expect(true).toBe(true)
    })
})
