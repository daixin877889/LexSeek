import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { UserPermissions } from '#shared/types/rbac'
import {
  checkIsSuperAdmin,
  getUserPermissions,
  getPublicApiPermissions,
  validateUserApiPermission,
  validateUserRoutePermission,
  refreshUserPermissions,
  refreshPublicApiPermissions,
  refreshRoleUsersPermissions,
} from '../../../server/services/rbac/permission.service'

// Mock dependencies
vi.mock('../../../server/services/rbac/cache.service', () => ({
  getUserPermissionCache: vi.fn(),
  setUserPermissionCache: vi.fn(),
  clearUserPermissionCache: vi.fn(),
  clearUserPermissionCacheBatch: vi.fn(),
  getPublicApiPermissionCache: vi.fn(),
  setPublicApiPermissionCache: vi.fn(),
  clearPublicApiPermissionCache: vi.fn(),
}))

vi.mock('../../../server/services/rbac/roleApiPermission.dao', () => ({
  findUserApiPermissionsDao: vi.fn(),
}))

vi.mock('../../../server/services/rbac/apiPermission.dao', () => ({
  findPublicApiPermissionsDao: vi.fn(),
}))

vi.mock('../../../server/services/rbac/pathMatcher', () => ({
  matchPath: vi.fn((pattern, path) => {
    if (pattern === path) return true
    if (pattern.includes('*')) {
      const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`)
      return regex.test(path)
    }
    return false
  }),
  findMatchingPermission: vi.fn((permissions, path, method) => {
    return permissions.some((p: any) => p.path === path && p.method === method)
  }),
}))

import {
  getUserPermissionCache,
  setUserPermissionCache,
  clearUserPermissionCache,
  clearUserPermissionCacheBatch,
  getPublicApiPermissionCache,
  setPublicApiPermissionCache,
  clearPublicApiPermissionCache,
} from '../../../server/services/rbac/cache.service'

import { findUserApiPermissionsDao } from '../../../server/services/rbac/roleApiPermission.dao'
import { findPublicApiPermissionsDao } from '../../../server/services/rbac/apiPermission.dao'
import { matchPath, findMatchingPermission } from '../../../server/services/rbac/pathMatcher'

describe('permission.service · 权限验证服务', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('checkIsSuperAdmin · 检查超级管理员', () => {
    it('应该返回 true 当用户是超级管理员', async () => {
      global.prisma = {
        userRoles: {
          findMany: vi.fn().mockResolvedValue([
            {
              role: {
                code: 'super_admin',
                status: 1,
                deletedAt: null,
              },
            },
          ]),
        },
      } as any

      const result = await checkIsSuperAdmin(1)

      expect(result).toBe(true)
    })

    it('应该返回 false 当用户没有超级管理员角色', async () => {
      global.prisma = {
        userRoles: {
          findMany: vi.fn().mockResolvedValue([
            {
              role: {
                code: 'user',
                status: 1,
                deletedAt: null,
              },
            },
          ]),
        },
      } as any

      const result = await checkIsSuperAdmin(1)

      expect(result).toBe(false)
    })

    it('应该返回 false 当超级管理员角色被删除', async () => {
      global.prisma = {
        userRoles: {
          findMany: vi.fn().mockResolvedValue([
            {
              role: {
                code: 'super_admin',
                status: 1,
                deletedAt: new Date(),
              },
            },
          ]),
        },
      } as any

      const result = await checkIsSuperAdmin(1)

      expect(result).toBe(false)
    })

    it('应该返回 false 当超级管理员角色被禁用', async () => {
      global.prisma = {
        userRoles: {
          findMany: vi.fn().mockResolvedValue([
            {
              role: {
                code: 'super_admin',
                status: 0,
                deletedAt: null,
              },
            },
          ]),
        },
      } as any

      const result = await checkIsSuperAdmin(1)

      expect(result).toBe(false)
    })
  })

  describe('getUserPermissions · 获取用户权限', () => {
    it('应该从缓存返回用户权限', async () => {
      const cachedPermissions: UserPermissions = {
        apiPermissions: [
          { id: 1, path: '/api/v1/cases', method: 'GET' },
        ],
        routePermissions: ['/dashboard'],
        isSuperAdmin: false,
      }

      vi.mocked(getUserPermissionCache).mockReturnValue(cachedPermissions)

      const result = await getUserPermissions(1)

      expect(result).toEqual(cachedPermissions)
      expect(getUserPermissionCache).toHaveBeenCalledWith(1)
    })

    it('应该为超级管理员返回所有 API 权限', async () => {
      vi.mocked(getUserPermissionCache).mockReturnValue(null)

      global.prisma = {
        userRoles: {
          findMany: vi.fn().mockResolvedValue([
            {
              role: {
                code: 'super_admin',
                status: 1,
                deletedAt: null,
              },
            },
          ]),
        },
        apiPermissions: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, path: '/api/v1/cases', method: 'GET' },
            { id: 2, path: '/api/v1/cases', method: 'POST' },
          ]),
        },
        routers: {
          findMany: vi.fn().mockResolvedValue([
            { path: '/dashboard' },
            { path: '/admin' },
          ]),
        },
      } as any

      const result = await getUserPermissions(1)

      expect(result.isSuperAdmin).toBe(true)
      expect(result.apiPermissions.length).toBe(2)
      expect(result.routePermissions).toContain('/dashboard')
      expect(setUserPermissionCache).toHaveBeenCalled()
    })

    it('应该为普通用户返回分配的权限', async () => {
      vi.mocked(getUserPermissionCache).mockReturnValue(null)

      global.prisma = {
        userRoles: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as any

      vi.mocked(findUserApiPermissionsDao).mockResolvedValue([
        { id: 1, path: '/api/v1/cases', method: 'GET' },
      ] as any)

      const result = await getUserPermissions(1)

      expect(result.isSuperAdmin).toBe(false)
      expect(result.apiPermissions.length).toBe(1)
      expect(setUserPermissionCache).toHaveBeenCalled()
    })
  })

  describe('getPublicApiPermissions · 获取公开 API 权限', () => {
    it('应该从缓存返回公开 API 权限', async () => {
      const cachedPermissions = [
        { path: '/api/v1/auth/login', method: 'POST' },
      ]

      vi.mocked(getPublicApiPermissionCache).mockReturnValue(cachedPermissions)

      const result = await getPublicApiPermissions()

      expect(result).toEqual(cachedPermissions)
    })

    it('应该从数据库查询并缓存公开 API 权限', async () => {
      vi.mocked(getPublicApiPermissionCache).mockReturnValue(null)

      const publicPermissions = [
        { path: '/api/v1/auth/login', method: 'POST' },
        { path: '/api/v1/auth/register', method: 'POST' },
      ]

      vi.mocked(findPublicApiPermissionsDao).mockResolvedValue(publicPermissions)

      const result = await getPublicApiPermissions()

      expect(result).toEqual(publicPermissions)
      expect(setPublicApiPermissionCache).toHaveBeenCalledWith(publicPermissions)
    })
  })

  describe('validateUserApiPermission · 验证 API 权限', () => {
    it('应该允许访问公开 API', async () => {
      const publicPermissions = [
        { path: '/api/v1/auth/login', method: 'POST' },
      ]

      vi.mocked(getPublicApiPermissionCache).mockReturnValue(publicPermissions)

      const result = await validateUserApiPermission(
        null,
        '/api/v1/auth/login',
        'POST'
      )

      expect(result.allowed).toBe(true)
      expect(result.reason).toBe('public_api')
    })

    it('应该拒绝未登录用户访问非公开 API', async () => {
      vi.mocked(getPublicApiPermissionCache).mockReturnValue([])

      const result = await validateUserApiPermission(
        null,
        '/api/v1/cases',
        'GET'
      )

      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('not_authenticated')
    })

    it('应该允许超级管理员访问任何 API', async () => {
      vi.mocked(getPublicApiPermissionCache).mockReturnValue([])
      vi.mocked(getUserPermissionCache).mockReturnValue(null)

      global.prisma = {
        userRoles: {
          findMany: vi.fn().mockResolvedValue([
            {
              role: {
                code: 'super_admin',
                status: 1,
                deletedAt: null,
              },
            },
          ]),
        },
        apiPermissions: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        routers: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as any

      const result = await validateUserApiPermission(
        1,
        '/api/v1/cases',
        'GET'
      )

      expect(result.allowed).toBe(true)
      expect(result.reason).toBe('super_admin')
    })

    it('应该允许拥有权限的用户访问 API', async () => {
      vi.mocked(getPublicApiPermissionCache).mockReturnValue([])
      vi.mocked(getUserPermissionCache).mockReturnValue({
        apiPermissions: [
          { id: 1, path: '/api/v1/cases', method: 'GET' },
        ],
        routePermissions: [],
        isSuperAdmin: false,
      })

      const result = await validateUserApiPermission(
        1,
        '/api/v1/cases',
        'GET'
      )

      expect(result.allowed).toBe(true)
      expect(result.reason).toBe('has_permission')
    })

    it('应该拒绝没有权限的用户访问 API', async () => {
      vi.mocked(getPublicApiPermissionCache).mockReturnValue([])
      vi.mocked(getUserPermissionCache).mockReturnValue({
        apiPermissions: [],
        routePermissions: [],
        isSuperAdmin: false,
      })

      const result = await validateUserApiPermission(
        1,
        '/api/v1/admin/users',
        'GET'
      )

      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('no_permission')
    })
  })

  describe('validateUserRoutePermission · 验证路由权限', () => {
    it('应该允许超级管理员访问任何路由', async () => {
      vi.mocked(getUserPermissionCache).mockReturnValue({
        apiPermissions: [],
        routePermissions: [],
        isSuperAdmin: true,
      })

      const result = await validateUserRoutePermission(1, '/admin/users')

      expect(result.allowed).toBe(true)
      expect(result.reason).toBe('super_admin')
    })

    it('应该允许拥有权限的用户访问路由', async () => {
      vi.mocked(getUserPermissionCache).mockReturnValue({
        apiPermissions: [],
        routePermissions: ['/dashboard'],
        isSuperAdmin: false,
      })

      vi.mocked(matchPath).mockReturnValue(true)

      const result = await validateUserRoutePermission(1, '/dashboard')

      expect(result.allowed).toBe(true)
      expect(result.reason).toBe('has_permission')
    })

    it('应该拒绝没有权限的用户访问路由', async () => {
      vi.mocked(getUserPermissionCache).mockReturnValue({
        apiPermissions: [],
        routePermissions: ['/dashboard'],
        isSuperAdmin: false,
      })

      vi.mocked(matchPath).mockReturnValue(false)

      const result = await validateUserRoutePermission(1, '/admin/users')

      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('no_permission')
    })
  })

  describe('refreshUserPermissions · 刷新用户权限', () => {
    it('应该清除缓存并重新获取权限', async () => {
      vi.mocked(getUserPermissionCache).mockReturnValue(null)

      global.prisma = {
        userRoles: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as any

      vi.mocked(findUserApiPermissionsDao).mockResolvedValue([])

      await refreshUserPermissions(1)

      expect(clearUserPermissionCache).toHaveBeenCalledWith(1)
      expect(setUserPermissionCache).toHaveBeenCalled()
    })
  })

  describe('refreshPublicApiPermissions · 刷新公开 API 权限', () => {
    it('应该清除缓存并重新获取权限', async () => {
      vi.mocked(getPublicApiPermissionCache).mockReturnValue(null)
      vi.mocked(findPublicApiPermissionsDao).mockResolvedValue([])

      await refreshPublicApiPermissions()

      expect(clearPublicApiPermissionCache).toHaveBeenCalled()
      expect(setPublicApiPermissionCache).toHaveBeenCalled()
    })
  })

  describe('refreshRoleUsersPermissions · 刷新角色用户权限', () => {
    it('应该清除拥有该角色的所有用户的权限缓存', async () => {
      global.prisma = {
        userRoles: {
          findMany: vi.fn().mockResolvedValue([
            { userId: 1 },
            { userId: 2 },
            { userId: 3 },
          ]),
        },
      } as any

      await refreshRoleUsersPermissions(5)

      expect(clearUserPermissionCacheBatch).toHaveBeenCalledWith([1, 2, 3])
    })

    it('应该处理没有用户拥有该角色的情况', async () => {
      global.prisma = {
        userRoles: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as any

      await refreshRoleUsersPermissions(5)

      expect(clearUserPermissionCacheBatch).toHaveBeenCalledWith([])
    })
  })
})
