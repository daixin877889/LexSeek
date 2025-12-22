/**
 * 统一服务端和客户端的鉴权逻辑
 * 1. 服务端：通过 cookie 判断认证状态
 * 2. 客户端：通过 store 状态判断
 * 3. 执行统一鉴权逻辑
 * 4. 如果用户已登录,访问注册页时重定向到仪表盘
 * 5. 如果用户未登录，重定向到登录页
 */

export default defineNuxtRouteMiddleware((to) => {
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

    // 如果用户已登录，访问注册页时重定向到仪表盘
    if (['/register', '/login'].includes(to.path) && isAuthenticated) {
        return navigateTo('/dashboard')
    }
    // 如果用户未登录，访问 dashboard 时重定向到登录页
    if (to.path.startsWith('/dashboard') && !isAuthenticated) {
        return navigateTo('/login')
    }
})