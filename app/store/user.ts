/**
 * 用户状态
 */

export const useUserStore = defineStore("user", () => {
  /**
   * 状态
   */
  const userInfo = reactive<SafeUserInfo>({
    id: 0,
    name: "",
    username: "",
    phone: "",
    email: "",
    roles: [],
    status: 0,
    company: "",
    profile: "",
    inviteCode: "",
  });

  const pending = ref(false);
  const fetchError = ref<Error | null>(null);
  let refreshFn: (() => Promise<void>) | null = null;

  /**
   * 初始化用户信息（利用 useFetch 水合特性）
   * 返回 Promise，需要 await 以支持 SSR
   */
  const initUserInfo = async () => {

    // 请求用户信息接口
    const { data, error, status, refresh } = await useApi<SafeUserInfo>("/api/v1/users/me", {
      key: "user-info",
    });

    refreshFn = refresh;

    // 同步数据到 store
    if (data.value) {
      setUserInfo(data.value);
      // logger.debug("获取用户信息成功:", data.value);
    }

    if (error.value) {
      fetchError.value = error.value;
      logger.error("获取用户信息失败:", error.value);
    }

    pending.value = status.value === "pending";

    // 监听后续数据变化
    watch(data, (newData) => {
      if (newData) {
        setUserInfo(newData);
      }
    });

    watch(error, (newError) => {
      fetchError.value = newError || null;
    });

    return { data, error, status, refresh };
  };

  /**
   * 刷新用户信息（客户端使用）
   */
  const refreshUserInfo = async (): Promise<void> => {
    if (refreshFn) {
      await refreshFn();
    }
  };

  /**
   * 设置用户信息
   */
  const setUserInfo = (info: SafeUserInfo) => {
    Object.assign(userInfo, info);
  };

  /**
   * 更新用户资料
   */
  const updateUserProfile = async (data: { name: string, company: string, profile: string }) => {

    // 请求更新用户资料接口
    const { data: updatedData, error } = await useApi<SafeUserInfo>("/api/v1/users/profile", {
      key: "update-user-profile",
      method: "PUT",
      body: data,
    });

    if (updatedData.value) {
      setUserInfo(updatedData.value);
      logger.debug("更新用户资料成功:", updatedData.value);
    }

    if (error.value) {
      fetchError.value = error.value;
      logger.error("更新用户资料失败:", error.value);
    }
    return updatedData.value;
  };

  /**
   * 更新用户密码
   */
  const updateUserPassword = async (data: { currentPassword: string, newPassword: string }) => {

    // 请求更新用户密码接口
    const { data: updatedData, error } = await useApi<SafeUserInfo>("/api/v1/users/password", {
      key: "update-user-password",
      method: "PUT",
      body: data,
    });

    if (updatedData.value) {
      logger.debug("更新用户密码成功:", updatedData.value);
    }
    if (error.value) {
      fetchError.value = error.value;
      logger.error("更新用户密码失败:", error.value);
    }
    return updatedData.value;
  };

  /**
   * 清空用户信息
   */
  const clearUserInfo = () => {
    Object.assign(userInfo, {
      id: 0,
      name: "",
      username: "",
      phone: "",
      email: "",
      roles: [],
      status: 0,
      company: "",
      profile: "",
      inviteCode: "",
    });
    fetchError.value = null;
  };

  return {
    // 导出状态数据
    userInfo,
    pending,
    fetchError,

    // 导出方法
    initUserInfo,
    refreshUserInfo,
    setUserInfo,
    clearUserInfo,
    updateUserProfile,
    updateUserPassword,
  };
});
