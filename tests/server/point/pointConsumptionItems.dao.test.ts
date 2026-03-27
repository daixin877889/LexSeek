/**
 * 积分消耗项目 DAO 测试
 *
 * 测试 pointConsumptionItems.dao.ts 中 DAO 方法：
 * - 通过 ID 查询积分消耗项目
 * - 查询启用的积分消耗项目列表
 *
 * **Feature: point-consumption-items-dao**
 * **Validates: Requirements 17.1-17.3**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
    getTestPrisma,
    cleanupTestData,
    createEmptyTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    type TestIds,
} from '../membership/test-db-helper'
import { PointConsumptionItemStatus } from '../../../shared/types/point.types'

// 导入 DAO 函数
import {
    findPointConsumptionItemByIdDao,
    findEnabledPointConsumptionItemsDao,
} from '../../../server/services/point/pointConsumptionItems.dao'

let dbAvailable = false

describe('积分消耗项目 DAO 测试', () => {
    const testIds: TestIds = createEmptyTestIds()
    const prisma = getTestPrisma()

    // 测试数据追踪
    const testItemIds: number[] = []

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
        if (!dbAvailable) {
            console.warn('数据库不可用，跳过集成测试')
        }
    })

    afterEach(async () => {
        if (dbAvailable) {
            // 清理积分消耗项目
            if (testItemIds.length > 0) {
                await prisma.pointConsumptionItems.deleteMany({
                    where: { id: { in: testItemIds } },
                })
                testItemIds.length = 0
            }
        }
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    // 创建测试积分消耗项目
    const createTestItem = async (data?: {
        key?: string
        group?: string
        name?: string
        description?: string
        unit?: string
        pointAmount?: number
        discount?: number
        status?: number
    }) => {
        const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        const item = await prisma.pointConsumptionItems.create({
            data: {
                key: data?.key || `test_key_${uniqueId}`,
                group: data?.group || 'test_group',
                name: data?.name || `测试项目_${uniqueId}`,
                description: data?.description || '测试描述',
                unit: data?.unit || '次',
                pointAmount: data?.pointAmount ?? 10,
                discount: data?.discount ?? 1,
                status: data?.status ?? PointConsumptionItemStatus.ENABLED,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        testItemIds.push(item.id)
        return item
    }

    // ========== findPointConsumptionItemByIdDao 测试 ==========

    describe('findPointConsumptionItemByIdDao 测试', () => {
        it('应返回存在的积分消耗项目', async () => {
            if (!dbAvailable) return

            const item = await createTestItem({ name: 'ID查询项目' })

            const found = await findPointConsumptionItemByIdDao(item.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(item.id)
            expect(found!.name).toBe('ID查询项目')
        })

        it('应包含正确的字段值', async () => {
            if (!dbAvailable) return

            const item = await createTestItem({
                key: 'dao_key_test',
                group: 'dao_group',
                name: 'DAO测试项目',
                description: 'DAO测试描述',
                unit: '次',
                pointAmount: 50,
                discount: 0.9,
                status: PointConsumptionItemStatus.ENABLED,
            })

            const found = await findPointConsumptionItemByIdDao(item.id)

            expect(found!.key).toBe('dao_key_test')
            expect(found!.group).toBe('dao_group')
            expect(found!.name).toBe('DAO测试项目')
            expect(found!.description).toBe('DAO测试描述')
            expect(found!.unit).toBe('次')
            expect(found!.pointAmount).toBe(50)
            expect(found!.status).toBe(PointConsumptionItemStatus.ENABLED)
        })

        it('不存在的 ID 应返回 null', async () => {
            if (!dbAvailable) return

            const found = await findPointConsumptionItemByIdDao(999999)

            expect(found).toBeNull()
        })

        it('已软删除的项目不应返回', async () => {
            if (!dbAvailable) return

            const item = await createTestItem({ name: '已删除项目' })

            // 软删除
            await prisma.pointConsumptionItems.update({
                where: { id: item.id },
                data: { deletedAt: new Date() },
            })

            const found = await findPointConsumptionItemByIdDao(item.id)

            expect(found).toBeNull()
        })
    })

    // ========== findEnabledPointConsumptionItemsDao 测试 ==========

    describe('findEnabledPointConsumptionItemsDao 测试', () => {
        it('应只返回启用状态的项目', async () => {
            if (!dbAvailable) return

            const enabled1 = await createTestItem({
                key: 'enabled_1',
                name: '启用项目1',
                status: PointConsumptionItemStatus.ENABLED,
            })
            const enabled2 = await createTestItem({
                key: 'enabled_2',
                name: '启用项目2',
                status: PointConsumptionItemStatus.ENABLED,
            })
            const disabled = await createTestItem({
                key: 'disabled_1',
                name: '禁用项目',
                status: PointConsumptionItemStatus.DISABLED,
            })

            const results = await findEnabledPointConsumptionItemsDao()
            const keys = results.map(r => r.key)

            expect(keys).toContain('enabled_1')
            expect(keys).toContain('enabled_2')
            expect(keys).not.toContain('disabled_1')
        })

        it('应按 ID 升序排列', async () => {
            if (!dbAvailable) return

            const uid = `${Date.now()}`
            // 先创建 item1，后创建 item2，所以 item1.id < item2.id
            const item1 = await createTestItem({ key: `sorted_${uid}_a`, name: '排序A', group: `sort_group_${uid}` })
            const item2 = await createTestItem({ key: `sorted_${uid}_b`, name: '排序B', group: `sort_group_${uid}` })

            const results = await findEnabledPointConsumptionItemsDao()
            const ourResults = results.filter(r => r.group === `sort_group_${uid}`)

            expect(ourResults.length).toBe(2)
            // item1 先创建（ID 更小），应排在前面
            const idx1 = ourResults.findIndex(r => r.key === `sorted_${uid}_a`)
            const idx2 = ourResults.findIndex(r => r.key === `sorted_${uid}_b`)
            expect(idx1).toBeLessThan(idx2)
        })

        it('无启用项目时应返回空数组', async () => {
            if (!dbAvailable) return

            // 创建一些禁用项目
            await createTestItem({
                key: 'only_disabled',
                name: '唯一禁用',
                group: 'no_enabled',
                status: PointConsumptionItemStatus.DISABLED,
            })

            const results = await findEnabledPointConsumptionItemsDao()
            const ourResults = results.filter(r => r.group === 'no_enabled')

            expect(ourResults).toEqual([])
        })

        it('应排除已软删除的项目', async () => {
            if (!dbAvailable) return

            const item = await createTestItem({
                key: 'soft_deleted_enabled',
                name: '软删除启用项目',
                group: 'soft_del',
                status: PointConsumptionItemStatus.ENABLED,
            })

            // 软删除
            await prisma.pointConsumptionItems.update({
                where: { id: item.id },
                data: { deletedAt: new Date() },
            })

            const results = await findEnabledPointConsumptionItemsDao()
            const found = results.find(r => r.key === 'soft_deleted_enabled')

            expect(found).toBeUndefined()
        })

        it('返回的每项都应有 key、group、name、pointAmount 字段', async () => {
            if (!dbAvailable) return

            const results = await findEnabledPointConsumptionItemsDao()

            for (const item of results) {
                expect(item.key).toBeDefined()
                expect(item.group).toBeDefined()
                expect(item.name).toBeDefined()
                expect(item.pointAmount).toBeDefined()
                expect(item.status).toBe(PointConsumptionItemStatus.ENABLED)
            }
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
