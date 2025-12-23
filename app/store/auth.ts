/**
 * 认证状态
 */

// 登录状态 cookie 名称（非 httpOnly，客户端可读）
const AUTH_STATUS_COOKIE = "auth_status";

export const useAuthStore = defineStore("auth", () => {
  /**
   * 状态
   */
  const loading = ref(false);
  const error = ref<string | null>(null);
  const isAuthenticated = ref(false);

  /**
   * 从 cookie 初始化认证状态
   */
  const initAuth = () => {
    const authCookie = useCookie(AUTH_STATUS_COOKIE);
    isAuthenticated.value = !!authCookie.value;
  };

  /**
   * 用户登录
   */
  const login = async ({ phone, password, }: { phone: string; password: string; }): Promise<boolean> => {
    loading.value = true;
    error.value = null;

    // 请求登录接口
    const { data: response, error: apiError, execute, } = useApi("/api/v1/auth/login/password", {
      method: "POST",
      body: { phone, password },
      immediate: false,
      showError: false,
    });

    await execute();
    loading.value = false;

    if (apiError.value) {
      error.value = apiError.value.message;
      return false;
    }

    logger.debug("response", response.value);

    // 登录不成功，返回错误信息
    if (!response.value?.token) {
      error.value = response.value?.error?.message || "登录失败";
      return false;
    }

    // 登录成功，保存用户信息和认证状态（token 由服务端通过 Set-Cookie 设置）
    const userStore = useUserStore();
    userStore.setUserInfo(response.value.user as SafeUserInfo);
    isAuthenticated.value = true;
    return true;
  };

  /**
   * 退出登录
   */
  const logout = async (): Promise<boolean> => {
    error.value = null;
    loading.value = true;

    // 请求登出接口
    const { data: response, error: apiError, execute, } = useApi("/api/v1/auth/logout", {
      method: "POST",
      body: {},
      immediate: false,
    });
    await execute();

    loading.value = false;
    if (apiError.value || !response.value) {
      error.value = apiError.value?.message || "登出失败";

      return false;
    }

    // 登出成功，清除用户信息和认证状态
    const userStore = useUserStore();
    userStore.clearUserInfo();
    isAuthenticated.value = false;
    return true;
  };

  /**
   * 重置密码
   */
  const resetPassword = async ({
    phone,
    code,
    newPassword,
  }: {
    phone: string;
    code: string;
    newPassword: string;
  }): Promise<boolean> => {
    const userStore = useUserStore();
    loading.value = true;
    error.value = null;
    try {
      const {
        data: response,
        error: apiError,
        execute,
      } = useApi("/api/v1/auth/reset-password", {
        method: "POST",
        body: { phone, code, newPassword },
        immediate: false,
        showError: false,
      });
      await execute();

      if (apiError.value) {
        error.value = apiError.value.message;
        return false;
      }

      if (response.value) {
        error.value = null;
        userStore.clearUserInfo();
        return true;
      } else {
        error.value = response.value?.error?.message || "重置密码失败";
        return false;
      }
    } catch (err: any) {
      logger.error("重置密码失败:", err);
      error.value =
        err.response?.data?.message || err.message || "重置密码失败";
      return false;
    } finally {
      loading.value = false;
    }
  };

  /**
   * 发送短信验证码
   */
  const sendSmsCode = async ({
    phone,
    type,
  }: {
    phone: string;
    type: string;
  }): Promise<boolean> => {
    error.value = null;
    try {
      const {
        data: response,
        error: apiError,
        execute,
      } = useApi("/api/v1/sms/send", {
        method: "POST",
        body: { phone, type },
        immediate: false,
        showError: false,
      });
      await execute();

      if (apiError.value) {
        error.value = apiError.value.message;
        return false;
      }

      if (response.value) {
        error.value = null;
        return true;
      } else {
        error.value = response.value?.error?.message || "发送验证码失败";
        return false;
      }
    } catch (err: any) {
      logger.error("发送验证码失败:", err);
      error.value =
        err.response?.data?.message || err.message || "发送验证码失败";
      return false;
    }
  };

  /**
   * 用户注册
   */
  const register = async ({
    phone,
    code,
    name,
    password,
    invitedBy,
  }: {
    phone: string;
    code: string;
    name: string;
    password: string;
    invitedBy?: string;
  }): Promise<boolean> => {
    const userStore = useUserStore();
    loading.value = true;
    error.value = null;
    try {
      const params: Record<string, string> = { phone, code, name, password };
      if (invitedBy) {
        params.invitedBy = invitedBy;
      }

      const {
        data: response,
        error: apiError,
        execute,
      } = useApi("/api/v1/auth/register", {
        method: "POST",
        body: params,
        immediate: false,
        showError: false,
      });
      await execute();

      if (apiError.value) {
        error.value = apiError.value.message;
        return false;
      }

      if (response.value?.token) {
        // 保存用户信息和认证状态（token 由服务端通过 Set-Cookie 设置）
        userStore.setUserInfo(response.value.user as SafeUserInfo);
        isAuthenticated.value = true;
        error.value = null;
        return true;
      } else {
        error.value = response.value?.error?.message || "注册失败";
        return false;
      }
    } catch (err: any) {
      logger.error("注册失败:", err);
      error.value = err.response?.data?.message || err.message || "注册失败";
      return false;
    } finally {
      loading.value = false;
    }
  };


  return {
    // 导出状态数据
    loading,
    error,
    isAuthenticated,

    // 导出方法
    initAuth,
    login,
    logout,
    resetPassword,
    sendSmsCode,
    register,
  };
});
