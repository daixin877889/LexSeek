export default defineNuxtRouteMiddleware(async (to) => {
    // 服务端：通过 cookie 判断认证状态
    if (import.meta.server) {
        const authCookie = useCookie("auth_token");
        if (to.path.startsWith('/dashboard') && !authCookie.value) {
            return navigateTo('/login');
        }
        return;
    }

    // 客户端：通过 store 状态判断
    const userStore = useUserStore();
    if (to.path.startsWith('/dashboard') && !userStore.isAuthenticated) {
        return navigateTo('/login');
    }
});
