/**
 * 权限验证服务
 * 
 * 提供 API 权限和路由权限的验证功能
 * 集成缓存服务以提高性能
 */
import type { Prisma } from "#shared/types/prisma"
import type { UserPermissions } from "#shared/types/rbac"

// 导入缓存服务函数（用于测试环境兼容）
import {
    getUserPermissionCache,
    setUserPermissionCache,
    clearUserPermissionCache,
    clearUserPermissionCacheBatch,
    getPublicApiPermissionCache,
    setPublicApiPermissionCache,
    clearPublicApiPermissionCache,
} from './cache.service'

// 导入 DAO 函数（用于测试环境兼容）
import { findUserApiPermissionsDao } from './roleApiPermission.dao'
import { findPublicApiPermissionsDao } from './apiPermission.dao'

// 导入路径匹配函数（用于测试环境兼容）
import { matchPath, findMatchingPermission } from './pathMatcher'

// ==================== 常量定义 ====================

/** 超级管理员角色代码 */
const SUPER_ADMIN_ROLE_CODE = 'super_admin'

// ==================== 类型定义 ====================

/** 权限验证结果 */
export interface PermissionCheckResult {
    allowed: boolean
    reason?: string
}

// ==================== 辅助函数 ====================

/**
 * 检查用户是否为超级管理员
 */
export const checkIsSuperAdmin = async (
    userId: number,
    tx?: Prisma.TransactionClient
): Promise<boolean> => {
    const userRoles = await (tx || prisma).userRoles.findMany({
        where: { userId },
        include: {
            role: {
                select: { code: true, status: true, deletedAt: true },
            },
        },
    })

    return userRoles.some(
        ur => ur.role.code === SUPER_ADMIN_ROLE_CODE &&
            ur.role.status === 1 &&
            ur.role.deletedAt === null
    )
}

/**
 * 获取用户的路由权限列表
 */
const getUserRoutePermissions = async (
    userId: number,
    tx?: Prisma.TransactionClient
): Promise<string[]> => {
    const userRoles = await (tx || prisma).userRoles.findMany({
        where: { userId },
        include: {
            role: {
                select: {
                    status: true,
                    deletedAt: true,
                    roleRouters: {
                        include: {
                            router: {
                                select: { path: true },
                            },
                        },
                    },
                },
            },
        },
    })

    const routes = new Set<string>()
    for (const ur of userRoles) {
        if (ur.role.status === 1 && ur.role.deletedAt === null) {
            for (const rr of ur.role.roleRouters) {
                routes.add(rr.router.path)
            }
        }
    }

    return Array.from(routes)
}

// ==================== 权限获取 ====================

/**
 * 获取用户完整权限信息
 * 优先从缓存获取，缓存未命中则查询数据库
 */
export const getUserPermissions = async (
    userId: number,
    tx?: Prisma.TransactionClient
): Promise<UserPermissions> => {
    // 尝试从缓存获取
    const cached = getUserPermissionCache(userId)
    if (cached) {
        return cached
    }

    // 查询数据库
    const [isSuperAdmin, apiPermissions, routePermissions] = await Promise.all([
        checkIsSuperAdmin(userId, tx),
        findUserApiPermissionsDao(userId, tx),
        getUserRoutePermissions(userId, tx),
    ])

    const permissions: UserPermissions = {
        apiPermissions: apiPermissions.map(p => ({
            id: p.id,
            path: p.path,
            method: p.method,
        })),
        routePermissions,
        isSuperAdmin,
    }

    // 写入缓存
    setUserPermissionCache(userId, permissions)

    return permissions
}

/**
 * 获取公共 API 权限列表
 * 优先从缓存获取
 */
export const getPublicApiPermissions = async (
    tx?: Prisma.TransactionClient
): Promise<Array<{ path: string; method: string }>> => {
    // 尝试从缓存获取
    const cached = getPublicApiPermissionCache()
    if (cached) {
        return cached
    }

    // 查询数据库
    const permissions = await findPublicApiPermissionsDao(tx)

    // 写入缓存
    setPublicApiPermissionCache(permissions)

    return permissions
}

// ==================== API 权限验证 ====================

/**
 * 验证用户是否有访问指定 API 的权限
 * 
 * 验证顺序：
 * 1. 检查是否为公开 API
 * 2. 检查用户是否为超级管理员
 * 3. 检查用户是否拥有该 API 权限
 */
export const validateUserApiPermission = async (
    userId: number | null,
    requestPath: string,
    requestMethod: string,
    tx?: Prisma.TransactionClient
): Promise<PermissionCheckResult> => {
    // 1. 检查是否为公开 API
    const publicPermissions = await getPublicApiPermissions(tx)
    const isPublic = findMatchingPermission(publicPermissions, requestPath, requestMethod)
    if (isPublic) {
        return { allowed: true, reason: 'public_api' }
    }

    // 未登录用户无法访问非公开 API
    if (!userId) {
        return { allowed: false, reason: 'not_authenticated' }
    }

    // 2. 获取用户权限
    const userPermissions = await getUserPermissions(userId, tx)

    // 3. 检查是否为超级管理员
    if (userPermissions.isSuperAdmin) {
        return { allowed: true, reason: 'super_admin' }
    }

    // 4. 检查用户是否拥有该 API 权限
    const hasPermission = findMatchingPermission(
        userPermissions.apiPermissions,
        requestPath,
        requestMethod
    )
    if (hasPermission) {
        return { allowed: true, reason: 'has_permission' }
    }

    return { allowed: false, reason: 'no_permission' }
}

// ==================== 路由权限验证 ====================

/**
 * 验证用户是否有访问指定路由的权限
 */
export const validateUserRoutePermission = async (
    userId: number,
    routePath: string,
    tx?: Prisma.TransactionClient
): Promise<PermissionCheckResult> => {
    const userPermissions = await getUserPermissions(userId, tx)

    // 超级管理员拥有所有路由权限
    if (userPermissions.isSuperAdmin) {
        return { allowed: true, reason: 'super_admin' }
    }

    // 检查是否拥有该路由权限
    const hasPermission = userPermissions.routePermissions.some(
        route => matchPath(route, routePath)
    )
    if (hasPermission) {
        return { allowed: true, reason: 'has_permission' }
    }

    return { allowed: false, reason: 'no_permission' }
}

// ==================== 权限刷新 ====================

/**
 * 刷新用户权限缓存
 * 当用户角色或权限变更时调用
 */
export const refreshUserPermissions = async (
    userId: number,
    tx?: Prisma.TransactionClient
): Promise<UserPermissions> => {
    // 清除缓存
    clearUserPermissionCache(userId)

    // 重新获取权限（会自动写入缓存）
    return getUserPermissions(userId, tx)
}

/**
 * 刷新公共 API 权限缓存
 * 当公共 API 配置变更时调用
 */
export const refreshPublicApiPermissions = async (
    tx?: Prisma.TransactionClient
): Promise<Array<{ path: string; method: string }>> => {
    // 清除缓存
    clearPublicApiPermissionCache()

    // 重新获取权限（会自动写入缓存）
    return getPublicApiPermissions(tx)
}

/**
 * 批量刷新用户权限缓存
 * 当角色权限变更时，刷新所有拥有该角色的用户
 */
export const refreshRoleUsersPermissions = async (
    roleId: number,
    tx?: Prisma.TransactionClient
): Promise<void> => {
    // 获取拥有该角色的所有用户
    const userRoles = await (tx || prisma).userRoles.findMany({
        where: { roleId },
        select: { userId: true },
    })

    const userIds = userRoles.map(ur => ur.userId)
    clearUserPermissionCacheBatch(userIds)
}
