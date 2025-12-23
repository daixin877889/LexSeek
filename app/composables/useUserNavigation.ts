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
     */
    const handleLogout = async () => {
        await authStore.logout()

        // 重置所有 store 的状态
        resetAllStore()

        // 跳转至登录页面
        router.replace({
            path: '/login',
        })
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
