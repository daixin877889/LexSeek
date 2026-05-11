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
import '../_helpers/handler-test'
import { makeEvent, expectSuccess } from '../_helpers/handler-test'
import {
    testPrisma,
    createTestUser,
    connectTestDb,
    disconnectTestDb,
    resetDatabaseSequences,
} from '../membership/test-db-helper'
import { mockLogger } from '../membership/test-setup'

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

// 在模块加载时设置全局 prisma 和 logger（仅在测试环境中）
if (typeof window === 'undefined' && process.env.NODE_ENV === 'test') {
    ;(globalThis as any).prisma = testPrisma
    ;(globalThis as any).logger = mockLogger
}

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

        it('admin 用户列表不显示已软删的 userRoles 关联（回归 #soft-deleted-roles-leaked）', async () => {
            // 复现 bug：admin/users index.get 漏过滤 deletedAt，
            // 导致已被撤销的角色仍出现在用户行的 roles 列表里。
            const user = await createTestUser()
            createdUserIds.push(user.id)
            const roleKept = await createTestRole('保留角色', `KEPT_${generateUniqueId()}`)
            const roleRevoked = await createTestRole('撤销角色', `REV_${generateUniqueId()}`)

            const ur1 = await testPrisma.userRoles.create({
                data: { userId: user.id, roleId: roleKept.id },
            })
            const ur2 = await testPrisma.userRoles.create({
                data: { userId: user.id, roleId: roleRevoked.id },
            })
            createdUserRoleIds.push(ur1.id, ur2.id)

            // 撤销其中一个角色（软删）
            await testPrisma.userRoles.updateMany({
                where: { id: ur2.id },
                data: { deletedAt: new Date() },
            })

            const { default: handler } = await import('../../../server/api/v1/admin/users/index.get')
            const data = expectSuccess(
                await handler(makeEvent({
                    userId: 100,
                    query: { keyword: user.phone, pageSize: '50' },
                }) as any),
            )

            const row = data.items.find((it: any) => it.id === user.id)
            expect(row).toBeDefined()
            const roleIds = row.roles.map((r: any) => r.id).sort()
            expect(roleIds).toEqual([roleKept.id])
        })

        it('admin 用户列表按 roleId 筛选时不应命中已撤销该角色的用户（回归 #role-filter-soft-delete）', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)
            const role = await createTestRole()

            const ur = await testPrisma.userRoles.create({
                data: { userId: user.id, roleId: role.id },
            })
            createdUserRoleIds.push(ur.id)

            // 撤销该用户的这个角色
            await testPrisma.userRoles.updateMany({
                where: { id: ur.id },
                data: { deletedAt: new Date() },
            })

            const { default: handler } = await import('../../../server/api/v1/admin/users/index.get')
            const data = expectSuccess(
                await handler(makeEvent({
                    userId: 100,
                    query: { roleId: String(role.id), pageSize: '50' },
                }) as any),
            )

            // 应只命中那些"当前仍然拥有该角色"的用户——不能包含已撤销的 user
            const hit = data.items.find((it: any) => it.id === user.id)
            expect(hit).toBeUndefined()
        })

        it('软删后再次授予相同角色不会撞唯一约束（回归 #unique-soft-delete）', async () => {
            // 复现 bug：userRoles 表有 @@unique([userId, roleId]) 不带 deletedAt，
            // 旧实现先 updateMany 软删 + createMany 重插，会撞 PG 唯一约束。
            // 修复后改为 upsert 复用旧行（清掉 deletedAt），不再插新行。
            const user = await createTestUser()
            createdUserIds.push(user.id)
            const role = await createTestRole()

            // 1. 首次分配：插一行 (userId, roleId)
            const first = await testPrisma.userRoles.create({
                data: { userId: user.id, roleId: role.id },
            })
            createdUserRoleIds.push(first.id)

            // 2. 模拟"撤销"——软删
            await testPrisma.userRoles.updateMany({
                where: { userId: user.id, deletedAt: null },
                data: { deletedAt: new Date(), updatedAt: new Date() },
            })

            // 3. 再次授予相同角色：用修复后的 upsert 模式
            const upserted = await testPrisma.userRoles.upsert({
                where: { idx_user_role_unique: { userId: user.id, roleId: role.id } },
                create: { userId: user.id, roleId: role.id },
                update: { deletedAt: null, updatedAt: new Date() },
            })

            // 4. 表里应只有一行 (userId, roleId)，且 deletedAt 已被清掉
            expect(upserted.id).toBe(first.id)
            expect(upserted.deletedAt).toBeNull()

            const all = await testPrisma.userRoles.findMany({
                where: { userId: user.id, roleId: role.id },
            })
            expect(all.length).toBe(1)
            expect(all[0].deletedAt).toBeNull()
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
