/**
 * RBAC guard.service 单元测试
 *
 * 覆盖 RBAC 全面审查后新增的公共防护工具：
 *  - normalizeApiPath
 *  - normalizeApiMethod
 *  - validateApiPathFormat
 *  - ensureSuperAdminRemainingGuard
 *
 * **Feature: rbac-security-hardening**
 * **Validates: C1, C4, H5**
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
    cleanupRbacTestData,
    connectTestDb,
    createTestUser,
    disconnectTestDb,
    setupGlobalTestEnv,
    testPrisma,
} from './helpers/test-helper'
import {
    ensureSuperAdminRemainingGuard,
    normalizeApiMethod,
    normalizeApiPath,
    validateApiPathFormat,
} from '../../../server/services/rbac/guard.service'

setupGlobalTestEnv()

describe('RBAC guard.service', () => {
    describe('normalizeApiPath', () => {
        it('把 [xxx] 替换为 :xxx', () => {
            expect(normalizeApiPath('/api/v1/admin/users/[id]/roles')).toBe(
                '/api/v1/admin/users/:id/roles',
            )
            expect(normalizeApiPath('/api/v1/admin/[a]/[b]/c')).toBe(
                '/api/v1/admin/:a/:b/c',
            )
        })

        it('折叠多余斜杠', () => {
            expect(normalizeApiPath('//api///v1//users//')).toBe('/api/v1/users')
        })

        it('保留单 / 根路径', () => {
            expect(normalizeApiPath('/')).toBe('/')
        })

        it('已经规范化的路径返回原值（幂等）', () => {
            expect(normalizeApiPath('/api/v1/users/:id')).toBe('/api/v1/users/:id')
        })
    })

    describe('normalizeApiMethod', () => {
        it('合法 HTTP 方法被强制大写', () => {
            expect(normalizeApiMethod('get')).toBe('GET')
            expect(normalizeApiMethod('Post')).toBe('POST')
            expect(normalizeApiMethod(' put ')).toBe('PUT')
        })

        it('* 通配符保留', () => {
            expect(normalizeApiMethod('*')).toBe('*')
        })

        it('非法方法抛错', () => {
            expect(() => normalizeApiMethod('CONNECT')).toThrow(/无效/)
            expect(() => normalizeApiMethod('xxx')).toThrow(/无效/)
        })
    })

    describe('validateApiPathFormat', () => {
        it('合法路径通过校验', () => {
            expect(validateApiPathFormat('/api/v1/users/:id')).toBeNull()
            expect(validateApiPathFormat('/api/v1/admin/**')).toBeNull()
            expect(validateApiPathFormat('/api/v1/files/oss/*')).toBeNull()
        })

        it('不以 / 开头的路径拒绝', () => {
            expect(validateApiPathFormat('api/v1/users')).not.toBeNull()
        })

        it('含 [ 或 ] 的路径拒绝', () => {
            expect(validateApiPathFormat('/api/v1/users/[id]')).not.toBeNull()
            expect(validateApiPathFormat('/api/v1/users/[id]/roles')).not.toBeNull()
        })

        it('含查询字符串或锚点拒绝', () => {
            expect(validateApiPathFormat('/api/v1/users?x=1')).not.toBeNull()
            expect(validateApiPathFormat('/api/v1/users#anchor')).not.toBeNull()
        })
    })

    describe('ensureSuperAdminRemainingGuard', () => {
        let superAdminRoleId: number
        let cleanup: { userIds: number[]; roleIds: number[]; userRoleIds: number[] }

        beforeAll(async () => {
            await connectTestDb()
            // 复用 seed 已有的 super_admin 角色（code 唯一）
            const role = await testPrisma.roles.findFirst({
                where: { code: 'super_admin' },
            })
            if (!role) throw new Error('测试库缺少 super_admin 角色，先跑 seedData.sql')
            superAdminRoleId = role.id
        })

        afterAll(async () => {
            await disconnectTestDb()
        })

        afterEach(async () => {
            if (cleanup) {
                await cleanupRbacTestData(cleanup)
            }
        })

        it('系统至少有一名超管时返回 ok', async () => {
            const result = await ensureSuperAdminRemainingGuard()
            // 测试库初始就有 super_admin 用户，应通过
            expect(result.ok).toBe(true)
        })

        it('excludeUserId 把指定用户当作"已剥离超管"再做计数', async () => {
            // 创建一个临时超管，单独剥离他后系统应该仍剩至少一名（seed 中已有的超管）
            const user = await createTestUser()
            const ur = await testPrisma.userRoles.create({
                data: { userId: user.id, roleId: superAdminRoleId },
            })
            cleanup = { userIds: [user.id], roleIds: [], userRoleIds: [ur.id] }

            const result = await ensureSuperAdminRemainingGuard(undefined, user.id)
            expect(result.ok).toBe(true)
        })
    })
})
