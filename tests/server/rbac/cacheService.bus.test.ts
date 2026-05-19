/**
 * RBAC 权限缓存接入失效总线测试
 *
 * **Feature: cache-invalidation**
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
    getUserPermissionCache,
    setUserPermissionCache,
    clearUserPermissionCache,
    clearUserPermissionCacheBatch,
    getPublicApiPermissionCache,
    setPublicApiPermissionCache,
    clearPublicApiPermissionCache,
} from '~~/server/services/rbac/cache.service'
import { dispatchInvalidationMessage } from '~~/server/utils/cacheInvalidationBus'

const sampleUserCache = { apiPermissions: [], routePermissions: [], isSuperAdmin: false }

describe('RBAC 用户权限缓存接入失效总线', () => {
    beforeEach(() => {
        clearUserPermissionCacheBatch([1, 2, 3])
    })

    it('收到 rbacUserPermission 单条广播时清对应用户', () => {
        setUserPermissionCache(1, sampleUserCache)
        setUserPermissionCache(2, sampleUserCache)
        dispatchInvalidationMessage(JSON.stringify({
            cacheName: 'rbacUserPermission', keys: ['1'],
        }))
        expect(getUserPermissionCache(1)).toBeNull()
        expect(getUserPermissionCache(2)).not.toBeNull()
    })

    it('收到 rbacUserPermission 全清广播时清空所有用户', () => {
        setUserPermissionCache(1, sampleUserCache)
        setUserPermissionCache(2, sampleUserCache)
        dispatchInvalidationMessage(JSON.stringify({ cacheName: 'rbacUserPermission' }))
        expect(getUserPermissionCache(1)).toBeNull()
        expect(getUserPermissionCache(2)).toBeNull()
    })

    it('clearUserPermissionCache 仍正确清本地', () => {
        setUserPermissionCache(3, sampleUserCache)
        clearUserPermissionCache(3)
        expect(getUserPermissionCache(3)).toBeNull()
    })
})

describe('RBAC 公开 API 权限缓存接入失效总线', () => {
    beforeEach(() => {
        clearPublicApiPermissionCache()
    })

    it('收到 rbacPublicApi 广播时清空公开权限缓存', () => {
        setPublicApiPermissionCache([{ path: '/api/v1/x', method: 'GET' }])
        dispatchInvalidationMessage(JSON.stringify({ cacheName: 'rbacPublicApi' }))
        expect(getPublicApiPermissionCache()).toBeNull()
    })
})
