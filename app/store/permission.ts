/**
 * 权限 Store
 * 
 * 管理用户的 API 权限和路由权限
 */
import { defineStore } from 'pinia'

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
 * 路径匹配（支持通配符）
 * - `*` 匹配单个路径段
 * - `**` 匹配任意路径段
 */
function matchPath(pattern: string, path: string): boolean {
    if (pattern === path) return true
    if (!pattern.includes('*')) return pattern === path

    // 转换为正则表达式
    let regexStr = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    regexStr = regexStr.replace(/\*\*/g, '<<<DOUBLE_STAR>>>')
    regexStr = regexStr.replace(/\*/g, '[^/]+')
    regexStr = regexStr.replace(/<<<DOUBLE_STAR>>>/g, '.*')

    const regex = new RegExp(`^${regexStr}$`)
    return regex.test(path)
}
