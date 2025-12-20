/**
 * 用户状态
 */

export const useUserStore = defineStore("user", {
  state: () => ({
    userInfo: null,
    loading: false,
    error: null as string | null,
    token: null as string | null,
    isAuthenticated: false,
  }),

  getters: {
    // 获取用户基本信息
    getUserInfo: (state) => state.userInfo,
    // 获取认证状态
    getIsAuthenticated: (state) => state.isAuthenticated,
    // 获取token
    getToken: (state) => state.token,
  },

  actions: {
    // 初始化 store（在客户端调用，从 localStorage 恢复状态）
    initFromStorage() {
      if (import.meta.client) {
        const storedToken = localStorage.getItem("token");
        if (storedToken) {
          this.token = storedToken;
          this.isAuthenticated = true;
        }
      }
    },

    // 用户登录
    async login({ phone, password }: { phone: string; password: string }) {
      this.loading = true;
      this.error = null;
      try {
        // useApiPost 是同步函数，不需要 await
        const { data: response, error, execute } = useApiPost("/api/v1/auth/login/password", { phone, password }, { showError: false });
        await execute();

        if (error.value) {
          this.error = error.value.message;
          return false;
        }

        logger.debug("response", response.value);

        if (response.value?.token) {
          // 保存token和用户信息
          this.token = response.value.token;
          this.userInfo = response.value.user;
          this.isAuthenticated = true;

          // 仅在客户端保存到 localStorage
          if (import.meta.client) {
            localStorage.setItem("token", response.value.token);
          }
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
    logout() {
      this.token = null;
      this.userInfo = null;
      this.isAuthenticated = false;
      if (import.meta.client) {
        localStorage.removeItem("token");
      }
    },
  },
});
