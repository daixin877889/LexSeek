/**
 * 重置所有 store 的状态
 */
export const resetAllStore = () => {
  const userStore = useUserStore();
  const authStore = useAuthStore();
  const roleStore = useRoleStore();

  userStore.$reset();
  authStore.$reset();
  roleStore.$reset();
}