/**
 * 角色状态
 */

export const useRoleStore = defineStore("role", () => {
  const error = ref<string | null>(null);
  const loading = ref<boolean>(false);
  const userRoles = ref<roles[]>([]); // 用户角色列表
  const currentRoleIndex = ref<number>(0); // 当前角色索引
  const currentRole = computed(() => userRoles.value[currentRoleIndex.value]); // 当前角色
  const currentRoleRouters = ref<any>([]); // 当前角色路由列表

  let refreshRolesFn: (() => Promise<void>) | null = null;

  /**
   * 初始化用户角色列表（利用 useFetch 水合特性）
   * 返回 Promise，需要 await 以支持 SSR
   */
  const initUserRoles = async () => {
    const { data, error: apiError, status, refresh } = await useApi<roles[]>("/api/v1/users/roles", {
      key: "user-roles",
    });

    refreshRolesFn = refresh;

    // 同步数据到 store
    if (data.value) {
      userRoles.value = data.value;
      // logger.debug("获取用户角色列表成功:", data.value);
    }

    if (apiError.value) {
      error.value = apiError.value.message;
      logger.error("获取用户角色列表失败:", apiError.value);
    }

    loading.value = status.value === "pending";

    // 监听后续数据变化
    watch(data, (newData) => {
      if (newData) {
        userRoles.value = newData;
      }
    });

    watch(apiError, (newError) => {
      if (newError) {
        error.value = newError.message;
      }
    });

    return { data, error: apiError, status, refresh };
  };

  /**
   * 刷新用户角色列表（客户端使用）
   */
  const refreshUserRoles = async (): Promise<void> => {
    if (refreshRolesFn) {
      await refreshRolesFn();
    }
  };

  /**
   * 初始化用户权限路由（利用 useFetch 水合特性）
   * 返回 Promise，需要 await 以支持 SSR
   */
  const initUserRouters = async (roleId: number) => {

    const { data, error: apiError, status, refresh } = await useApi<any>("/api/v1/users/routers", {
      key: `user-routers-${roleId}`,
      query: { roleId },
    });

    // 同步数据到 store
    if (data.value?.[0]?.routers) {
      currentRoleRouters.value = data.value[0].routers;
      // logger.debug("获取用户权限路由成功:", data.value);
    }

    if (apiError.value) {
      error.value = apiError.value.message;
      logger.error("获取用户权限路由失败:", apiError.value);
    }

    // 监听后续数据变化
    watch(data, (newData) => {
      if (newData?.[0]?.routers) {
        currentRoleRouters.value = newData[0].routers;
      }
    });

    return { data, error: apiError, status, refresh };
  };

  /**
   * 获取用户权限路由（客户端按需调用）
   */
  const fetchUserRouters = async (roleId: number): Promise<any> => {

    loading.value = true;
    error.value = null;

    // 请求用户权限路由接口
    const { data, error: apiError } = await useApi<any>("/api/v1/users/routers", {
      key: `user-routers-fetch-${roleId}`,
      query: { roleId },
    });

    loading.value = false;

    // 获取用户权限路由失败，返回错误信息
    if (apiError.value) {
      error.value = apiError.value?.message || "获取用户权限路由失败";
      toast.error(error.value);
      logger.error("获取用户权限路由失败:", apiError.value);
      return;
    }

    // 获取用户权限路由成功，更新用户权限路由
    if (data.value?.[0]?.routers) {
      currentRoleRouters.value = data.value[0].routers;
      logger.debug("获取用户权限路由成功:", data.value);
    }
    return data.value;
  };

  /**
   * 切换当前角色
   */
  const setCurrentRoleIndex = async (index: number) => {
    currentRoleIndex.value = index;
    if (currentRole.value?.id) {
      await fetchUserRouters(currentRole.value.id);
    } else {
      currentRoleRouters.value = [];
    }
  };

  /**
   * 清空角色数据
   */
  const clearRoleData = () => {
    userRoles.value = [];
    currentRoleIndex.value = 0;
    currentRoleRouters.value = [];
    error.value = null;
  };

  return {
    // 导出状态数据
    userRoles,
    currentRoleIndex,
    currentRole,
    currentRoleRouters,
    error,
    loading,

    // 导出方法
    initUserRoles,
    initUserRouters,
    refreshUserRoles,
    fetchUserRouters,
    setCurrentRoleIndex,
    clearRoleData,
  };
});
