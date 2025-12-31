/**
 * 统一服务端和客户端的鉴权逻辑
 * 1. 服务端：通过 cookie 判断认证状态
 * 2. 客户端：通过 store 状态判断
 * 3. 执行统一鉴权逻辑
 * 4. 如果用户已登录,访问注册页时重定向到仪表盘
 * 5. 如果用户未登录，重定向到登录页
 * 6. 验证路由权限，无权限重定向到 403 页面
 */

// 公开路由（无需登录和权限验证）
const PUBLIC_ROUTES = [
    '/',
    '/login',
    '/register',
    '/403',
    '/404',
]

// 需要登录但不需要权限验证的路由
const AUTH_ONLY_ROUTES = [
    '/dashboard',
    '/dashboard/profile',
    '/dashboard/settings',
]

export default defineNuxtRouteMiddleware(async (to) => {
    // 公开路由直接放行
    if (PUBLIC_ROUTES.includes(to.path)) {
        // 定义认证状态
        let isAuthenticated = false
        if (import.meta.server) {
            const authCookie = useCookie('auth_token')
            isAuthenticated = !!authCookie.value
        } else {
            const authStore = useAuthStore()
            isAuthenticated = authStore.isAuthenticated
        }

        // 如果用户已登录，访问登录/注册页时重定向到仪表盘
        if (['/register', '/login'].includes(to.path) && isAuthenticated) {
            return navigateTo('/dashboard')
        }
        return
    }

    // 定义认证状态
    let isAuthenticated = false

    // 服务端：通过 cookie 判断认证状态
    if (import.meta.server) {
        const authCookie = useCookie('auth_token')
        isAuthenticated = !!authCookie.value
    } else {
        // 客户端：通过 store 状态判断
        const authStore = useAuthStore()
        isAuthenticated = authStore.isAuthenticated
    }

    // 如果用户未登录，重定向到登录页
    if (!isAuthenticated) {
        return navigateTo('/login')
    }

    // 仅需登录的路由，不需要权限验证
    if (AUTH_ONLY_ROUTES.some(route => to.path === route || to.path.startsWith(route + '/'))) {
        return
    }

    // 客户端进行路由权限验证
    if (import.meta.client) {
        const permissionStore = usePermissionStore()

        // 初始化权限（如果尚未初始化）
        if (!permissionStore.initialized) {
            await permissionStore.initUserPermissions()
        }

        // 超级管理员直接放行
        if (permissionStore.isSuperAdmin) {
            return
        }

        // 验证路由权限
        if (!permissionStore.hasRoutePermission(to.path)) {
            return navigateTo('/403')
        }
    }
})