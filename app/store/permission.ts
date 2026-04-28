/**
 * 权限 Store
 * 
 * 管理用户的 API 权限和路由权限
 */
import { defineStore } from 'pinia'
import { useApiFetch } from '~/composables/useApiFetch'

/** API 权限项 */
interface ApiPermission {
    id: number
    path: string
    method: string
}

/** 权限状态 */
interface PermissionState {
    /** API 权限列表 */
    apiPermissions: ApiPermission[]
    /** 路由权限列表 */
    routePermissions: string[]
    /** 是否为超级管理员 */
    isSuperAdmin: boolean
    /** 是否已初始化 */
    initialized: boolean
    /** 是否正在加载 */
    loading: boolean
}

export const usePermissionStore = defineStore('permission', {
    state: (): PermissionState => ({
        apiPermissions: [],
        routePermissions: [],
        isSuperAdmin: false,
        initialized: false,
        loading: false,
    }),

    getters: {
        /** 检查是否有指定 API 权限 */
        hasApiPermission: (state) => (path: string, method: string): boolean => {
            // 超级管理员拥有所有权限
            if (state.isSuperAdmin) return true

            return state.apiPermissions.some(p => {
                // 方法匹配（* 匹配所有方法）
                const methodMatch = p.method === '*' || p.method.toUpperCase() === method.toUpperCase()
                if (!methodMatch) return false

                // 路径匹配（支持通配符）
                return matchPath(p.path, path)
            })
        },

        /** 检查是否有指定路由权限 */
        hasRoutePermission: (state) => (route: string): boolean => {
            // 超级管理员拥有所有权限
            if (state.isSuperAdmin) return true

            return state.routePermissions.some(p => matchPath(p, route))
        },
    },

    actions: {
        /** 初始化用户权限 */
        async initUserPermissions() {
            if (this.initialized || this.loading) return

            this.loading = true
            try {
                const data = await useApiFetch<{
                    apiPermissions: ApiPermission[]
                    routePermissions: string[]
                    isSuperAdmin: boolean
                }>('/api/v1/users/permissions')

                if (data) {
                    this.apiPermissions = data.apiPermissions
                    this.routePermissions = data.routePermissions
                    this.isSuperAdmin = data.isSuperAdmin
                    this.initialized = true
                }
            } catch (error) {
                console.error('初始化权限失败:', error)
            } finally {
                this.loading = false
            }
        },

        /** 刷新用户权限 */
        async refreshPermissions() {
            this.initialized = false
            await this.initUserPermissions()
        },

        /** 清除权限 */
        clearPermissions() {
            this.apiPermissions = []
            this.routePermissions = []
            this.isSuperAdmin = false
            this.initialized = false
        },
    },
})

/**
 * 路径匹配（支持通配符）—— 行为必须与服务端 server/services/rbac/pathMatcher.ts 完全对齐。
 *
 * - `:param` 匹配单个路径段（动态参数，如 :id）
 * - `*` 匹配单个路径段
 * - `**` 匹配任意路径段（含 /）
 *
 * 旧实现 `if (!pattern.includes('*')) return pattern === path` 会让所有带
 * `:id` 的路径权限在前端永远匹配不上请求，让前端的 hasApiPermission/路由守卫失真。
 */
function matchPath(pattern: string, path: string): boolean {
    if (pattern === path) return true
    if (!pattern.includes('*') && !pattern.includes(':')) {
        return pattern === path
    }

    let regexStr = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    regexStr = regexStr.replace(/\*\*/g, '<<<DOUBLE_STAR>>>')
    regexStr = regexStr.replace(/\*/g, '[^/]+')
    regexStr = regexStr.replace(/<<<DOUBLE_STAR>>>/g, '.*')
    // 与服务端一致：仅紧跟在 / 后或字符串开头的 :name 才视为动态参数
    regexStr = regexStr.replace(/(^|\/):[a-zA-Z_][a-zA-Z0-9_]*/g, '$1[^/]+')

    const regex = new RegExp(`^${regexStr}$`)
    return regex.test(path)
}
