/**
 * 批量权限状态更新属性测试
 *
 * 使用 fast-check 进行属性测试，验证批量权限状态更新功能
 *
 * **Feature: rbac-enhancement**
 * **Property 7: 批量权限状态更新**
 * **Validates: Requirements 7.4**
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import * as fc from 'fast-check'
import {
    testPrisma,
    connectTestDb,
    disconnectTestDb,
    resetDatabaseSequences,
} from '../membership/test-db-helper'

// 导入 DAO 函数
import { updateApiPermissionsPublicStatusDao } from '../../../server/services/rbac/apiPermission.dao'

// ==================== 测试数据追踪 ====================

const createdPermissionIds: number[] = []

// ==================== 辅助函数 ====================

const generateUniqueId = () => {
    const timestamp = Date.now()
    const random = Math.floor(Math.random() * 1000000)
    const uuid = crypto.randomUUID().replace(/-/g, '').substring(0, 8)
    return `${timestamp}_${random}_${uuid}`
}

const createTestPermission = async (isPublic = false) => {
    const uniqueId = generateUniqueId()
    const permission = await testPrisma.apiPermissions.create({
        data: {
            path: `/api/v1/test/batch/${uniqueId}`,
            method: 'GET',
            name: `测试权限_${uniqueId}`,
            isPublic,
            status: 1,
        },
    })
    createdPermissionIds.push(permission.id)
    return permission
}

const cleanupTestData = async () => {
    if (createdPermissionIds.length > 0) {
        await testPrisma.apiPermissions.deleteMany({
            where: { id: { in: createdPermissionIds } },
        })
        createdPermissionIds.length = 0
    }
}

// ==================== 测试套件 ====================

describe('批量权限状态更新属性测试', () => {
    beforeAll(async () => {
        await connectTestDb()
        await resetDatabaseSequences()
    })

    afterAll(async () => {
        await cleanupTestData()
        await disconnectTestDb()
    })

    beforeEach(() => {
        createdPermissionIds.length = 0
    })

    afterEach(async () => {
        await cleanupTestData()
    })

    describe('Property 7: 批量权限状态更新', () => {
        it('批量设置权限为公开状态', async () => {
            // 创建多个非公开权限
            const permissions = await Promise.all([
                createTestPermission(false),
                createTestPermission(false),
                createTestPermission(false),
            ])
            const ids = permissions.map(p => p.id)

            // 批量设置为公开
            await updateApiPermissionsPublicStatusDao(ids, true)

            // 验证所有权限都变为公开
            const updated = await testPrisma.apiPermissions.findMany({
                where: { id: { in: ids } },
            })

            for (const perm of updated) {
                expect(perm.isPublic).toBe(true)
            }
        })

        it('批量设置权限为非公开状态', async () => {
            // 创建多个公开权限
            const permissions = await Promise.all([
                createTestPermission(true),
                createTestPermission(true),
                createTestPermission(true),
            ])
            const ids = permissions.map(p => p.id)

            // 批量设置为非公开
            await updateApiPermissionsPublicStatusDao(ids, false)

            // 验证所有权限都变为非公开
            const updated = await testPrisma.apiPermissions.findMany({
                where: { id: { in: ids } },
            })

            for (const perm of updated) {
                expect(perm.isPublic).toBe(false)
            }
        })

        it('批量更新应只影响指定的权限', async () => {
            // 创建权限：2个要更新，1个不更新
            const toUpdate = await Promise.all([
                createTestPermission(false),
                createTestPermission(false),
            ])
            const notToUpdate = await createTestPermission(false)

            const updateIds = toUpdate.map(p => p.id)

            // 批量更新
            await updateApiPermissionsPublicStatusDao(updateIds, true)

            // 验证更新的权限
            const updated = await testPrisma.apiPermissions.findMany({
                where: { id: { in: updateIds } },
            })
            for (const perm of updated) {
                expect(perm.isPublic).toBe(true)
            }

            // 验证未更新的权限
            const unchanged = await testPrisma.apiPermissions.findUnique({
                where: { id: notToUpdate.id },
            })
            expect(unchanged?.isPublic).toBe(false)
        })

        it('空数组不应影响任何权限', async () => {
            // 创建权限
            const permission = await createTestPermission(false)

            // 批量更新空数组
            await updateApiPermissionsPublicStatusDao([], true)

            // 验证权限未变化
            const unchanged = await testPrisma.apiPermissions.findUnique({
                where: { id: permission.id },
            })
            expect(unchanged?.isPublic).toBe(false)
        })

        it('批量更新应更新 updatedAt 时间戳', async () => {
            // 创建权限
            const permission = await createTestPermission(false)
            const originalUpdatedAt = permission.updatedAt

            // 等待一小段时间确保时间戳不同
            await new Promise(resolve => setTimeout(resolve, 10))

            // 批量更新
            await updateApiPermissionsPublicStatusDao([permission.id], true)

            // 验证时间戳已更新
            const updated = await testPrisma.apiPermissions.findUnique({
                where: { id: permission.id },
            })
            expect(updated?.updatedAt?.getTime()).toBeGreaterThan(originalUpdatedAt?.getTime() || 0)
        })
    })

    describe('属性测试 - 随机数据', () => {
        it('任意数量的权限批量更新都应成功', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 5 }),
                    fc.boolean(),
                    async (count, isPublic) => {
                        // 创建指定数量的权限
                        const permissions = await Promise.all(
                            Array.from({ length: count }, () => createTestPermission(!isPublic))
                        )
                        const ids = permissions.map(p => p.id)

                        // 批量更新
                        await updateApiPermissionsPublicStatusDao(ids, isPublic)

                        // 验证所有权限状态正确
                        const updated = await testPrisma.apiPermissions.findMany({
                            where: { id: { in: ids } },
                        })

                        for (const perm of updated) {
                            expect(perm.isPublic).toBe(isPublic)
                        }
                    }
                ),
                { numRuns: 10 }
            )
        })
    })
})
