/**
 * 角色 API 权限关联属性测试
 *
 * 使用 fast-check 进行属性测试，验证角色 API 权限关联的完整性
 *
 * **Feature: rbac-enhancement**
 * **Property 2: 角色 API 权限关联完整性**
 * **Validates: Requirements 2.2, 2.3, 2.4**
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import * as fc from 'fast-check'
import {
    testPrisma,
    createTestUser,
    connectTestDb,
    disconnectTestDb,
    resetDatabaseSequences,
} from '../membership/test-db-helper'

// 导入角色 API 权限关联 DAO 函数
import {
    assignApiPermissionsToRoleDao,
    removeApiPermissionsFromRoleDao,
    setRoleApiPermissionsDao,
    findRoleApiPermissionsDao,
    findUserApiPermissionsDao,
    checkRoleHasApiPermissionDao,
    findRolesByApiPermissionDao,
} from '../../../server/services/rbac/roleApiPermission.dao'

import {
    createApiPermissionDao,
} from '../../../server/services/rbac/apiPermission.dao'

// ==================== 测试数据追踪 ====================

/** 创建的角色 ID 列表 */
const createdRoleIds: number[] = []

/** 创建的 API 权限 ID 列表 */
const createdApiPermissionIds: number[] = []

/** 创建的用户 ID 列表 */
const createdUserIds: number[] = []

/** 创建的用户角色关联 ID 列表 */
const createdUserRoleIds: number[] = []

// ==================== 辅助函数 ====================

/** 生成唯一标识符 */
const generateUniqueId = () => {
    const timestamp = Date.now()
    const random = Math.floor(Math.random() * 1000000)
    const uuid = crypto.randomUUID().replace(/-/g, '').substring(0, 8)
    return `${timestamp}_${random}_${uuid}`
}

/** 创建测试角色 */
const createTestRole = async (name?: string) => {
    const uniqueId = generateUniqueId()
    const role = await testPrisma.roles.create({
        data: {
            name: name || `测试角色_${uniqueId}`,
            code: `TEST_ROLE_${uniqueId}`,
            description: '测试角色描述',
            status: 1,
        },
    })
    createdRoleIds.push(role.id)
    return role
}

/** 创建测试 API 权限 */
const createTestApiPermission = async (isPublic = false) => {
    const uniqueId = generateUniqueId()
    const permission = await createApiPermissionDao({
        path: `/api/v1/test/${uniqueId}`,
        method: 'GET',
        name: `测试权限_${uniqueId}`,
        isPublic,
        status: 1,
    })
    createdApiPermissionIds.push(permission.id)
    return permission
}

/** 清理测试数据 */
const cleanupTestData = async () => {
    // 清理用户角色关联
    if (createdUserRoleIds.length > 0) {
        await testPrisma.userRoles.deleteMany({
            where: { id: { in: createdUserRoleIds } },
        })
        createdUserRoleIds.length = 0
    }

    // 清理角色 API 权限关联
    if (createdRoleIds.length > 0) {
        await testPrisma.roleApiPermissions.deleteMany({
            where: { roleId: { in: createdRoleIds } },
        })
    }

    // 清理 API 权限
    if (createdApiPermissionIds.length > 0) {
        await testPrisma.apiPermissions.deleteMany({
            where: { id: { in: createdApiPermissionIds } },
        })
        createdApiPermissionIds.length = 0
    }

    // 清理角色
    if (createdRoleIds.length > 0) {
        await testPrisma.roles.deleteMany({
            where: { id: { in: createdRoleIds } },
        })
        createdRoleIds.length = 0
    }

    // 清理用户
    if (createdUserIds.length > 0) {
        await testPrisma.users.deleteMany({
            where: { id: { in: createdUserIds } },
        })
        createdUserIds.length = 0
    }
}

// ==================== 测试套件 ====================

describe('角色 API 权限关联属性测试', () => {
    beforeAll(async () => {
        await connectTestDb()
        await resetDatabaseSequences()
    })

    afterAll(async () => {
        await cleanupTestData()
        await disconnectTestDb()
    })

    beforeEach(() => {
        createdRoleIds.length = 0
        createdApiPermissionIds.length = 0
        createdUserIds.length = 0
        createdUserRoleIds.length = 0
    })

    afterEach(async () => {
        await cleanupTestData()
    })

    describe('Property 2: 角色 API 权限关联完整性', () => {
        it('批量分配权限后，查询该角色的权限应返回所有已分配的权限', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 3 }), // 权限数量
                    async (permissionCount) => {
                        // 创建角色
                        const role = await createTestRole()

                        // 创建多个 API 权限
                        const permissionIds: number[] = []
                        for (let i = 0; i < permissionCount; i++) {
                            const permission = await createTestApiPermission()
                            permissionIds.push(permission.id)
                        }

                        // 分配权限
                        await assignApiPermissionsToRoleDao(role.id, permissionIds)

                        // 查询角色权限
                        const rolePermissions = await findRoleApiPermissionsDao(role.id)

                        // 验证所有权限都已分配
                        expect(rolePermissions.length).toBe(permissionCount)
                        for (const permissionId of permissionIds) {
                            expect(rolePermissions.some(p => p.id === permissionId)).toBe(true)
                        }
                    }
                ),
                { numRuns: 3 }
            )
        })

        it('反向查询权限所属角色应正确返回', async () => {
            // 创建 API 权限
            const permission = await createTestApiPermission()

            // 创建多个角色并分配该权限
            const role1 = await createTestRole('角色1')
            const role2 = await createTestRole('角色2')

            await assignApiPermissionsToRoleDao(role1.id, [permission.id])
            await assignApiPermissionsToRoleDao(role2.id, [permission.id])

            // 反向查询
            const roles = await findRolesByApiPermissionDao(permission.id)

            // 验证两个角色都被返回
            expect(roles.length).toBe(2)
            expect(roles.some(r => r.id === role1.id)).toBe(true)
            expect(roles.some(r => r.id === role2.id)).toBe(true)
        })

        it('移除权限后，关联应被正确删除', async () => {
            // 创建角色和权限
            const role = await createTestRole()
            const permission1 = await createTestApiPermission()
            const permission2 = await createTestApiPermission()

            // 分配权限
            await assignApiPermissionsToRoleDao(role.id, [permission1.id, permission2.id])

            // 验证分配成功
            let rolePermissions = await findRoleApiPermissionsDao(role.id)
            expect(rolePermissions.length).toBe(2)

            // 移除一个权限
            await removeApiPermissionsFromRoleDao(role.id, [permission1.id])

            // 验证移除成功
            rolePermissions = await findRoleApiPermissionsDao(role.id)
            expect(rolePermissions.length).toBe(1)
            expect(rolePermissions[0].id).toBe(permission2.id)
        })

        it('全量替换权限应正确更新', async () => {
            // 创建角色和权限
            const role = await createTestRole()
            const permission1 = await createTestApiPermission()
            const permission2 = await createTestApiPermission()
            const permission3 = await createTestApiPermission()

            // 初始分配
            await assignApiPermissionsToRoleDao(role.id, [permission1.id, permission2.id])

            // 全量替换
            await setRoleApiPermissionsDao(role.id, [permission2.id, permission3.id])

            // 验证替换结果
            const rolePermissions = await findRoleApiPermissionsDao(role.id)
            expect(rolePermissions.length).toBe(2)
            expect(rolePermissions.some(p => p.id === permission1.id)).toBe(false)
            expect(rolePermissions.some(p => p.id === permission2.id)).toBe(true)
            expect(rolePermissions.some(p => p.id === permission3.id)).toBe(true)
        })

        it('检查角色是否拥有权限应返回正确结果', async () => {
            // 创建角色和权限
            const role = await createTestRole()
            const permission1 = await createTestApiPermission()
            const permission2 = await createTestApiPermission()

            // 只分配 permission1
            await assignApiPermissionsToRoleDao(role.id, [permission1.id])

            // 验证
            const hasPermission1 = await checkRoleHasApiPermissionDao(role.id, permission1.id)
            const hasPermission2 = await checkRoleHasApiPermissionDao(role.id, permission2.id)

            expect(hasPermission1).toBe(true)
            expect(hasPermission2).toBe(false)
        })
    })

    describe('用户 API 权限查询', () => {
        it('用户通过角色获取的 API 权限应正确返回', async () => {
            // 创建用户
            const user = await createTestUser()
            createdUserIds.push(user.id)

            // 创建角色和权限
            const role = await createTestRole()
            const permission1 = await createTestApiPermission()
            const permission2 = await createTestApiPermission()

            // 分配权限给角色
            await assignApiPermissionsToRoleDao(role.id, [permission1.id, permission2.id])

            // 分配角色给用户
            const userRole = await testPrisma.userRoles.create({
                data: { userId: user.id, roleId: role.id },
            })
            createdUserRoleIds.push(userRole.id)

            // 查询用户权限
            const userPermissions = await findUserApiPermissionsDao(user.id)

            // 验证
            expect(userPermissions.length).toBe(2)
            expect(userPermissions.some(p => p.id === permission1.id)).toBe(true)
            expect(userPermissions.some(p => p.id === permission2.id)).toBe(true)
        })

        it('用户拥有多个角色时，权限应合并去重', async () => {
            // 创建用户
            const user = await createTestUser()
            createdUserIds.push(user.id)

            // 创建两个角色
            const role1 = await createTestRole('角色1')
            const role2 = await createTestRole('角色2')

            // 创建权限
            const permission1 = await createTestApiPermission()
            const permission2 = await createTestApiPermission()
            const permission3 = await createTestApiPermission()

            // 角色1 拥有 permission1, permission2
            await assignApiPermissionsToRoleDao(role1.id, [permission1.id, permission2.id])
            // 角色2 拥有 permission2, permission3（permission2 重复）
            await assignApiPermissionsToRoleDao(role2.id, [permission2.id, permission3.id])

            // 分配两个角色给用户
            const userRole1 = await testPrisma.userRoles.create({
                data: { userId: user.id, roleId: role1.id },
            })
            createdUserRoleIds.push(userRole1.id)

            const userRole2 = await testPrisma.userRoles.create({
                data: { userId: user.id, roleId: role2.id },
            })
            createdUserRoleIds.push(userRole2.id)

            // 查询用户权限
            const userPermissions = await findUserApiPermissionsDao(user.id)

            // 验证：应该有 3 个权限（去重后）
            expect(userPermissions.length).toBe(3)
            expect(userPermissions.some(p => p.id === permission1.id)).toBe(true)
            expect(userPermissions.some(p => p.id === permission2.id)).toBe(true)
            expect(userPermissions.some(p => p.id === permission3.id)).toBe(true)
        })

        it('没有角色的用户应返回空权限列表', async () => {
            // 创建用户（不分配角色）
            const user = await createTestUser()
            createdUserIds.push(user.id)

            // 查询用户权限
            const userPermissions = await findUserApiPermissionsDao(user.id)

            expect(userPermissions.length).toBe(0)
        })
    })
})
