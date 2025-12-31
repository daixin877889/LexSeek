/**
 * 权限验证服务属性测试
 *
 * 使用 fast-check 进行属性测试，验证 API 权限验证正确性
 *
 * **Feature: rbac-enhancement**
 * **Property 3: API 权限验证正确性**
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import {
    testPrisma,
    createTestUser,
    connectTestDb,
    disconnectTestDb,
    resetDatabaseSequences,
} from '../membership/test-db-helper'

// 导入权限验证服务函数
import {
    validateUserApiPermission,
    validateUserRoutePermission,
    getUserPermissions,
    checkIsSuperAdmin,
} from '../../../server/services/rbac/permission.service'

import {
    createApiPermissionDao,
} from '../../../server/services/rbac/apiPermission.dao'

import {
    assignApiPermissionsToRoleDao,
} from '../../../server/services/rbac/roleApiPermission.dao'

import {
    clearAllCache,
} from '../../../server/services/rbac/cache.service'

// ==================== 测试数据追踪 ====================

const createdRoleIds: number[] = []
const createdApiPermissionIds: number[] = []
const createdUserIds: number[] = []
const createdUserRoleIds: number[] = []

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

const createTestApiPermission = async (path: string, method: string, isPublic = false) => {
    const permission = await createApiPermissionDao({
        path,
        method,
        name: `测试权限_${generateUniqueId()}`,
        isPublic,
        status: 1,
    })
    createdApiPermissionIds.push(permission.id)
    return permission
}

const cleanupTestData = async () => {
    // 清除缓存
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

    if (createdApiPermissionIds.length > 0) {
        await testPrisma.apiPermissions.deleteMany({
            where: { id: { in: createdApiPermissionIds } },
        })
        createdApiPermissionIds.length = 0
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

describe('权限验证服务属性测试', () => {
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
        createdApiPermissionIds.length = 0
        createdUserIds.length = 0
        createdUserRoleIds.length = 0
    })

    afterEach(async () => {
        await cleanupTestData()
    })

    describe('Property 3: API 权限验证正确性', () => {
        it('未登录用户访问公开 API 应允许', async () => {
            const uniqueId = generateUniqueId()
            const path = `/api/v1/test/public/${uniqueId}`

            // 创建公开 API 权限
            await createTestApiPermission(path, 'GET', true)

            // 验证未登录用户可以访问
            const result = await validateUserApiPermission(null, path, 'GET')

            expect(result.allowed).toBe(true)
            expect(result.reason).toBe('public_api')
        })

        it('未登录用户访问非公开 API 应返回 not_authenticated', async () => {
            const uniqueId = generateUniqueId()
            const path = `/api/v1/test/private/${uniqueId}`

            // 创建非公开 API 权限
            await createTestApiPermission(path, 'GET', false)

            // 验证未登录用户不能访问
            const result = await validateUserApiPermission(null, path, 'GET')

            expect(result.allowed).toBe(false)
            expect(result.reason).toBe('not_authenticated')
        })

        it('已登录用户有权限时应允许访问', async () => {
            const uniqueId = generateUniqueId()
            const path = `/api/v1/test/protected/${uniqueId}`

            // 创建用户
            const user = await createTestUser()
            createdUserIds.push(user.id)

            // 创建角色和权限
            const role = await createTestRole()
            const permission = await createTestApiPermission(path, 'GET', false)

            // 分配权限给角色
            await assignApiPermissionsToRoleDao(role.id, [permission.id])

            // 分配角色给用户
            const userRole = await testPrisma.userRoles.create({
                data: { userId: user.id, roleId: role.id },
            })
            createdUserRoleIds.push(userRole.id)

            // 验证用户可以访问
            const result = await validateUserApiPermission(user.id, path, 'GET')

            expect(result.allowed).toBe(true)
            expect(result.reason).toBe('has_permission')
        })

        it('已登录用户无权限时应返回 no_permission', async () => {
            const uniqueId = generateUniqueId()
            const path = `/api/v1/test/noperm/${uniqueId}`

            // 创建用户（不分配任何角色）
            const user = await createTestUser()
            createdUserIds.push(user.id)

            // 创建非公开 API 权限（但不分配给用户）
            await createTestApiPermission(path, 'GET', false)

            // 验证用户不能访问
            const result = await validateUserApiPermission(user.id, path, 'GET')

            expect(result.allowed).toBe(false)
            expect(result.reason).toBe('no_permission')
        })

        it('超级管理员应能访问任意 API', async () => {
            const uniqueId = generateUniqueId()
            const path = `/api/v1/test/admin/${uniqueId}`

            // 创建用户
            const user = await createTestUser()
            createdUserIds.push(user.id)

            // 查找或创建超级管理员角色
            let superAdminRole = await testPrisma.roles.findFirst({
                where: { code: 'super_admin', status: 1, deletedAt: null },
            })

            if (!superAdminRole) {
                superAdminRole = await testPrisma.roles.create({
                    data: {
                        name: '超级管理员',
                        code: 'super_admin',
                        description: '超级管理员角色',
                        status: 1,
                    },
                })
                createdRoleIds.push(superAdminRole.id)
            }

            // 分配超级管理员角色给用户
            const userRole = await testPrisma.userRoles.create({
                data: { userId: user.id, roleId: superAdminRole.id },
            })
            createdUserRoleIds.push(userRole.id)

            // 创建非公开 API 权限（不分配给任何角色）
            await createTestApiPermission(path, 'GET', false)

            // 验证超级管理员可以访问
            const result = await validateUserApiPermission(user.id, path, 'GET')

            expect(result.allowed).toBe(true)
            expect(result.reason).toBe('super_admin')
        })
    })

    describe('checkIsSuperAdmin', () => {
        it('拥有超级管理员角色的用户应返回 true', async () => {
            // 创建用户
            const user = await createTestUser()
            createdUserIds.push(user.id)

            // 查找或创建超级管理员角色
            let superAdminRole = await testPrisma.roles.findFirst({
                where: { code: 'super_admin', status: 1, deletedAt: null },
            })

            if (!superAdminRole) {
                superAdminRole = await testPrisma.roles.create({
                    data: {
                        name: '超级管理员',
                        code: 'super_admin',
                        description: '超级管理员角色',
                        status: 1,
                    },
                })
                createdRoleIds.push(superAdminRole.id)
            }

            // 分配超级管理员角色
            const userRole = await testPrisma.userRoles.create({
                data: { userId: user.id, roleId: superAdminRole.id },
            })
            createdUserRoleIds.push(userRole.id)

            // 验证
            const isSuperAdmin = await checkIsSuperAdmin(user.id)
            expect(isSuperAdmin).toBe(true)
        })

        it('没有超级管理员角色的用户应返回 false', async () => {
            // 创建用户
            const user = await createTestUser()
            createdUserIds.push(user.id)

            // 创建普通角色
            const role = await createTestRole('普通角色', `NORMAL_${generateUniqueId()}`)

            // 分配普通角色
            const userRole = await testPrisma.userRoles.create({
                data: { userId: user.id, roleId: role.id },
            })
            createdUserRoleIds.push(userRole.id)

            // 验证
            const isSuperAdmin = await checkIsSuperAdmin(user.id)
            expect(isSuperAdmin).toBe(false)
        })
    })

    describe('getUserPermissions', () => {
        it('应返回用户的完整权限信息', async () => {
            const uniqueId = generateUniqueId()

            // 创建用户
            const user = await createTestUser()
            createdUserIds.push(user.id)

            // 创建角色和权限
            const role = await createTestRole()
            const permission1 = await createTestApiPermission(`/api/v1/test/perm1/${uniqueId}`, 'GET')
            const permission2 = await createTestApiPermission(`/api/v1/test/perm2/${uniqueId}`, 'POST')

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
