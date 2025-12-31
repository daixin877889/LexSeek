/**
 * 用户角色分配属性测试
 *
 * 使用 fast-check 进行属性测试，验证用户角色分配功能
 *
 * **Feature: rbac-enhancement**
 * **Property 8: 用户角色分配**
 * **Property 9: 权限变更即时生效**
 * **Validates: Requirements 9.2, 9.3, 9.4**
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import {
    testPrisma,
    createTestUser,
    connectTestDb,
    disconnectTestDb,
    resetDatabaseSequences,
} from '../membership/test-db-helper'

// 导入权限服务
import {
    getUserPermissions,
    validateUserApiPermission,
} from '../../../server/services/rbac/permission.service'
import {
    clearAllCache,
    clearUserPermissionCache,
} from '../../../server/services/rbac/cache.service'
import { assignApiPermissionsToRoleDao } from '../../../server/services/rbac/roleApiPermission.dao'
import { createApiPermissionDao } from '../../../server/services/rbac/apiPermission.dao'

// ==================== 测试数据追踪 ====================

const createdRoleIds: number[] = []
const createdUserIds: number[] = []
const createdUserRoleIds: number[] = []
const createdPermissionIds: number[] = []

// ==================== 辅助函数 ====================

const generateUniqueId = () => {
    const timestamp = Date.now()
    const random = Math.floor(Math.random() * 1000000)
    const uuid = crypto.randomUUID().replace(/-/g, '').substring(0, 8)
    return `${timestamp}_${random}_${uuid}`
}

const createTestRole = async (name?: string, code?: string) => {
    const uniqueId = generateUniqueId()
    const role = await testPrisma.roles.create({
        data: {
            name: name || `测试角色_${uniqueId}`,
            code: code || `TEST_ROLE_${uniqueId}`,
            description: '测试角色描述',
            status: 1,
        },
    })
    createdRoleIds.push(role.id)
    return role
}

const createTestPermission = async (path: string, method: string) => {
    const permission = await createApiPermissionDao({
        path,
        method,
        name: `测试权限_${generateUniqueId()}`,
        isPublic: false,
        status: 1,
    })
    createdPermissionIds.push(permission.id)
    return permission
}

const cleanupTestData = async () => {
    clearAllCache()

    if (createdUserRoleIds.length > 0) {
        await testPrisma.userRoles.deleteMany({
            where: { id: { in: createdUserRoleIds } },
        })
        createdUserRoleIds.length = 0
    }

    if (createdRoleIds.length > 0) {
        await testPrisma.roleApiPermissions.deleteMany({
            where: { roleId: { in: createdRoleIds } },
        })
    }

    if (createdPermissionIds.length > 0) {
        await testPrisma.apiPermissions.deleteMany({
            where: { id: { in: createdPermissionIds } },
        })
        createdPermissionIds.length = 0
    }

    if (createdRoleIds.length > 0) {
        await testPrisma.roles.deleteMany({
            where: { id: { in: createdRoleIds } },
        })
        createdRoleIds.length = 0
    }

    if (createdUserIds.length > 0) {
        await testPrisma.users.deleteMany({
            where: { id: { in: createdUserIds } },
        })
        createdUserIds.length = 0
    }
}

// ==================== 测试套件 ====================

describe('用户角色分配属性测试', () => {
    beforeAll(async () => {
        await connectTestDb()
        await resetDatabaseSequences()
    })

    afterAll(async () => {
        await cleanupTestData()
        await disconnectTestDb()
    })

    beforeEach(() => {
        clearAllCache()
        createdRoleIds.length = 0
        createdUserIds.length = 0
        createdUserRoleIds.length = 0
        createdPermissionIds.length = 0
    })

    afterEach(async () => {
        await cleanupTestData()
    })

    describe('Property 8: 用户角色分配', () => {
        it('用户可以被分配单个角色', async () => {
            // 创建用户和角色
            const user = await createTestUser()
            createdUserIds.push(user.id)
            const role = await createTestRole()

            // 分配角色
            const userRole = await testPrisma.userRoles.create({
                data: { userId: user.id, roleId: role.id },
            })
            createdUserRoleIds.push(userRole.id)

            // 验证分配成功
            const userRoles = await testPrisma.userRoles.findMany({
                where: { userId: user.id },
            })
            expect(userRoles.length).toBe(1)
            expect(userRoles[0].roleId).toBe(role.id)
        })

        it('用户可以被分配多个角色', async () => {
            // 创建用户和多个角色
            const user = await createTestUser()
            createdUserIds.push(user.id)
            const role1 = await createTestRole()
            const role2 = await createTestRole()

            // 分配多个角色
            const userRole1 = await testPrisma.userRoles.create({
                data: { userId: user.id, roleId: role1.id },
            })
            createdUserRoleIds.push(userRole1.id)

            const userRole2 = await testPrisma.userRoles.create({
                data: { userId: user.id, roleId: role2.id },
            })
            createdUserRoleIds.push(userRole2.id)

            // 验证分配成功
            const userRoles = await testPrisma.userRoles.findMany({
                where: { userId: user.id },
            })
            expect(userRoles.length).toBe(2)
        })

        it('移除用户角色后应立即生效', async () => {
            const uniqueId = generateUniqueId()
            const path = `/api/v1/user-role/test/${uniqueId}`

            // 创建用户、角色和权限
            const user = await createTestUser()
            createdUserIds.push(user.id)
            const role = await createTestRole()
            const permission = await createTestPermission(path, 'GET')

            // 分配权限给角色
            await assignApiPermissionsToRoleDao(role.id, [permission.id])

            // 分配角色给用户
            const userRole = await testPrisma.userRoles.create({
                data: { userId: user.id, roleId: role.id },
            })
            createdUserRoleIds.push(userRole.id)

            // 验证用户有权限
            let result = await validateUserApiPermission(user.id, path, 'GET')
            expect(result.allowed).toBe(true)

            // 移除用户角色
            await testPrisma.userRoles.delete({
                where: { id: userRole.id },
            })
            createdUserRoleIds.length = 0

            // 清除缓存
            clearUserPermissionCache(user.id)

            // 验证用户失去权限
            result = await validateUserApiPermission(user.id, path, 'GET')
            expect(result.allowed).toBe(false)
        })
    })

    describe('Property 9: 权限变更即时生效', () => {
        it('分配角色后用户应立即获得权限', async () => {
            const uniqueId = generateUniqueId()
            const path = `/api/v1/instant/test/${uniqueId}`

            // 创建用户、角色和权限
            const user = await createTestUser()
            createdUserIds.push(user.id)
            const role = await createTestRole()
            const permission = await createTestPermission(path, 'GET')

            // 分配权限给角色
            await assignApiPermissionsToRoleDao(role.id, [permission.id])

            // 验证用户没有权限
            let result = await validateUserApiPermission(user.id, path, 'GET')
            expect(result.allowed).toBe(false)

            // 分配角色给用户
            const userRole = await testPrisma.userRoles.create({
                data: { userId: user.id, roleId: role.id },
            })
            createdUserRoleIds.push(userRole.id)

            // 清除缓存
            clearUserPermissionCache(user.id)

            // 验证用户立即获得权限
            result = await validateUserApiPermission(user.id, path, 'GET')
            expect(result.allowed).toBe(true)
        })

        it('角色权限变更后应影响所有拥有该角色的用户', async () => {
            const uniqueId = generateUniqueId()
            const path = `/api/v1/role-change/test/${uniqueId}`

            // 创建两个用户和一个角色
            const user1 = await createTestUser()
            createdUserIds.push(user1.id)
            const user2 = await createTestUser()
            createdUserIds.push(user2.id)
            const role = await createTestRole()

            // 分配角色给两个用户
            const userRole1 = await testPrisma.userRoles.create({
                data: { userId: user1.id, roleId: role.id },
            })
            createdUserRoleIds.push(userRole1.id)

            const userRole2 = await testPrisma.userRoles.create({
                data: { userId: user2.id, roleId: role.id },
            })
            createdUserRoleIds.push(userRole2.id)

            // 验证两个用户都没有权限
            let result1 = await validateUserApiPermission(user1.id, path, 'GET')
            let result2 = await validateUserApiPermission(user2.id, path, 'GET')
            expect(result1.allowed).toBe(false)
            expect(result2.allowed).toBe(false)

            // 创建权限并分配给角色
            const permission = await createTestPermission(path, 'GET')
            await assignApiPermissionsToRoleDao(role.id, [permission.id])

            // 清除缓存
            clearUserPermissionCache(user1.id)
            clearUserPermissionCache(user2.id)

            // 验证两个用户都获得权限
            result1 = await validateUserApiPermission(user1.id, path, 'GET')
            result2 = await validateUserApiPermission(user2.id, path, 'GET')
            expect(result1.allowed).toBe(true)
            expect(result2.allowed).toBe(true)
        })

        it('getUserPermissions 应返回用户的完整权限', async () => {
            const uniqueId = generateUniqueId()

            // 创建用户、角色和权限
            const user = await createTestUser()
            createdUserIds.push(user.id)
            const role = await createTestRole()
            const permission1 = await createTestPermission(`/api/v1/perm1/${uniqueId}`, 'GET')
            const permission2 = await createTestPermission(`/api/v1/perm2/${uniqueId}`, 'POST')

            // 分配权限给角色
            await assignApiPermissionsToRoleDao(role.id, [permission1.id, permission2.id])

            // 分配角色给用户
            const userRole = await testPrisma.userRoles.create({
                data: { userId: user.id, roleId: role.id },
            })
            createdUserRoleIds.push(userRole.id)

            // 获取用户权限
            const permissions = await getUserPermissions(user.id)

            expect(permissions.apiPermissions.length).toBe(2)
            expect(permissions.isSuperAdmin).toBe(false)
        })
    })
})
