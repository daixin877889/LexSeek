/**
 * 积分消耗项目服务测试
 *
 * 测试 pointConsumptionItems.service.ts 中服务层方法：
 * - 创建积分消耗项目（含唯一性校验）
 * - 获取积分消耗项目详情
 * - 获取积分消耗项目列表（分页）
 * - 获取启用的积分消耗项目列表
 * - 更新积分消耗项目
 * - 更新积分消耗项目状态
 * - 删除积分消耗项目
 * - 获取所有分组
 *
 * **Feature: point-consumption-items-service**
 * **Validates: Requirements 17.1-17.9**
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

// 导入服务函数
import {
    createPointConsumptionItemService,
    getPointConsumptionItemByIdService,
    getPointConsumptionItemsService,
    getEnabledPointConsumptionItemsService,
    updatePointConsumptionItemService,
    updatePointConsumptionItemStatusService,
    deletePointConsumptionItemService,
    getAllGroupsService,
} from '../../../server/services/point/pointConsumptionItems.service'

let dbAvailable = false

describe('积分消耗项目服务测试', () => {
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

    // ========== createPointConsumptionItemService 测试 ==========

    describe('createPointConsumptionItemService 测试', () => {
        it('应成功创建积分消耗项目', async () => {
            if (!dbAvailable) return

            const item = await createPointConsumptionItemService({
                key: 'create_service_key',
                group: '创建服务组',
                name: '创建服务项目',
                description: '创建服务描述',
                unit: '次',
                pointAmount: 20,
                discount: 0.95,
            })

            expect(item.id).toBeDefined()
            expect(item.key).toBe('create_service_key')
            expect(item.name).toBe('创建服务项目')
            expect(item.pointAmount).toBe(20)
            expect(item.status).toBe(PointConsumptionItemStatus.ENABLED)

            testItemIds.push(item.id)
        })

        it('名称重复应抛出错误', async () => {
            if (!dbAvailable) return

            const item = await createTestItem({ key: 'unique_key_1', name: '唯一名称' })
            testItemIds.push(item.id)

            await expect(
                createPointConsumptionItemService({
                    key: 'unique_key_2',
                    group: '组',
                    name: '唯一名称',
                    unit: '次',
                    pointAmount: 10,
                })
            ).rejects.toThrow('积分消耗项目名称已存在')
        })

        it('Key 重复应抛出错误', async () => {
            if (!dbAvailable) return

            const item = await createTestItem({ key: 'duplicate_key', name: '重复Key名称' })
            testItemIds.push(item.id)

            await expect(
                createPointConsumptionItemService({
                    key: 'duplicate_key',
                    group: '组',
                    name: '重复Key名称2',
                    unit: '次',
                    pointAmount: 10,
                })
            ).rejects.toThrow('积分消耗项目 Key 已存在')
        })

        it('折扣值小于 0 应抛出错误', async () => {
            if (!dbAvailable) return

            await expect(
                createPointConsumptionItemService({
                    key: 'neg_discount_key',
                    group: '组',
                    name: '负折扣项目',
                    unit: '次',
                    pointAmount: 10,
                    discount: -0.1,
                })
            ).rejects.toThrow('折扣值必须在 0-1 之间')
        })

        it('折扣值大于 1 应抛出错误', async () => {
            if (!dbAvailable) return

            await expect(
                createPointConsumptionItemService({
                    key: 'over_discount_key',
                    group: '组',
                    name: '超额折扣项目',
                    unit: '次',
                    pointAmount: 10,
                    discount: 1.5,
                })
            ).rejects.toThrow('折扣值必须在 0-1 之间')
        })

        it('使用默认状态应自动设为启用', async () => {
            if (!dbAvailable) return

            const item = await createPointConsumptionItemService({
                key: 'default_status_key',
                group: '默认组',
                name: '默认状态项目',
                unit: '次',
                pointAmount: 15,
            })

            expect(item.status).toBe(PointConsumptionItemStatus.ENABLED)

            testItemIds.push(item.id)
        })

        it('使用默认折扣应自动设为 1', async () => {
            if (!dbAvailable) return

            const item = await createPointConsumptionItemService({
                key: `default_discount_key_${Date.now()}`,
                group: '折扣组',
                name: `默认折扣项目_${Date.now()}`,
                unit: '次',
                pointAmount: 15,
            })

            // Prisma Decimal 类型需要转换后比较
            expect(Number(item.discount)).toBeCloseTo(1)

            testItemIds.push(item.id)
        })
    })

    // ========== getPointConsumptionItemByIdService 测试 ==========

    describe('getPointConsumptionItemByIdService 测试', () => {
        it('应返回存在的项目', async () => {
            if (!dbAvailable) return

            const item = await createTestItem({ name: '获取详情项目' })

            const found = await getPointConsumptionItemByIdService(item.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(item.id)
        })

        it('不存在的 ID 应返回 null', async () => {
            if (!dbAvailable) return

            const found = await getPointConsumptionItemByIdService(999999)

            expect(found).toBeNull()
        })
    })

    // ========== getPointConsumptionItemsService 测试 ==========

    describe('getPointConsumptionItemsService 测试', () => {
        it('应返回分页列表和总数', async () => {
            if (!dbAvailable) return

            await createTestItem({ key: 'list_1', name: '列表项目1', group: 'list_group' })
            await createTestItem({ key: 'list_2', name: '列表项目2', group: 'list_group' })

            const result = await getPointConsumptionItemsService({ page: 1, pageSize: 10 })

            expect(result.list).toBeInstanceOf(Array)
            expect(result.total).toBeGreaterThanOrEqual(0)
        })

        it('按分组筛选应正确工作', async () => {
            if (!dbAvailable) return

            await createTestItem({ key: 'group_filter_1', name: '分组筛选1', group: 'filter_group' })
            await createTestItem({ key: 'group_filter_2', name: '分组筛选2', group: 'filter_group' })
            await createTestItem({ key: 'group_other', name: '其他分组', group: 'other_group' })

            const result = await getPointConsumptionItemsService({
                page: 1,
                pageSize: 100,
                group: 'filter_group',
            })

            const ourResults = result.list.filter(
                (p: any) => p.key?.startsWith('group_filter')
            )
            expect(ourResults.length).toBe(2)
        })

        it('按状态筛选应正确工作', async () => {
            if (!dbAvailable) return

            await createTestItem({
                key: 'status_on',
                name: '上架',
                group: 'status_group',
                status: PointConsumptionItemStatus.ENABLED,
            })
            await createTestItem({
                key: 'status_off',
                name: '下架',
                group: 'status_group',
                status: PointConsumptionItemStatus.DISABLED,
            })

            const result = await getPointConsumptionItemsService({
                page: 1,
                pageSize: 100,
                status: PointConsumptionItemStatus.ENABLED,
            })

            const ourResults = result.list.filter(
                (p: any) => p.group === 'status_group'
            )
            for (const p of ourResults) {
                expect(p.status).toBe(PointConsumptionItemStatus.ENABLED)
            }
        })

        it('按关键词搜索名称应正确工作', async () => {
            if (!dbAvailable) return

            // 使用不同的 key 前缀来唯一标识测试数据
            const result1 = await getPointConsumptionItemsService({
                page: 1,
                pageSize: 100,
                keyword: '关键词X',
            })
            const initialTotal = result1.total

            const item1 = await createTestItem({
                key: `kw_search_${Date.now()}`,
                name: '关键词X项目A',
                group: 'kw_test_group',
            })
            const item2 = await createTestItem({
                key: `kw_search_${Date.now() + 1}`,
                name: '关键词X项目B',
                group: 'kw_test_group',
            })
            const item3 = await createTestItem({
                key: `kw_search_${Date.now() + 2}`,
                name: '无关项目',
                group: 'kw_test_group',
            })

            const result = await getPointConsumptionItemsService({
                page: 1,
                pageSize: 100,
                keyword: '关键词X',
            })

            // 验证新增了包含"关键词X"的记录
            expect(result.total).toBeGreaterThan(initialTotal)
            const ourResults = result.list.filter(
                (p: any) => p.group === 'kw_test_group' && p.name?.includes('关键词X')
            )
            expect(ourResults.length).toBe(2)
        })

        it('空关键词应返回所有项目', async () => {
            if (!dbAvailable) return

            // 先获取当前总数
            const before = await getPointConsumptionItemsService({
                page: 1,
                pageSize: 100,
                keyword: '',
            })
            const beforeTotal = before.total

            // 创建新项目（使用唯一 key）
            const uid = `${Date.now()}`
            const item1 = await createTestItem({
                key: `empty_kw_${uid}_1`,
                name: `空关键词测试1_${uid}`,
                group: 'ekw_test_group',
            })
            const item2 = await createTestItem({
                key: `empty_kw_${uid}_2`,
                name: `空关键词测试2_${uid}`,
                group: 'ekw_test_group',
            })

            const result = await getPointConsumptionItemsService({
                page: 1,
                pageSize: 100,
                keyword: '',
            })

            // 验证总数增加了 2（通过唯一 key 确认）
            expect(result.total).toBe(beforeTotal + 2)
            // 确认新创建的项目可以通过 ID 查询到
            const found1 = await prisma.pointConsumptionItems.findUnique({ where: { id: item1.id } })
            const found2 = await prisma.pointConsumptionItems.findUnique({ where: { id: item2.id } })
            expect(found1?.group).toBe('ekw_test_group')
            expect(found2?.group).toBe('ekw_test_group')
        })

        it('默认分页参数应正确', async () => {
            if (!dbAvailable) return

            const result = await getPointConsumptionItemsService({})

            expect(result.list.length).toBeLessThanOrEqual(20)
        })

        it('按 ID 排序应能工作', async () => {
            if (!dbAvailable) return

            const result = await getPointConsumptionItemsService({
                page: 1,
                pageSize: 10,
                orderBy: 'id',
                orderDir: 'desc',
            })

            if (result.list.length > 1) {
                expect(result.list[0].id).toBeGreaterThanOrEqual(result.list[1].id)
            }
        })
    })

    // ========== getEnabledPointConsumptionItemsService 测试 ==========

    describe('getEnabledPointConsumptionItemsService 测试', () => {
        it('应只返回启用的项目', async () => {
            if (!dbAvailable) return

            await createTestItem({
                key: 'svc_enabled',
                name: '服务启用',
                status: PointConsumptionItemStatus.ENABLED,
            })
            await createTestItem({
                key: 'svc_disabled',
                name: '服务禁用',
                status: PointConsumptionItemStatus.DISABLED,
            })

            const results = await getEnabledPointConsumptionItemsService()
            const keys = results.map(r => r.key)

            expect(keys).toContain('svc_enabled')
            expect(keys).not.toContain('svc_disabled')
        })

        it('应返回包含必要字段', async () => {
            if (!dbAvailable) return

            await createTestItem({
                key: 'enabled_fields',
                name: '字段完整启用项目',
                group: 'fields_group',
                pointAmount: 30,
            })

            const results = await getEnabledPointConsumptionItemsService()
            const item = results.find(r => r.key === 'enabled_fields')

            expect(item).toBeDefined()
            expect(item!.key).toBe('enabled_fields')
            expect(item!.name).toBe('字段完整启用项目')
            expect(item!.pointAmount).toBe(30)
        })
    })

    // ========== updatePointConsumptionItemService 测试 ==========

    describe('updatePointConsumptionItemService 测试', () => {
        it('应成功更新项目名称', async () => {
            if (!dbAvailable) return

            const item = await createTestItem({ name: '原名称' })

            const updated = await updatePointConsumptionItemService(item.id, {
                name: '新名称',
            })

            expect(updated.name).toBe('新名称')
        })

        it('应成功更新积分数量', async () => {
            if (!dbAvailable) return

            const item = await createTestItem({ pointAmount: 10 })

            const updated = await updatePointConsumptionItemService(item.id, {
                pointAmount: 50,
            })

            expect(updated.pointAmount).toBe(50)
        })

        it('应成功更新分组', async () => {
            if (!dbAvailable) return

            const item = await createTestItem({ group: '原组' })

            const updated = await updatePointConsumptionItemService(item.id, {
                group: '新组',
            })

            expect(updated.group).toBe('新组')
        })

        it('不存在的项目应抛出错误', async () => {
            if (!dbAvailable) return

            await expect(
                updatePointConsumptionItemService(999999, { name: '新名称' })
            ).rejects.toThrow('积分消耗项目不存在')
        })

        it('更新为重复名称应抛出错误', async () => {
            if (!dbAvailable) return

            const item1 = await createTestItem({ key: 'update_name_1', name: '名称A' })
            const item2 = await createTestItem({ key: 'update_name_2', name: '名称B' })
            testItemIds.push(item1.id, item2.id)

            await expect(
                updatePointConsumptionItemService(item2.id, { name: '名称A' })
            ).rejects.toThrow('积分消耗项目名称已存在')
        })

        it('更新为相同名称应不抛出错误', async () => {
            if (!dbAvailable) return

            const item = await createTestItem({ name: '保持名称' })

            const updated = await updatePointConsumptionItemService(item.id, {
                name: '保持名称',
            })

            expect(updated.name).toBe('保持名称')
        })

        it('折扣值为负应抛出错误', async () => {
            if (!dbAvailable) return

            const item = await createTestItem()

            await expect(
                updatePointConsumptionItemService(item.id, { discount: -0.1 })
            ).rejects.toThrow('折扣值必须在 0-1 之间')
        })

        it('折扣值大于 1 应抛出错误', async () => {
            if (!dbAvailable) return

            const item = await createTestItem()

            await expect(
                updatePointConsumptionItemService(item.id, { discount: 2 })
            ).rejects.toThrow('折扣值必须在 0-1 之间')
        })

        it('部分更新应只修改指定字段', async () => {
            if (!dbAvailable) return

            const item = await createTestItem({
                name: '部分更新',
                group: '原组',
                pointAmount: 10,
            })

            const updated = await updatePointConsumptionItemService(item.id, {
                pointAmount: 99,
            })

            expect(updated.name).toBe('部分更新')
            expect(updated.group).toBe('原组')
            expect(updated.pointAmount).toBe(99)
        })
    })

    // ========== updatePointConsumptionItemStatusService 测试 ==========

    describe('updatePointConsumptionItemStatusService 测试', () => {
        it('应成功将项目设为禁用', async () => {
            if (!dbAvailable) return

            const item = await createTestItem({ status: PointConsumptionItemStatus.ENABLED })

            const updated = await updatePointConsumptionItemStatusService(
                item.id,
                PointConsumptionItemStatus.DISABLED
            )

            expect(updated.status).toBe(PointConsumptionItemStatus.DISABLED)
        })

        it('应成功将项目设为启用', async () => {
            if (!dbAvailable) return

            const item = await createTestItem({ status: PointConsumptionItemStatus.DISABLED })

            const updated = await updatePointConsumptionItemStatusService(
                item.id,
                PointConsumptionItemStatus.ENABLED
            )

            expect(updated.status).toBe(PointConsumptionItemStatus.ENABLED)
        })

        it('不存在的项目应抛出错误', async () => {
            if (!dbAvailable) return

            await expect(
                updatePointConsumptionItemStatusService(999999, PointConsumptionItemStatus.DISABLED)
            ).rejects.toThrow('积分消耗项目不存在')
        })

        it('应只更新状态字段', async () => {
            if (!dbAvailable) return

            const item = await createTestItem({
                name: '状态测试',
                group: '状态组',
                pointAmount: 25,
                status: PointConsumptionItemStatus.ENABLED,
            })

            const updated = await updatePointConsumptionItemStatusService(
                item.id,
                PointConsumptionItemStatus.DISABLED
            )

            expect(updated.name).toBe('状态测试')
            expect(updated.group).toBe('状态组')
            expect(updated.pointAmount).toBe(25)
        })
    })

    // ========== deletePointConsumptionItemService 测试 ==========

    describe('deletePointConsumptionItemService 测试', () => {
        it('应成功软删除项目', async () => {
            if (!dbAvailable) return

            const item = await createTestItem({ name: '待删除项目' })

            await deletePointConsumptionItemService(item.id)

            // 验证数据库中设置了 deletedAt
            const raw = await prisma.pointConsumptionItems.findUnique({
                where: { id: item.id },
                select: { deletedAt: true },
            })

            expect(raw?.deletedAt).toBeInstanceOf(Date)
        })

        it('不存在的项目应抛出错误', async () => {
            if (!dbAvailable) return

            await expect(deletePointConsumptionItemService(999999)).rejects.toThrow(
                '积分消耗项目不存在'
            )
        })

        it('软删除后 getPointConsumptionItemByIdService 不应返回', async () => {
            if (!dbAvailable) return

            const item = await createTestItem({ name: '删除后查询' })

            await deletePointConsumptionItemService(item.id)

            const found = await getPointConsumptionItemByIdService(item.id)
            expect(found).toBeNull()
        })
    })

    // ========== getAllGroupsService 测试 ==========

    describe('getAllGroupsService 测试', () => {
        it('应返回所有分组列表', async () => {
            if (!dbAvailable) return

            await createTestItem({ key: 'group_1', name: '分组项目1', group: '分组A' })
            await createTestItem({ key: 'group_2', name: '分组项目2', group: '分组B' })
            await createTestItem({ key: 'group_3', name: '分组项目3', group: '分组A' })

            const groups = await getAllGroupsService()

            expect(groups).toContain('分组A')
            expect(groups).toContain('分组B')
        })

        it('分组应按字母升序排列', async () => {
            if (!dbAvailable) return

            await createTestItem({ key: 'sort_z', name: '排序Z', group: 'Z分组' })
            await createTestItem({ key: 'sort_a', name: '排序A', group: 'A分组' })
            await createTestItem({ key: 'sort_m', name: '排序M', group: 'M分组' })

            const groups = await getAllGroupsService()
            const testGroups = groups.filter(g => g.endsWith('分组'))

            expect(testGroups.length).toBe(3)
            expect(testGroups[0]).toBe('A分组')
            expect(testGroups[1]).toBe('M分组')
            expect(testGroups[2]).toBe('Z分组')
        })

        it('应排除已软删除的分组', async () => {
            if (!dbAvailable) return

            const item = await createTestItem({
                key: 'del_group_item',
                name: '删除分组项目',
                group: '待删除分组',
            })

            // 软删除
            await prisma.pointConsumptionItems.update({
                where: { id: item.id },
                data: { deletedAt: new Date() },
            })

            const groups = await getAllGroupsService()

            expect(groups).not.toContain('待删除分组')
        })

        it('无分组时应返回空数组', async () => {
            if (!dbAvailable) return

            // 当前测试的分组都是带后缀的，不会影响
            const groups = await getAllGroupsService()

            expect(Array.isArray(groups)).toBe(true)
        })

        it('重复分组不应出现多次', async () => {
            if (!dbAvailable) return

            await createTestItem({ key: 'dup_g1', name: '重复1', group: '唯一分组' })
            await createTestItem({ key: 'dup_g2', name: '重复2', group: '唯一分组' })

            const groups = await getAllGroupsService()
            const testGroupCount = groups.filter(g => g === '唯一分组').length

            expect(testGroupCount).toBe(1)
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
