/**
 * RBAC DAO 修复后行为测试
 *
 * 覆盖 RBAC 全面审查后对 apiPermission.dao 的硬化：
 *  - C4：路径入库前规范化 [xxx] -> :xxx；validateApiPathFormat 拒绝异常格式
 *  - H5：method 入库前强制大写
 *  - H7：deleteApiPermissionDao 软删的同时级联软删 roleApiPermissions 关联
 *
 * **Feature: rbac-security-hardening**
 * **Validates: C4, H5, H7**
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
    cleanupRbacTestData,
    connectTestDb,
    createTestRole,
    disconnectTestDb,
    setupGlobalTestEnv,
    testPrisma,
} from './helpers/test-helper'
import {
    createApiPermissionDao,
    deleteApiPermissionDao,
} from '../../../server/services/rbac/apiPermission.dao'

setupGlobalTestEnv()

describe('RBAC DAO 修复后行为', () => {
    let cleanup: { roleIds: number[]; permissionIds: number[]; userRoleIds: number[]; userIds: number[] }

    beforeAll(async () => {
        await connectTestDb()
    })

    afterAll(async () => {
        await disconnectTestDb()
    })

    afterEach(async () => {
        if (cleanup) {
            await cleanupRbacTestData(cleanup)
        }
    })

    describe('C4 / H5：路径与方法入库前规范化', () => {
        it('[id] 字面字符自动转 :id', async () => {
            const perm = await createApiPermissionDao({
                path: '/api/v1/admin/test-c4/[userId]/roles',
                method: 'put',
                name: '测试 C4 路径规范化',
                isPublic: false,
                status: 1,
            })
            cleanup = { roleIds: [], permissionIds: [perm.id], userRoleIds: [], userIds: [] }

            // 路径已规范化
            expect(perm.path).toBe('/api/v1/admin/test-c4/:userId/roles')
            // 方法已强制大写
            expect(perm.method).toBe('PUT')
        })

        it('多斜杠折叠 + 尾随 / 去除', async () => {
            const perm = await createApiPermissionDao({
                path: '//api///v1//admin//test-c4-2//',
                method: 'GET',
                name: '测试 C4 折叠斜杠',
                isPublic: false,
                status: 1,
            })
            cleanup = { roleIds: [], permissionIds: [perm.id], userRoleIds: [], userIds: [] }
            expect(perm.path).toBe('/api/v1/admin/test-c4-2')
        })

        it('非法 HTTP 方法被拒绝', async () => {
            await expect(
                createApiPermissionDao({
                    path: '/api/v1/admin/test-c4-3',
                    method: 'BOGUS',
                    name: '测试非法方法',
                    isPublic: false,
                    status: 1,
                }),
            ).rejects.toThrow(/无效/)
        })

        it('查询字符串路径被拒绝', async () => {
            await expect(
                createApiPermissionDao({
                    path: '/api/v1/admin/test-c4-4?leak=1',
                    method: 'GET',
                    name: '测试查询字符串',
                    isPublic: false,
                    status: 1,
                }),
            ).rejects.toThrow(/查询字符串/)
        })
    })

    describe('H7：deleteApiPermissionDao 级联软删 role 关联', () => {
        it('软删权限时同步把 role_api_permissions 关联也软删', async () => {
            const perm = await createApiPermissionDao({
                path: '/api/v1/admin/test-h7',
                method: 'GET',
                name: '测试 H7 级联软删',
                isPublic: false,
                status: 1,
            })
            const role = await createTestRole()

            // 先建立角色 → 权限 关联
            const relation = await testPrisma.roleApiPermissions.create({
                data: { roleId: role.id, permissionId: perm.id },
            })

            // 软删该权限
            await deleteApiPermissionDao(perm.id)

            // 权限本身已被软删
            const after = await testPrisma.apiPermissions.findUnique({ where: { id: perm.id } })
            expect(after?.deletedAt).not.toBeNull()

            // role_api_permissions 关联也被软删
            const afterRel = await testPrisma.roleApiPermissions.findUnique({
                where: { id: relation.id },
            })
            expect(afterRel?.deletedAt).not.toBeNull()

            // 准备 cleanup（注意 relation 已软删，cleanup 用 deleteMany 仍能命中）
            cleanup = {
                roleIds: [role.id],
                permissionIds: [perm.id],
                userRoleIds: [],
                userIds: [],
            }
        })
    })
})
