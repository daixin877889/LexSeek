/**
 * 用户状态
 */

// 登录状态 cookie 名称（非 httpOnly，客户端可读）
const AUTH_STATUS_COOKIE = "auth_status";

export const useAuthStore = defineStore("auth", {
  state: () => ({
    userInfo: null,
    loading: false,
    error: null as string | null,
    isAuthenticated: false,
  }),

  getters: {
    // 获取用户基本信息
    getUserInfo: (state) => state.userInfo,
  },

  actions: {
    // 从 cookie 初始化认证状态
    initAuth() {
      const authCookie = useCookie(AUTH_STATUS_COOKIE);
      this.isAuthenticated = !!authCookie.value;
    },

    // 用户登录
    async login({ phone, password }: { phone: string; password: string }) {
      this.loading = true;
      this.error = null;
      try {
        const { data: response, error, execute } = useApiPost("/api/v1/auth/login/password", { phone, password }, { showError: false });
        await execute();

        if (error.value) {
          this.error = error.value.message;
          return false;
        }

        logger.debug("response", response.value);

        if (response.value?.token) {
          // 保存用户信息和认证状态（token 由服务端通过 Set-Cookie 设置）
          this.userInfo = response.value.user;
          this.isAuthenticated = true;
          this.error = null;
          return true;
        } else {
          this.error = response.value?.error?.message || "登录失败";
          return false;
        }
      } catch (err: any) {
        logger.error("登录失败:", err);
        this.error = err.response?.data?.message || err.message || "登录失败";
        throw err;
      } finally {
        this.loading = false;
      }
    },

    // 退出登录
    async logout() {
      this.loading = true;
      try {
        const { data: response, error, execute } = useApiPost("/api/v1/auth/logout", {});
        await execute();

        if (error.value) {
          this.error = error.value.message;
          return false;
        }

        if (response.value) {
          this.userInfo = null;
          this.isAuthenticated = false;
          this.error = null;
          return true;
        } else {
          this.error = response.value?.error?.message || "登出失败";
          return false;
        }
      } catch (error: any) {
        logger.error("登出失败:", error);
        this.error = error.response?.data?.message || error.value.message || "登出失败";
        return false;
      } finally {
        this.loading = false;
      }
    },

    // 重置密码
    async resetPassword({ phone, code, newPassword }: { phone: string; code: string; newPassword: string }) {
      this.loading = true;
      this.error = null;
      try {
        const { data: response, error, execute } = useApiPost("/api/v1/auth/reset-password", { phone, code, newPassword }, { showError: false });
        await execute();

        if (error.value) {
          this.error = error.value.message;
          return false;
        }

        if (response.value) {
          this.error = null;
          return true;
        } else {
          this.error = response.value?.error?.message || "重置密码失败";
          return false;
        }
      } catch (err: any) {
        logger.error("重置密码失败:", err);
        this.error = err.response?.data?.message || err.message || "重置密码失败";
        return false;
      } finally {
        this.loading = false;
      }
    },

    // 发送短信验证码
    async sendSmsCode({ phone, type }: { phone: string; type: string }) {
      this.error = null;
      try {
        const { data: response, error, execute } = useApiPost("/api/v1/sms/send", { phone, type }, { showError: false });
        await execute();

        if (error.value) {
          this.error = error.value.message;
          return false;
        }

        if (response.value) {
          this.error = null;
          return true;
        } else {
          this.error = response.value?.error?.message || "发送验证码失败";
          return false;
        }
      } catch (err: any) {
        logger.error("发送验证码失败:", err);
        this.error = err.response?.data?.message || err.message || "发送验证码失败";
        return false;
      }
    },

    // 用户注册
    async register({ phone, code, name, password, invitedBy }: { phone: string; code: string; name: string; password: string; invitedBy?: string }) {
      this.loading = true;
      this.error = null;
      try {
        const params: Record<string, string> = { phone, code, name, password };
        if (invitedBy) {
          params.invitedBy = invitedBy;
        }

        const { data: response, error, execute } = useApiPost("/api/v1/auth/register", params, { showError: false });
        await execute();

        if (error.value) {
          this.error = error.value.message;
          return false;
        }

        if (response.value?.token) {
          // 保存用户信息和认证状态（token 由服务端通过 Set-Cookie 设置）
          this.userInfo = response.value.user;
          this.isAuthenticated = true;
          this.error = null;
          return true;
        } else {
          this.error = response.value?.error?.message || "注册失败";
          return false;
        }
      } catch (err: any) {
        logger.error("注册失败:", err);
        this.error = err.response?.data?.message || err.message || "注册失败";
        return false;
      } finally {
        this.loading = false;
      }
    },
  },
});
