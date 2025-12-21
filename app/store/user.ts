/**
 * 用户状态
 */


export const useUserStore = defineStore("user", () => {
  /**
   * 状态
   */
  let userInfo = reactive<SafeUserInfo>({
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
      const { data: response, error, execute } = useApiGet("/api/v1/users/me");
      await execute();
      if (error.value) {
        throw error.value;
      }
      logger.debug("获取用户信息成功:", response.value);
      return response.value as SafeUserInfo;
    } catch (error: any) {
      logger.error("获取用户信息失败:", error);
      throw error;
    }

  };

  return {
    // 导出状态数据
    userInfo,

    // 导出方法
    fetchUserInfo,
  };
});