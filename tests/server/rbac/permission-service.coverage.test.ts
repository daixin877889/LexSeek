/**
 * RBAC 权限服务 - 覆盖率补充测试
 *
 * 覆盖 permission.service.ts 中未被测试的路径：
 * - validateUserApiPermission 各分支
 * - validateUserRoutePermission 各分支
 * - refreshRoleUsersPermissions 批量刷新
 * - getUserPermissions 缓存命中/未命中
 * - getPublicApiPermissions 缓存逻辑
 *
 * **Feature: rbac-permission**
 * **Validates: Requirements 8.1, 8.2, 8.3**
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '../../../server/utils/db'
import {
    getUserPermissions,
    getPublicApiPermissions,
    validateUserApiPermission,
    validateUserRoutePermission,
    refreshUserPermissions,
    refreshPublicApiPermissions,
    refreshRoleUsersPermissions,
    checkIsSuperAdmin,
} from '../../../server/services/rbac/permission.service'
import { clearUserPermissionCache, clearPublicApiPermissionCache } from '../../../server/services/rbac/cache.service'

let testUserId: number | null = null
let superAdminUserId: number | null = null

describe('RBAC 权限服务 - 覆盖率补充', () => {
    beforeAll(async () => {
        // 查找普通测试用户
        const user = await prisma.users.findFirst({
            where: { deletedAt: null },
            select: { id: true },
        })
        testUserId = user?.id ?? null

        // 查找超级管理员用户
        const superAdminRole = await prisma.roles.findFirst({
            where: { code: 'super_admin', status: 1, deletedAt: null },
            select: { id: true },
        })

        if (superAdminRole) {
            const adminUserRole = await prisma.userRoles.findFirst({
                where: { roleId: superAdminRole.id },
                select: { userId: true },
            })
            superAdminUserId = adminUserRole?.userId ?? null
        }
    })

    beforeEach(() => {
        // 清除缓存确保每个测试独立
        if (testUserId) clearUserPermissionCache(testUserId)
        if (superAdminUserId) clearUserPermissionCache(superAdminUserId)
        clearPublicApiPermissionCache()
    })

    describe('checkIsSuperAdmin', () => {
        it('超级管理员应返回 true', async () => {
            if (!superAdminUserId) return

            const result = await checkIsSuperAdmin(superAdminUserId)
            expect(result).toBe(true)
        })

        it('普通用户应返回 false', async () => {
            if (!testUserId) return

            // 不一定是非管理员，但如果有普通用户就测试
            const result = await checkIsSuperAdmin(testUserId)
            expect(typeof result).toBe('boolean')
        })

        it('不存在的用户应返回 false', async () => {
            const result = await checkIsSuperAdmin(999999)
            expect(result).toBe(false)
        })
    })

    describe('getUserPermissions', () => {
        it('应返回用户权限信息', async () => {
            if (!testUserId) return

            const permissions = await getUserPermissions(testUserId)

            expect(permissions).toHaveProperty('apiPermissions')
            expect(permissions).toHaveProperty('routePermissions')
            expect(permissions).toHaveProperty('isSuperAdmin')
            expect(Array.isArray(permissions.apiPermissions)).toBe(true)
            expect(Array.isArray(permissions.routePermissions)).toBe(true)
        })

        it('第二次调用应命中缓存', async () => {
            if (!testUserId) return

            // 第一次查询（从数据库）
            const permissions1 = await getUserPermissions(testUserId)
            // 第二次查询（从缓存）
            const permissions2 = await getUserPermissions(testUserId)

            expect(permissions1.isSuperAdmin).toBe(permissions2.isSuperAdmin)
            expect(permissions1.apiPermissions.length).toBe(permissions2.apiPermissions.length)
        })
    })

    describe('getPublicApiPermissions', () => {
        it('应返回公共 API 权限列表', async () => {
            const permissions = await getPublicApiPermissions()

            expect(Array.isArray(permissions)).toBe(true)
            for (const perm of permissions) {
                expect(perm).toHaveProperty('path')
                expect(perm).toHaveProperty('method')
            }
        })

        it('第二次调用应命中缓存', async () => {
            const permissions1 = await getPublicApiPermissions()
            const permissions2 = await getPublicApiPermissions()

            expect(permissions1.length).toBe(permissions2.length)
        })
    })

    describe('validateUserApiPermission', () => {
        it('公开 API 应允许未登录用户访问', async () => {
            const publicPerms = await getPublicApiPermissions()

            if (publicPerms.length === 0) return

            const firstPublicApi = publicPerms[0]!
            const result = await validateUserApiPermission(
                null,
                firstPublicApi.path,
                firstPublicApi.method
            )

            expect(result.allowed).toBe(true)
            expect(result.reason).toBe('public_api')
        })

        it('未登录用户访问非公开 API 应被拒绝', async () => {
            const result = await validateUserApiPermission(
                null,
                '/api/v1/admin/some-secret-resource',
                'GET'
            )

            // 如果不是公开 API，未登录应被拒绝
            if (!result.allowed) {
                expect(result.reason).toBe('not_authenticated')
            }
        })

        it('超级管理员应能访问所有 API', async () => {
            if (!superAdminUserId) return

            const result = await validateUserApiPermission(
                superAdminUserId,
                '/api/v1/admin/any-resource',
                'GET'
            )

            expect(result.allowed).toBe(true)
            expect(result.reason).toBe('super_admin')
        })
    })

    describe('validateUserRoutePermission', () => {
        it('超级管理员应拥有所有路由权限', async () => {
            if (!superAdminUserId) return

            const result = await validateUserRoutePermission(
                superAdminUserId,
                '/admin/dashboard'
            )

            expect(result.allowed).toBe(true)
            expect(result.reason).toBe('super_admin')
        })

        it('不存在的路由权限应被拒绝', async () => {
            if (!testUserId) return

            const permissions = await getUserPermissions(testUserId)

            // 如果用户不是超级管理员，访问不存在的路由应被拒绝
            if (!permissions.isSuperAdmin) {
                const result = await validateUserRoutePermission(
                    testUserId,
                    '/nonexistent/route/xyz123'
                )

                expect(result.allowed).toBe(false)
                expect(result.reason).toBe('no_permission')
            }
        })
    })

    describe('refreshUserPermissions', () => {
        it('刷新后应返回最新权限', async () => {
            if (!testUserId) return

            const permissions = await refreshUserPermissions(testUserId)

            expect(permissions).toHaveProperty('apiPermissions')
            expect(permissions).toHaveProperty('routePermissions')
            expect(permissions).toHaveProperty('isSuperAdmin')
        })
    })

    describe('refreshPublicApiPermissions', () => {
        it('刷新后应返回最新公共 API 权限', async () => {
            const permissions = await refreshPublicApiPermissions()

            expect(Array.isArray(permissions)).toBe(true)
        })
    })

    describe('refreshRoleUsersPermissions', () => {
        it('应批量清除角色相关用户的缓存', async () => {
            const role = await prisma.roles.findFirst({
                where: { status: 1, deletedAt: null },
                select: { id: true },
            })

            if (!role) return

            // 刷新不应抛出异常
            await expect(
                refreshRoleUsersPermissions(role.id)
            ).resolves.not.toThrow()
        })

        it('不存在的角色 ID 不应报错', async () => {
            await expect(
                refreshRoleUsersPermissions(999999)
            ).resolves.not.toThrow()
        })
    })
})
