export default defineNuxtRouteMiddleware(async (to) => {

    // 定义认证状态
    let isAuthenticated = false;

    // 服务端：通过 cookie 判断认证状态
    if (import.meta.server) {
        const authCookie = useCookie("auth_token");
        authCookie.value ? isAuthenticated = true : isAuthenticated = false;
    }

    // 客户端：通过 store 状态判断
    const userStore = useUserStore();
    userStore.isAuthenticated ? isAuthenticated = true : isAuthenticated = false;

    // 执行统一鉴权逻辑
    await authLogic(to, userStore.isAuthenticated);
});

// 统一服务端和客户端的鉴权逻辑
const authLogic = async (to: any, isAuthenticated: boolean) => {
    // 如果用户已登录,访问注册页时重定向到仪表盘
    if (to.path === '/register' && isAuthenticated) {
        return navigateTo('/dashboard');
    }

    // 如果用户未登录，重定向到登录页
    if (to.path.startsWith('/dashboard') && !isAuthenticated) {
        return navigateTo('/login');
    }
}