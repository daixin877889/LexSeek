/**
 * 公共资源配置生效性属性测试
 *
 * 使用 fast-check 进行属性测试，验证公共资源配置生效性
 *
 * **Feature: rbac-enhancement**
 * **Property 5: 公共资源配置生效性**
 * **Validates: Requirements 5.1, 5.3**
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import {
    testPrisma,
    connectTestDb,
    disconnectTestDb,
    resetDatabaseSequences,
} from '../membership/test-db-helper'

// 导入权限验证服务
import { validateUserApiPermission } from '../../../server/services/rbac/permission.service'
import { clearAllCache } from '../../../server/services/rbac/cache.service'

// ==================== 测试数据追踪 ====================

const createdPermissionIds: number[] = []

// ==================== 辅助函数 ====================

const generateUniqueId = () => {
    const timestamp = Date.now()
    const random = Math.floor(Math.random() * 1000000)
    const uuid = crypto.randomUUID().replace(/-/g, '').substring(0, 8)
    return `${timestamp}_${random}_${uuid}`
}

const createTestPermission = async (path: string, method: string, isPublic: boolean) => {
    const permission = await testPrisma.apiPermissions.create({
        data: {
            path,
            method,
            name: `测试权限_${generateUniqueId()}`,
            isPublic,
            status: 1,
        },
    })
    createdPermissionIds.push(permission.id)
    return permission
}

const cleanupTestData = async () => {
    clearAllCache()
    if (createdPermissionIds.length > 0) {
        await testPrisma.apiPermissions.deleteMany({
            where: { id: { in: createdPermissionIds } },
        })
        createdPermissionIds.length = 0
    }
}

// ==================== 测试套件 ====================

describe('公共资源配置生效性属性测试', () => {
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
        createdPermissionIds.length = 0
    })

    afterEach(async () => {
        await cleanupTestData()
    })

    describe('Property 5: 公共资源配置生效性', () => {
        it('公开 API 应允许未登录用户访问', async () => {
            const uniqueId = generateUniqueId()
            const path = `/api/v1/public/test/${uniqueId}`

            // 创建公开 API 权限
            await createTestPermission(path, 'GET', true)

            // 验证未登录用户可以访问
            const result = await validateUserApiPermission(null, path, 'GET')

            expect(result.allowed).toBe(true)
            expect(result.reason).toBe('public_api')
        })

        it('非公开 API 应拒绝未登录用户访问', async () => {
            const uniqueId = generateUniqueId()
            const path = `/api/v1/private/test/${uniqueId}`

            // 创建非公开 API 权限
            await createTestPermission(path, 'GET', false)

            // 验证未登录用户不能访问
            const result = await validateUserApiPermission(null, path, 'GET')

            expect(result.allowed).toBe(false)
            expect(result.reason).toBe('not_authenticated')
        })

        it('将 API 从非公开改为公开后应立即生效', async () => {
            const uniqueId = generateUniqueId()
            const path = `/api/v1/toggle/test/${uniqueId}`

            // 创建非公开 API 权限
            const permission = await createTestPermission(path, 'GET', false)

            // 验证未登录用户不能访问
            let result = await validateUserApiPermission(null, path, 'GET')
            expect(result.allowed).toBe(false)

            // 清除缓存
            clearAllCache()

            // 将 API 改为公开
            await testPrisma.apiPermissions.update({
                where: { id: permission.id },
                data: { isPublic: true },
            })

            // 验证未登录用户现在可以访问
            result = await validateUserApiPermission(null, path, 'GET')
            expect(result.allowed).toBe(true)
            expect(result.reason).toBe('public_api')
        })

        it('将 API 从公开改为非公开后应立即生效', async () => {
            const uniqueId = generateUniqueId()
            const path = `/api/v1/toggle2/test/${uniqueId}`

            // 创建公开 API 权限
            const permission = await createTestPermission(path, 'GET', true)

            // 验证未登录用户可以访问
            let result = await validateUserApiPermission(null, path, 'GET')
            expect(result.allowed).toBe(true)

            // 清除缓存
            clearAllCache()

            // 将 API 改为非公开
            await testPrisma.apiPermissions.update({
                where: { id: permission.id },
                data: { isPublic: false },
            })

            // 验证未登录用户现在不能访问
            result = await validateUserApiPermission(null, path, 'GET')
            expect(result.allowed).toBe(false)
            expect(result.reason).toBe('not_authenticated')
        })

        it('禁用的公开 API 不应允许访问', async () => {
            const uniqueId = generateUniqueId()
            const path = `/api/v1/disabled/test/${uniqueId}`

            // 创建公开但禁用的 API 权限
            await testPrisma.apiPermissions.create({
                data: {
                    path,
                    method: 'GET',
                    name: `测试权限_${uniqueId}`,
                    isPublic: true,
                    status: 0, // 禁用
                },
            }).then(p => createdPermissionIds.push(p.id))

            // 验证未登录用户不能访问（因为 API 被禁用）
            const result = await validateUserApiPermission(null, path, 'GET')

            // 禁用的 API 不会出现在公开列表中
            expect(result.allowed).toBe(false)
        })

        it('已删除的公开 API 不应允许访问', async () => {
            const uniqueId = generateUniqueId()
            const path = `/api/v1/deleted/test/${uniqueId}`

            // 创建公开但已删除的 API 权限
            await testPrisma.apiPermissions.create({
                data: {
                    path,
                    method: 'GET',
                    name: `测试权限_${uniqueId}`,
                    isPublic: true,
                    status: 1,
                    deletedAt: new Date(), // 已删除
                },
            }).then(p => createdPermissionIds.push(p.id))

            // 验证未登录用户不能访问（因为 API 已删除）
            const result = await validateUserApiPermission(null, path, 'GET')

            // 已删除的 API 不会出现在公开列表中
            expect(result.allowed).toBe(false)
        })
    })
})
