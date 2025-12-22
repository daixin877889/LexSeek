/**
 * 重置所有 store 的状态
 * @param pinia 可选的 Pinia 实例，用于非 setup 上下文
 */
export const resetAllStore = (pinia?: any) => {
  // 如果传入了 pinia 实例，遍历所有 store 并重置
  if (pinia?._s) {
    pinia._s.forEach((store: any) => {
      if (typeof store.$reset === 'function') {
        store.$reset()
      }
    })
    return
  }

  // 在 setup 上下文中，直接使用 store composables
  const userStore = useUserStore();
  const authStore = useAuthStore();
  const roleStore = useRoleStore();

  userStore.$reset();
  authStore.$reset();
  roleStore.$reset();
}