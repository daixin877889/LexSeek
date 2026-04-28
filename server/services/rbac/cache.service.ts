/**
 * 权限缓存服务
 * 
 * 提供用户权限和公共资源的内存缓存，减少数据库查询
 * 默认缓存过期时间为 5 分钟
 */

// ==================== 类型定义 ====================

/** 缓存项 */
interface CacheItem<T> {
    data: T
    expiredAt: number
}

/** 用户权限缓存数据 */
export interface UserPermissionCache {
    apiPermissions: Array<{
        id: number
        path: string
        method: string
    }>
    routePermissions: string[]
    isSuperAdmin: boolean
}

/** 公共 API 权限缓存数据 */
export interface PublicApiPermissionCache {
    path: string
    method: string
}

// ==================== 缓存配置 ====================

/**
 * 默认缓存过期时间（毫秒）- 60 秒
 *
 * 历史值是 5 分钟，但 RBAC 是安全敏感缓存——撤权后 5 分钟仍然生效不可接受
 * （多实例部署时叠加问题更严重，因为单实例清缓存对其他实例无效）。
 * 缩短到 60 秒在性能与安全之间折衷：
 * - 单用户每分钟最多查 1 次 DB，QPS 影响可接受；
 * - 撤权 / 封禁最坏延迟从 5 分钟降到 1 分钟。
 *
 * 终态方案是切到 Redis + pub/sub 主动失效，留待 M1 后续迭代。
 */
const DEFAULT_CACHE_TTL = 60 * 1000

/** 用户权限缓存 */
const userPermissionCache = new Map<number, CacheItem<UserPermissionCache>>()

/** 公共 API 权限缓存 */
let publicApiPermissionCache: CacheItem<PublicApiPermissionCache[]> | null = null

// ==================== 用户权限缓存 ====================

/**
 * 获取用户权限缓存
 */
export const getUserPermissionCache = (userId: number): UserPermissionCache | null => {
    const item = userPermissionCache.get(userId)
    if (!item) {
        return null
    }

    // 检查是否过期
    if (Date.now() > item.expiredAt) {
        userPermissionCache.delete(userId)
        return null
    }

    return item.data
}

/**
 * 设置用户权限缓存
 */
export const setUserPermissionCache = (
    userId: number,
    data: UserPermissionCache,
    ttl: number = DEFAULT_CACHE_TTL
): void => {
    userPermissionCache.set(userId, {
        data,
        expiredAt: Date.now() + ttl,
    })
}

/**
 * 清除指定用户的权限缓存
 */
export const clearUserPermissionCache = (userId: number): void => {
    userPermissionCache.delete(userId)
}

/**
 * 清除所有用户权限缓存
 */
export const clearAllUserPermissionCache = (): void => {
    userPermissionCache.clear()
}

/**
 * 批量清除用户权限缓存
 */
export const clearUserPermissionCacheBatch = (userIds: number[]): void => {
    for (const userId of userIds) {
        userPermissionCache.delete(userId)
    }
}

// ==================== 公共 API 权限缓存 ====================

/**
 * 获取公共 API 权限缓存
 */
export const getPublicApiPermissionCache = (): PublicApiPermissionCache[] | null => {
    if (!publicApiPermissionCache) {
        return null
    }

    // 检查是否过期
    if (Date.now() > publicApiPermissionCache.expiredAt) {
        publicApiPermissionCache = null
        return null
    }

    return publicApiPermissionCache.data
}

/**
 * 设置公共 API 权限缓存
 */
export const setPublicApiPermissionCache = (
    data: PublicApiPermissionCache[],
    ttl: number = DEFAULT_CACHE_TTL
): void => {
    publicApiPermissionCache = {
        data,
        expiredAt: Date.now() + ttl,
    }
}

/**
 * 清除公共 API 权限缓存
 */
export const clearPublicApiPermissionCache = (): void => {
    publicApiPermissionCache = null
}

// ==================== 缓存统计 ====================

/**
 * 获取缓存统计信息
 */
export const getCacheStats = () => {
    return {
        userPermissionCacheSize: userPermissionCache.size,
        hasPublicApiPermissionCache: publicApiPermissionCache !== null,
        publicApiPermissionCacheExpired: publicApiPermissionCache
            ? Date.now() > publicApiPermissionCache.expiredAt
            : true,
    }
}

/**
 * 清除所有缓存
 */
export const clearAllCache = (): void => {
    clearAllUserPermissionCache()
    clearPublicApiPermissionCache()
}
