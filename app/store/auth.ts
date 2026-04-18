/**
 * 认证状态
 */

// 登录状态 cookie 名称（非 httpOnly，客户端可读）
const AUTH_STATUS_COOKIE = "auth_status";

export const useAuthStore = defineStore("auth", () => {
  interface LoginResult {
    success: boolean;
    requiresCaptcha: boolean;
  }

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
  const login = async ({
    phone,
    password,
    captchaVerifyParam,
  }: {
    phone: string;
    password: string;
    captchaVerifyParam?: string;
  }): Promise<LoginResult> => {
    loading.value = true;
    error.value = null;
    let businessErrorMessage: string | null = null;
    let businessErrorCode: number | null = null;

    const data = await useApiFetch<{ token: string; user: SafeUserInfo }>(
      "/api/v1/auth/login/password",
      {
        method: "POST",
        body: { phone, password, captchaVerifyParam },
        showError: false,
        onBusinessError: (response) => {
          businessErrorCode = response.code;
          businessErrorMessage = response.message;
        },
      }
    );

    loading.value = false;

    if (!data || !data.token) {
      error.value = businessErrorMessage || "登录失败";
      return {
        success: false,
        requiresCaptcha: businessErrorCode === 429,
      };
    }

    // 登录成功，保存用户信息和认证状态（token 由服务端通过 Set-Cookie 设置）
    const userStore = useUserStore();
    userStore.setUserInfo(data.user);
    isAuthenticated.value = true;
    return {
      success: true,
      requiresCaptcha: false,
    };
  };

  /**
   * 退出登录
   */
  const logout = async (): Promise<boolean> => {
    error.value = null;
    loading.value = true;

    const data = await useApiFetch<any>("/api/v1/auth/logout", {
      method: "POST",
      body: {},
      showError: false,
    });

    loading.value = false;

    if (!data) {
      error.value = "登出失败";
      return false;
    }

    // 清除法律编辑器的所有草稿缓存
    const { clearAllDraftCaches } = useLegalEditorCache();
    clearAllDraftCaches();

    // 清除用户信息和认证状态
    const userStore = useUserStore();
    userStore.clearUserInfo();
    isAuthenticated.value = false;

    return true;
  };

  /**
   * 重置密码
   */
  const resetPassword = async ({ phone, code, newPassword }: { phone: string; code: string; newPassword: string }): Promise<boolean> => {
    loading.value = true;
    error.value = null;

    const data = await useApiFetch<any>("/api/v1/auth/reset-password", {
      method: "POST",
      body: { phone, code, newPassword },
      showError: false,
    });

    loading.value = false;

    if (!data) {
      error.value = "重置密码失败";
      return false;
    }

    const userStore = useUserStore();
    userStore.clearUserInfo();
    return true;
  };

  /**
   * 发送短信验证码
   */
  const sendSmsCode = async ({
    phone,
    type,
    captchaVerifyParam,
  }: {
    phone: string;
    type: string;
    captchaVerifyParam?: string;
  }): Promise<boolean> => {
    loading.value = true;
    error.value = null;

    const data = await useApiFetch<any>("/api/v1/sms/send", {
      method: "POST",
      body: { phone, type, captchaVerifyParam },
      showError: false,
    });

    loading.value = false;

    if (!data) {
      error.value = "发送验证码失败";
      return false;
    }

    return true;
  };

  /**
   * 用户注册
   */
  const register = async ({ phone, code, name, password, invitedBy }: { phone: string; code: string; name: string; password: string; invitedBy?: string }): Promise<boolean> => {
    loading.value = true;
    error.value = null;

    const params: Record<string, string> = { phone, code, name, password };
    if (invitedBy) {
      params.invitedBy = invitedBy;
    }

    const data = await useApiFetch<{ token: string; user: SafeUserInfo }>(
      "/api/v1/auth/register",
      {
        method: "POST",
        body: params,
        showError: false,
      }
    );

    loading.value = false;

    if (!data || !data.token) {
      error.value = "注册失败";
      return false;
    }

    // 保存用户信息和认证状态（token 由服务端通过 Set-Cookie 设置）
    const userStore = useUserStore();
    userStore.setUserInfo(data.user);
    isAuthenticated.value = true;
    error.value = null;
    return true;
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
