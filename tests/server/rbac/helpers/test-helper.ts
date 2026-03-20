/**
 * RBAC 测试公共辅助模块
 *
 * 提取自多个 RBAC 测试文件中的重复代码，
 * 包含唯一标识符生成、测试数据工厂和清理工具。
 */

import {
    testPrisma,
    createTestUser,
    connectTestDb,
    disconnectTestDb,
    resetDatabaseSequences,
} from '../../membership/test-db-helper'
import { mockLogger } from '../../membership/test-setup'
import { createApiPermissionDao } from '../../../../server/services/rbac/apiPermission.dao'

// 重新导出常用依赖，减少测试文件中的导入行数
export {
    testPrisma,
    createTestUser,
    connectTestDb,
    disconnectTestDb,
    resetDatabaseSequences,
    mockLogger,
}

// ==================== 全局环境设置 ====================

/** 设置全局测试环境（prisma 和 logger），供服务层函数在测试中使用 */
export const setupGlobalTestEnv = () => {
    if (typeof window === 'undefined' && process.env.NODE_ENV === 'test') {
        ;(globalThis as any).prisma = testPrisma
        ;(globalThis as any).logger = mockLogger
    }
}

// ==================== 唯一标识符 ====================

/** 生成唯一标识符，避免与已有数据冲突 */
export const generateUniqueId = () => {
    const timestamp = Date.now()
    const random = Math.floor(Math.random() * 1000000)
    const uuid = crypto.randomUUID().replace(/-/g, '').substring(0, 8)
    return `${timestamp}_${random}_${uuid}`
}

// ==================== 测试数据工厂 ====================

/** 创建测试角色 */
export const createTestRole = async (name?: string, code?: string) => {
    const uniqueId = generateUniqueId()
    return testPrisma.roles.create({
        data: {
            name: name ?? `测试角色_${uniqueId}`,
            code: code ?? `TEST_ROLE_${uniqueId}`,
            description: '测试角色描述',
            status: 1,
        },
    })
}

/** 创建测试 API 权限（通过 DAO 层） */
export const createTestApiPermission = async (options?: {
    path?: string
    method?: string
    isPublic?: boolean
}) => {
    const uniqueId = generateUniqueId()
    return createApiPermissionDao({
        path: options?.path ?? `/api/v1/test/${uniqueId}`,
        method: options?.method ?? 'GET',
        name: `测试权限_${uniqueId}`,
        isPublic: options?.isPublic ?? false,
        status: 1,
    })
}

// ==================== RBAC 清理工具 ====================

/**
 * 清理 RBAC 测试数据（按正确的外键依赖顺序）
 *
 * 清理后自动重置传入的数组
 */
export const cleanupRbacTestData = async (data: {
    userRoleIds?: number[]
    roleIds?: number[]
    permissionIds?: number[]
    userIds?: number[]
}) => {
    // 1. 清理用户角色关联
    if (data.userRoleIds && data.userRoleIds.length > 0) {
        await testPrisma.userRoles.deleteMany({
            where: { id: { in: data.userRoleIds } },
        })
        data.userRoleIds.length = 0
    }

    // 2. 清理角色 API 权限关联（通过 roleId）
    if (data.roleIds && data.roleIds.length > 0) {
        await testPrisma.roleApiPermissions.deleteMany({
            where: { roleId: { in: data.roleIds } },
        })
    }

    // 3. 清理 API 权限
    if (data.permissionIds && data.permissionIds.length > 0) {
        await testPrisma.apiPermissions.deleteMany({
            where: { id: { in: data.permissionIds } },
        })
        data.permissionIds.length = 0
    }

    // 4. 清理角色
    if (data.roleIds && data.roleIds.length > 0) {
        await testPrisma.roles.deleteMany({
            where: { id: { in: data.roleIds } },
        })
        data.roleIds.length = 0
    }

    // 5. 清理用户
    if (data.userIds && data.userIds.length > 0) {
        await testPrisma.users.deleteMany({
            where: { id: { in: data.userIds } },
        })
        data.userIds.length = 0
    }
}
