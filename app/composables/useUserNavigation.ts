/**
 * 用户导航相关的共享逻辑
 * 
 * 提供退出登录等用户导航操作的统一处理
 * 用于 navUser.vue 和 navUserRight.vue 组件
 */

/**
 * 用户导航 composable
 * 
 * @returns 用户导航相关的状态和方法
 */
export function useUserNavigation() {
    const userStore = useUserStore()
    const authStore = useAuthStore()
    const router = useRouter()

    /**
     * 处理退出登录
     * 
     * 执行以下操作：
     * 1. 调用登出 API
     * 2. 重置所有 store 状态
     * 3. 跳转到登录页面
     * 
     * 注意：无论 API 调用是否成功，都会清除本地状态并跳转
     */
    const handleLogout = async () => {
        // 调用登出 API（忽略返回结果，确保本地状态被清除）
        await authStore.logout()

        // 强制设置认证状态为 false（确保中间件不会阻止跳转）
        authStore.isAuthenticated = false

        // 重置所有 store 的状态
        resetAllStore()

        // 使用 navigateTo 替代 router.replace，确保跳转生效
        // await navigateTo('/login', { replace: true })
        window.location.href = '/login'
    }

    /**
     * 获取用户显示名称
     */
    const displayName = computed(() => userStore.userInfo?.name || '用户')

    /**
     * 获取脱敏后的手机号
     */
    const maskedPhone = computed(() => maskTel(userStore.userInfo?.phone))

    return {
        // 状态
        userStore,
        displayName,
        maskedPhone,

        // 方法
        handleLogout,
    }
}
