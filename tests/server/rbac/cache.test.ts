/**
 * 权限缓存服务属性测试
 *
 * 使用 fast-check 进行属性测试，验证缓存一致性
 *
 * **Feature: rbac-enhancement**
 * **Property 10: 缓存一致性**
 * **Validates: Requirements 10.1, 10.2, 10.3, 10.4**
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fc from 'fast-check'

// 导入缓存服务函数
import {
    getUserPermissionCache,
    setUserPermissionCache,
    clearUserPermissionCache,
    clearAllUserPermissionCache,
    clearUserPermissionCacheBatch,
    getPublicApiPermissionCache,
    setPublicApiPermissionCache,
    clearPublicApiPermissionCache,
    getCacheStats,
    clearAllCache,
    type UserPermissionCache,
    type PublicApiPermissionCache,
} from '../../../server/services/rbac/cache.service'

// ==================== 生成器 ====================

/** 用户 ID 生成器 */
const userIdArb = fc.integer({ min: 1, max: 100000 })

/** API 权限生成器 */
const apiPermissionArb = fc.record({
    id: fc.integer({ min: 1, max: 100000 }),
    path: fc.stringMatching(/^\/api\/v1\/[a-z]+$/),
    method: fc.constantFrom('GET', 'POST', 'PUT', 'DELETE'),
})

/** 路由权限生成器 */
const routePermissionArb = fc.stringMatching(/^\/[a-z]+(?:\/[a-z]+)*$/)

/** 用户权限缓存数据生成器 */
const userPermissionCacheArb = fc.record({
    apiPermissions: fc.array(apiPermissionArb, { minLength: 0, maxLength: 5 }),
    routePermissions: fc.array(routePermissionArb, { minLength: 0, maxLength: 5 }),
    isSuperAdmin: fc.boolean(),
})

/** 公共 API 权限生成器 */
const publicApiPermissionArb = fc.record({
    path: fc.stringMatching(/^\/api\/v1\/[a-z]+$/),
    method: fc.constantFrom('GET', 'POST', 'PUT', 'DELETE', '*'),
})

// ==================== 测试套件 ====================

describe('权限缓存服务属性测试', () => {
    beforeEach(() => {
        // 每个测试前清除所有缓存
        clearAllCache()
    })

    afterEach(() => {
        // 每个测试后清除所有缓存
        clearAllCache()
    })

    describe('Property 10: 缓存一致性', () => {
        describe('用户权限缓存', () => {
            it('设置的缓存应能被正确读取', () => {
                fc.assert(
                    fc.property(
                        userIdArb,
                        userPermissionCacheArb,
                        (userId, cacheData) => {
                            // 设置缓存
                            setUserPermissionCache(userId, cacheData)

                            // 读取缓存
                            const cached = getUserPermissionCache(userId)

                            // 验证
                            expect(cached).not.toBeNull()
                            expect(cached!.apiPermissions).toEqual(cacheData.apiPermissions)
                            expect(cached!.routePermissions).toEqual(cacheData.routePermissions)
                            expect(cached!.isSuperAdmin).toBe(cacheData.isSuperAdmin)
                        }
                    ),
                    { numRuns: 20 }
                )
            })

            it('清除缓存后应返回 null', () => {
                fc.assert(
                    fc.property(
                        userIdArb,
                        userPermissionCacheArb,
                        (userId, cacheData) => {
                            // 设置缓存
                            setUserPermissionCache(userId, cacheData)

                            // 验证缓存存在
                            expect(getUserPermissionCache(userId)).not.toBeNull()

                            // 清除缓存
                            clearUserPermissionCache(userId)

                            // 验证缓存已清除
                            expect(getUserPermissionCache(userId)).toBeNull()
                        }
                    ),
                    { numRuns: 20 }
                )
            })

            it('批量清除缓存应正确清除所有指定用户', () => {
                // 设置多个用户的缓存
                const userIds = [1, 2, 3, 4, 5]
                const cacheData: UserPermissionCache = {
                    apiPermissions: [],
                    routePermissions: [],
                    isSuperAdmin: false,
                }

                for (const userId of userIds) {
                    setUserPermissionCache(userId, cacheData)
                }

                // 验证所有缓存存在
                for (const userId of userIds) {
                    expect(getUserPermissionCache(userId)).not.toBeNull()
                }

                // 批量清除部分用户
                clearUserPermissionCacheBatch([1, 3, 5])

                // 验证清除结果
                expect(getUserPermissionCache(1)).toBeNull()
                expect(getUserPermissionCache(2)).not.toBeNull()
                expect(getUserPermissionCache(3)).toBeNull()
                expect(getUserPermissionCache(4)).not.toBeNull()
                expect(getUserPermissionCache(5)).toBeNull()
            })

            it('清除所有缓存应清除所有用户', () => {
                // 设置多个用户的缓存
                const userIds = [1, 2, 3]
                const cacheData: UserPermissionCache = {
                    apiPermissions: [],
                    routePermissions: [],
                    isSuperAdmin: false,
                }

                for (const userId of userIds) {
                    setUserPermissionCache(userId, cacheData)
                }

                // 清除所有缓存
                clearAllUserPermissionCache()

                // 验证所有缓存已清除
                for (const userId of userIds) {
                    expect(getUserPermissionCache(userId)).toBeNull()
                }
            })

            it('缓存过期后应返回 null', async () => {
                const userId = 1
                const cacheData: UserPermissionCache = {
                    apiPermissions: [],
                    routePermissions: [],
                    isSuperAdmin: false,
                }

                // 设置 100ms 过期的缓存
                setUserPermissionCache(userId, cacheData, 100)

                // 立即读取应该存在
                expect(getUserPermissionCache(userId)).not.toBeNull()

                // 等待过期
                await new Promise(resolve => setTimeout(resolve, 150))

                // 过期后应返回 null
                expect(getUserPermissionCache(userId)).toBeNull()
            })
        })

        describe('公共 API 权限缓存', () => {
            it('设置的公共权限缓存应能被正确读取', () => {
                fc.assert(
                    fc.property(
                        fc.array(publicApiPermissionArb, { minLength: 1, maxLength: 5 }),
                        (permissions) => {
                            // 设置缓存
                            setPublicApiPermissionCache(permissions)

                            // 读取缓存
                            const cached = getPublicApiPermissionCache()

                            // 验证
                            expect(cached).not.toBeNull()
                            expect(cached!.length).toBe(permissions.length)
                            for (let i = 0; i < permissions.length; i++) {
                                expect(cached![i].path).toBe(permissions[i].path)
                                expect(cached![i].method).toBe(permissions[i].method)
                            }
                        }
                    ),
                    { numRuns: 20 }
                )
            })

            it('清除公共权限缓存后应返回 null', () => {
                const permissions: PublicApiPermissionCache[] = [
                    { path: '/api/v1/health', method: 'GET' },
                ]

                // 设置缓存
                setPublicApiPermissionCache(permissions)

                // 验证缓存存在
                expect(getPublicApiPermissionCache()).not.toBeNull()

                // 清除缓存
                clearPublicApiPermissionCache()

                // 验证缓存已清除
                expect(getPublicApiPermissionCache()).toBeNull()
            })

            it('公共权限缓存过期后应返回 null', async () => {
                const permissions: PublicApiPermissionCache[] = [
                    { path: '/api/v1/health', method: 'GET' },
                ]

                // 设置 100ms 过期的缓存
                setPublicApiPermissionCache(permissions, 100)

                // 立即读取应该存在
                expect(getPublicApiPermissionCache()).not.toBeNull()

                // 等待过期
                await new Promise(resolve => setTimeout(resolve, 150))

                // 过期后应返回 null
                expect(getPublicApiPermissionCache()).toBeNull()
            })
        })

        describe('缓存统计', () => {
            it('缓存统计应正确反映缓存状态', () => {
                // 初始状态
                let stats = getCacheStats()
                expect(stats.userPermissionCacheSize).toBe(0)
                expect(stats.hasPublicApiPermissionCache).toBe(false)

                // 添加用户缓存
                setUserPermissionCache(1, {
                    apiPermissions: [],
                    routePermissions: [],
                    isSuperAdmin: false,
                })
                setUserPermissionCache(2, {
                    apiPermissions: [],
                    routePermissions: [],
                    isSuperAdmin: false,
                })

                stats = getCacheStats()
                expect(stats.userPermissionCacheSize).toBe(2)

                // 添加公共权限缓存
                setPublicApiPermissionCache([{ path: '/api/v1/health', method: 'GET' }])

                stats = getCacheStats()
                expect(stats.hasPublicApiPermissionCache).toBe(true)
                expect(stats.publicApiPermissionCacheExpired).toBe(false)
            })
        })

        describe('全局缓存清除', () => {
            it('clearAllCache 应清除所有缓存', () => {
                // 设置各种缓存
                setUserPermissionCache(1, {
                    apiPermissions: [],
                    routePermissions: [],
                    isSuperAdmin: false,
                })
                setPublicApiPermissionCache([{ path: '/api/v1/health', method: 'GET' }])

                // 验证缓存存在
                expect(getUserPermissionCache(1)).not.toBeNull()
                expect(getPublicApiPermissionCache()).not.toBeNull()

                // 清除所有缓存
                clearAllCache()

                // 验证所有缓存已清除
                expect(getUserPermissionCache(1)).toBeNull()
                expect(getPublicApiPermissionCache()).toBeNull()
            })
        })
    })
})
