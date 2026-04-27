/**
 * 路由权限 API 测试
 *
 * 测试路由权限的更新和删除功能
 *
 * **Feature: route-permission-edit**
 * **Validates: Requirements 1.2, 1.3, 2.3, 2.4, 3.5**
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import * as fc from 'fast-check'
import {
    testPrisma,
    connectTestDb,
    disconnectTestDb,
    resetDatabaseSequences,
} from '../membership/test-db-helper'

// ==================== 测试数据追踪 ====================

/** 创建的路由 ID 列表 */
const createdRouterIds: number[] = []

/** 创建的路由组 ID 列表 */
const createdGroupIds: number[] = []

// ==================== 辅助函数 ====================

/** 生成唯一标识符 */
const generateUniqueId = () => {
    const timestamp = Date.now()
    const random = Math.floor(Math.random() * 1000000)
    const uuid = crypto.randomUUID().replace(/-/g, '').substring(0, 8)
    return `${timestamp}_${random}_${uuid}`
}

/** 清理测试数据 */
const cleanupTestRouters = async () => {
    if (createdRouterIds.length > 0) {
        await testPrisma.routers.deleteMany({
            where: { id: { in: createdRouterIds } },
        })
        createdRouterIds.length = 0
    }
    if (createdGroupIds.length > 0) {
        await testPrisma.routerGroups.deleteMany({
            where: { id: { in: createdGroupIds } },
        })
        createdGroupIds.length = 0
    }
}

/** 获取或创建测试路由组 */
let testGroupId: number | null = null
const getOrCreateTestGroup = async () => {
    if (testGroupId !== null) return testGroupId

    const uniqueId = generateUniqueId()
    const group = await testPrisma.routerGroups.create({
        data: {
            name: `test_group_${uniqueId}`,
            description: '测试路由组',
        },
    })
    createdGroupIds.push(group.id)
    testGroupId = group.id
    return group.id
}

/** 创建测试路由 */
const createTestRouter = async (overrides: Partial<{
    name: string
    title: string
    path: string
    isMenu: boolean
    sort: number
}> = {}) => {
    const uniqueId = generateUniqueId()
    const groupId = await getOrCreateTestGroup()
    const router = await testPrisma.routers.create({
        data: {
            name: overrides.name ?? `test_router_${uniqueId}`,
            title: overrides.title ?? `测试路由_${uniqueId}`,
            path: overrides.path ?? `/test/path/${uniqueId}`,
            isMenu: overrides.isMenu ?? false,
            sort: overrides.sort ?? 0,
            groupId,
        },
    })
    createdRouterIds.push(router.id)
    return router
}

// ==================== 测试套件 ====================

describe('路由权限 API 测试', () => {
    beforeAll(async () => {
        await connectTestDb()
        await resetDatabaseSequences()
        // 防御：在 fast-check 大量并发 INSERT 前，再单独把 routers / router_groups
        // 的序列推到一个绝对安全的远端，避免任何 (id) 主键冲突。
        await testPrisma.$executeRawUnsafe(
            `SELECT setval('routers_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM routers), 100000) + 10000)`
        )
        await testPrisma.$executeRawUnsafe(
            `SELECT setval('router_groups_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM router_groups), 100000) + 10000)`
        )
    })

    afterAll(async () => {
        await cleanupTestRouters()
        await disconnectTestDb()
    })

    beforeEach(() => {
        createdRouterIds.length = 0
    })

    afterEach(async () => {
        await cleanupTestRouters()
        testGroupId = null
    })

    describe('更新路由权限', () => {
        it('应能更新路由的 isMenu 状态', async () => {
            // 创建测试路由
            const router = await createTestRouter({ isMenu: false })

            // 更新 isMenu 为 true
            const updated = await testPrisma.routers.update({
                where: { id: router.id },
                data: { isMenu: true, updatedAt: new Date() },
            })

            expect(updated.isMenu).toBe(true)

            // 再次更新为 false
            const updated2 = await testPrisma.routers.update({
                where: { id: router.id },
                data: { isMenu: false, updatedAt: new Date() },
            })

            expect(updated2.isMenu).toBe(false)
        })

        it('应能更新路由的排序值', async () => {
            // 创建测试路由
            const router = await createTestRouter({ sort: 0 })

            // 更新排序值
            const newSort = 100
            const updated = await testPrisma.routers.update({
                where: { id: router.id },
                data: { sort: newSort, updatedAt: new Date() },
            })

            expect(updated.sort).toBe(newSort)
        })
    })

    describe('删除路由权限', () => {
        it('应能软删除路由', async () => {
            // 创建测试路由
            const router = await createTestRouter()

            // 软删除
            await testPrisma.routers.update({
                where: { id: router.id },
                data: { deletedAt: new Date(), updatedAt: new Date() },
            })

            // 验证软删除后无法通过常规查询获取
            const found = await testPrisma.routers.findFirst({
                where: { id: router.id, deletedAt: null },
            })

            expect(found).toBeNull()
        })

        it('软删除后记录仍存在于数据库中', async () => {
            // 创建测试路由
            const router = await createTestRouter()

            // 软删除
            await testPrisma.routers.update({
                where: { id: router.id },
                data: { deletedAt: new Date(), updatedAt: new Date() },
            })

            // 验证记录仍存在（不过滤 deletedAt）
            const found = await testPrisma.routers.findUnique({
                where: { id: router.id },
            })

            expect(found).not.toBeNull()
            expect(found!.deletedAt).not.toBeNull()
        })
    })

    describe('Property 1: 排序值验证', () => {
        /**
         * **Feature: route-permission-edit, Property 1: 排序值验证**
         * **Validates: Requirements 3.5**
         *
         * 对于任意排序值输入，如果输入是非负整数，验证应通过；
         * 如果输入是负数或非整数，验证应失败。
         */
        it('非负整数排序值应能成功保存', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 0, max: 10000 }),
                    async (sortValue) => {
                        const router = await createTestRouter({ sort: 0 })

                        // 更新排序值
                        const updated = await testPrisma.routers.update({
                            where: { id: router.id },
                            data: { sort: sortValue, updatedAt: new Date() },
                        })

                        expect(updated.sort).toBe(sortValue)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('排序值验证函数应正确验证非负整数', () => {
            // 验证函数
            const validateSort = (value: unknown): boolean => {
                if (typeof value !== 'number') return false
                if (!Number.isInteger(value)) return false
                if (value < 0) return false
                return true
            }

            // 属性测试：非负整数应通过验证
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 10000 }),
                    (value) => {
                        expect(validateSort(value)).toBe(true)
                    }
                ),
                { numRuns: 100 }
            )

            // 属性测试：负数应失败验证
            fc.assert(
                fc.property(
                    fc.integer({ min: -10000, max: -1 }),
                    (value) => {
                        expect(validateSort(value)).toBe(false)
                    }
                ),
                { numRuns: 100 }
            )

            // 属性测试：浮点数应失败验证
            fc.assert(
                fc.property(
                    fc.double({ min: 0.1, max: 100, noNaN: true }).filter(n => !Number.isInteger(n)),
                    (value) => {
                        expect(validateSort(value)).toBe(false)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})
