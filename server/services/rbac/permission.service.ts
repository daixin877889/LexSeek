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
import type { apiPermissions, userRoles } from '~~/generated/prisma/client'

// ==================== 常量定义 ====================

/** 超级管理员角色代码 */
export const SUPER_ADMIN_ROLE_CODE = 'super_admin'

/**
 * 缓存 super_admin role id（运行时第一次查 DB 命中后缓存住），避免每次请求
 * 都做 code='super_admin' 字符串匹配。也方便其他模块以 ID 形式做兜底校验。
 *
 * M4 防御深度：将来即使有人在 admin 后台改了 super_admin 的 code 字段（虽然
 * roles/[id].put.ts 已经禁止改 code），ID 不会变，超管识别不会失效。
 */
let cachedSuperAdminRoleId: number | null = null

const getSuperAdminRoleIdCached = async (
    tx?: Prisma.TransactionClient,
): Promise<number | null> => {
    if (cachedSuperAdminRoleId != null) {
        return cachedSuperAdminRoleId
    }
    const role = await (tx || prisma).roles.findFirst({
        where: { code: SUPER_ADMIN_ROLE_CODE, deletedAt: null },
        select: { id: true },
    })
    if (role) {
        cachedSuperAdminRoleId = role.id
    }
    return cachedSuperAdminRoleId
}

/** 测试 / 异常恢复时使用：清除缓存的 super_admin role id */
export const clearSuperAdminRoleIdCache = (): void => {
    cachedSuperAdminRoleId = null
}

// ==================== 类型定义 ====================

/** 权限验证结果 */
export interface PermissionCheckResult {
    allowed: boolean
    reason?: string
}

// ==================== 辅助函数 ====================

/**
 * 检查用户是否为超级管理员
 *
 * 安全相关函数采用纵深防御：
 *   1) db where 过滤：userRoles.deletedAt:null + role.code/status/deletedAt 严格匹配，性能与正确性的第一道关；
 *   2) JS 层 some() 二次校验：兜底防御 db 层过滤被绕过的极端情况（例如未来切到 mock 实现 / 测试环境）。
 * 撤销 super_admin 角色无论是 hard delete 还是 soft delete，都绝对不能让已撤销的角色继续生效。
 */
export const checkIsSuperAdmin = async (
    userId: number,
    tx?: Prisma.TransactionClient
): Promise<boolean> => {
    const userRoles = await (tx || prisma).userRoles.findMany({
        where: {
            userId,
            deletedAt: null,
            role: {
                code: SUPER_ADMIN_ROLE_CODE,
                status: 1,
                deletedAt: null,
            },
        },
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
 *
 * 必须从 4 个维度过滤掉已注销的数据：
 * 1) userRoles.deletedAt:null  关联软删
 * 2) role.status:1, role.deletedAt:null  角色已注销
 * 3) roleRouters.deletedAt:null  路由授权关联软删
 * 4) router.deletedAt:null  路由本身软删
 *
 * 用 where 子句一次性过滤干净，避免 JS 层手工 filter（容易漏一层）。
 */
const getUserRoutePermissions = async (
    userId: number,
    tx?: Prisma.TransactionClient
): Promise<string[]> => {
    const userRoles = await (tx || prisma).userRoles.findMany({
        where: {
            userId,
            deletedAt: null,
            role: {
                status: 1,
                deletedAt: null,
            },
        },
        include: {
            role: {
                select: {
                    roleRouters: {
                        where: {
                            deletedAt: null,
                            router: { deletedAt: null },
                        },
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
        for (const rr of ur.role.roleRouters) {
            routes.add(rr.router.path)
        }
    }

    return Array.from(routes)
}

// ==================== 权限获取 ====================

/**
 * 获取用户完整权限信息
 * 优先从缓存获取，缓存未命中则查询数据库
 *
 * 超级管理员放行兜底：isSuperAdmin=true 时返回所有启用的 API 权限
 * 和路由路径，避免下游依赖 apiPermissions/routePermissions 数组的代码
 * 因未显式分配而失效（例如新增 API/路由后超管不可见）。
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

    const client = tx || prisma
    const isSuperAdmin = await checkIsSuperAdmin(userId, tx)

    let apiPermissions: UserPermissions['apiPermissions']
    let routePermissions: string[]

    if (isSuperAdmin) {
        // 超级管理员：一次性返回所有启用的 API 权限和路由路径
        const [allApis, allRouters] = await Promise.all([
            client.apiPermissions.findMany({
                where: { status: 1, deletedAt: null },
                select: { id: true, path: true, method: true },
            }),
            client.routers.findMany({
                where: { deletedAt: null },
                select: { path: true },
            }),
        ])
        apiPermissions = allApis
        routePermissions = Array.from(new Set(allRouters.map(r => r.path)))
    } else {
        const [userApis, userRoutes] = await Promise.all([
            findUserApiPermissionsDao(userId, tx),
            getUserRoutePermissions(userId, tx),
        ])
        apiPermissions = userApis.map(p => ({
            id: p.id,
            path: p.path,
            method: p.method,
        }))
        routePermissions = userRoutes
    }

    const permissions: UserPermissions = {
        apiPermissions,
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
    // 获取拥有该角色的所有用户：过滤掉软删的 user-role 关联，
    // 避免给已经离开该角色的用户白白刷一次缓存。
    const userRoles = await (tx || prisma).userRoles.findMany({
        where: { roleId, deletedAt: null },
        select: { userId: true },
    })

    const userIds = userRoles.map(ur => ur.userId)
    clearUserPermissionCacheBatch(userIds)
}
