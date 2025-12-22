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

  /**
   * 获取用户信息
   */
  const fetchUserInfo = async (): Promise<SafeUserInfo> => {
    try {
      const { data, error, execute } = useApi<SafeUserInfo>("/api/v1/users/me", {
        immediate: false,
      });
      await execute();
      if (error.value) {
        throw error.value;
      }
      logger.debug("获取用户信息成功:", data.value);
      if (data.value) {
        setUserInfo(data.value);
      }
      return userInfo;
    } catch (error: any) {
      logger.error("获取用户信息失败:", error);
      throw error;
    }
  };

  /**
   * 设置用户信息
   */
  const setUserInfo = (info: SafeUserInfo) => {
    Object.assign(userInfo, info);
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
  };

  return {
    // 导出状态数据
    userInfo,

    // 导出方法
    fetchUserInfo,
    setUserInfo,
    clearUserInfo,
  };
});
