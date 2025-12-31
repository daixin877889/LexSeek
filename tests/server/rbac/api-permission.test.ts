/**
 * API 权限 DAO 属性测试
 *
 * 使用 fast-check 进行属性测试，验证 API 权限的 CRUD 完整性
 *
 * **Feature: rbac-enhancement**
 * **Property 1: API 权限 CRUD 完整性**
 * **Validates: Requirements 1.2, 1.3**
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import * as fc from 'fast-check'
import {
    testPrisma,
    connectTestDb,
    disconnectTestDb,
    resetDatabaseSequences,
} from '../membership/test-db-helper'

// 导入 API 权限 DAO 函数
import {
    createApiPermissionDao,
    findApiPermissionByIdDao,
    findApiPermissionByPathMethodDao,
    findPublicApiPermissionsDao,
    updateApiPermissionDao,
    deleteApiPermissionDao,
    checkApiPermissionExistsDao,
    updateApiPermissionsPublicStatusDao,
} from '../../../server/services/rbac/apiPermission.dao'

// ==================== 测试数据追踪 ====================

/** 创建的 API 权限 ID 列表 */
const createdApiPermissionIds: number[] = []

/** 创建的 API 权限分组 ID 列表 */
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
const cleanupTestApiPermissions = async () => {
    if (createdApiPermissionIds.length > 0) {
        await testPrisma.apiPermissions.deleteMany({
            where: { id: { in: createdApiPermissionIds } },
        })
        createdApiPermissionIds.length = 0
    }
    if (createdGroupIds.length > 0) {
        await testPrisma.apiPermissionGroups.deleteMany({
            where: { id: { in: createdGroupIds } },
        })
        createdGroupIds.length = 0
    }
}

// ==================== 生成器 ====================

/** HTTP 方法生成器 */
const httpMethodArb = fc.constantFrom('GET', 'POST', 'PUT', 'DELETE', 'PATCH')

/** API 路径生成器 - 生成合法的 API 路径 */
const apiPathArb = fc.tuple(
    fc.constantFrom('users', 'roles', 'permissions', 'orders', 'products', 'files'),
    fc.option(fc.integer({ min: 1, max: 9999 }), { nil: undefined })
).map(([resource, id]) => {
    const uniqueId = generateUniqueId()
    return id !== undefined
        ? `/api/v1/test/${resource}/${uniqueId}/${id}`
        : `/api/v1/test/${resource}/${uniqueId}`
})

/** API 权限名称生成器 */
const permissionNameArb = fc.string({ minLength: 1, maxLength: 50 })
    .filter(s => s.trim().length > 0)
    .map(s => `测试权限_${s.trim().substring(0, 30)}_${generateUniqueId()}`)

/** API 权限描述生成器 */
const permissionDescArb = fc.option(
    fc.string({ minLength: 0, maxLength: 100 }).map(s => s.trim() || null),
    { nil: null }
)

/** API 权限输入生成器 */
const apiPermissionInputArb = fc.record({
    path: apiPathArb,
    method: httpMethodArb,
    name: permissionNameArb,
    description: permissionDescArb,
    isPublic: fc.boolean(),
})

// ==================== 测试套件 ====================

describe('API 权限 DAO 属性测试', () => {
    beforeAll(async () => {
        await connectTestDb()
        await resetDatabaseSequences()
        // 重置 api_permissions 表的序列
        await testPrisma.$executeRaw`SELECT setval('api_permissions_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM api_permissions), 1000))`
    })

    afterAll(async () => {
        await cleanupTestApiPermissions()
        await disconnectTestDb()
    })

    beforeEach(() => {
        createdApiPermissionIds.length = 0
        createdGroupIds.length = 0
    })

    afterEach(async () => {
        await cleanupTestApiPermissions()
    })

    describe('Property 1: API 权限 CRUD 完整性', () => {
        it('创建的 API 权限应能被正确读取', async () => {
            await fc.assert(
                fc.asyncProperty(apiPermissionInputArb, async (input) => {
                    // 创建 API 权限
                    const created = await createApiPermissionDao(input)
                    createdApiPermissionIds.push(created.id)

                    // 通过 ID 读取
                    const foundById = await findApiPermissionByIdDao(created.id)
                    expect(foundById).not.toBeNull()
                    expect(foundById!.path).toBe(input.path)
                    expect(foundById!.method).toBe(input.method)
                    expect(foundById!.name).toBe(input.name)
                    expect(foundById!.isPublic).toBe(input.isPublic)

                    // 通过路径和方法读取
                    const foundByPathMethod = await findApiPermissionByPathMethodDao(input.path, input.method)
                    expect(foundByPathMethod).not.toBeNull()
                    expect(foundByPathMethod!.id).toBe(created.id)
                }),
                { numRuns: 3 }
            )
        })

        it('更新 API 权限后应反映新值', async () => {
            await fc.assert(
                fc.asyncProperty(
                    apiPermissionInputArb,
                    fc.record({
                        name: permissionNameArb,
                        description: permissionDescArb,
                        isPublic: fc.boolean(),
                    }),
                    async (input, updateData) => {
                        // 创建 API 权限
                        const created = await createApiPermissionDao(input)
                        createdApiPermissionIds.push(created.id)

                        // 更新
                        const updated = await updateApiPermissionDao(created.id, updateData)
                        expect(updated.name).toBe(updateData.name)
                        expect(updated.isPublic).toBe(updateData.isPublic)

                        // 验证更新后的值
                        const found = await findApiPermissionByIdDao(created.id)
                        expect(found).not.toBeNull()
                        expect(found!.name).toBe(updateData.name)
                        expect(found!.isPublic).toBe(updateData.isPublic)
                    }
                ),
                { numRuns: 3 }
            )
        })

        it('软删除后应不可通过常规查询获取', async () => {
            await fc.assert(
                fc.asyncProperty(apiPermissionInputArb, async (input) => {
                    // 创建 API 权限
                    const created = await createApiPermissionDao(input)
                    createdApiPermissionIds.push(created.id)

                    // 验证可以查询到
                    const beforeDelete = await findApiPermissionByIdDao(created.id)
                    expect(beforeDelete).not.toBeNull()

                    // 软删除
                    await deleteApiPermissionDao(created.id)

                    // 验证无法通过常规查询获取
                    const afterDelete = await findApiPermissionByIdDao(created.id)
                    expect(afterDelete).toBeNull()

                    // 验证通过路径方法也无法查询
                    const byPathMethod = await findApiPermissionByPathMethodDao(input.path, input.method)
                    expect(byPathMethod).toBeNull()
                }),
                { numRuns: 3 }
            )
        })

        it('相同路径和方法的 API 权限不能重复创建', async () => {
            await fc.assert(
                fc.asyncProperty(apiPermissionInputArb, async (input) => {
                    // 创建第一个 API 权限
                    const first = await createApiPermissionDao(input)
                    createdApiPermissionIds.push(first.id)

                    // 检查是否存在
                    const exists = await checkApiPermissionExistsDao(input.path, input.method)
                    expect(exists).toBe(true)

                    // 检查排除自身时不存在
                    const existsExcludeSelf = await checkApiPermissionExistsDao(input.path, input.method, first.id)
                    expect(existsExcludeSelf).toBe(false)
                }),
                { numRuns: 3 }
            )
        })
    })

    describe('公开 API 权限查询', () => {
        it('标记为公开的 API 权限应能被 findPublicApiPermissionsDao 查询到', async () => {
            const uniqueId = generateUniqueId()

            // 创建公开的 API 权限
            const publicPermission = await createApiPermissionDao({
                path: `/api/v1/test/public/${uniqueId}`,
                method: 'GET',
                name: `公开权限_${uniqueId}`,
                isPublic: true,
                status: 1,
            })
            createdApiPermissionIds.push(publicPermission.id)

            // 创建非公开的 API 权限
            const privatePermission = await createApiPermissionDao({
                path: `/api/v1/test/private/${uniqueId}`,
                method: 'GET',
                name: `私有权限_${uniqueId}`,
                isPublic: false,
                status: 1,
            })
            createdApiPermissionIds.push(privatePermission.id)

            // 查询公开权限
            const publicPermissions = await findPublicApiPermissionsDao()

            // 验证公开权限在列表中
            const foundPublic = publicPermissions.find(p => p.id === publicPermission.id)
            expect(foundPublic).toBeDefined()

            // 验证私有权限不在列表中
            const foundPrivate = publicPermissions.find(p => p.id === privatePermission.id)
            expect(foundPrivate).toBeUndefined()
        })
    })

    describe('批量操作', () => {
        it('批量更新公开状态应正确更新所有权限', async () => {
            const uniqueId = generateUniqueId()

            // 创建 2 个非公开权限
            const ids: number[] = []
            for (let i = 0; i < 2; i++) {
                const permission = await createApiPermissionDao({
                    path: `/api/v1/test/batch-public/${uniqueId}/${i}`,
                    method: 'GET',
                    name: `批量公开测试_${uniqueId}_${i}`,
                    isPublic: false,
                })
                ids.push(permission.id)
                createdApiPermissionIds.push(permission.id)
            }

            // 批量设置为公开
            await updateApiPermissionsPublicStatusDao(ids, true)

            // 验证所有权限都已更新
            for (const id of ids) {
                const found = await findApiPermissionByIdDao(id)
                expect(found).not.toBeNull()
                expect(found!.isPublic).toBe(true)
            }
        })
    })
})
