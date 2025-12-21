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


  // 获取用户角色列表
  const fetchUserRoles = async (): Promise<roles[]> => {
    loading.value = true;
    error.value = null;
    try {
      const { data: response, error: apiError, execute } = useApiGet("/api/v1/users/roles", { lazy: true });
      await execute();
      if (apiError.value) {
        error.value = apiError.value.message;
        throw new Error(apiError.value.message);
      }
      return response.value;

    } catch (err: any) {
      logger.error('获取用户角色列表失败:', err)
      throw err;
    } finally {
      loading.value = false;
    }
  }

  const getUserRoles = async (): Promise<roles[]> => {
    try {
      const roleList = await fetchUserRoles();
      if (!roleList) {
        throw new Error('获取用户角色列表为空');
      }
      userRoles.value = roleList;
      // // 获取角色列表后，自动获取当前角色的路由
      // if (currentRole.value?.id) {
      //   await getUserRouters(currentRole.value.id);
      // }
      return roleList;
    } catch (err: any) {
      logger.error(err)
      return [];
    }
  }

  // 获取用户权限路由
  const fetchUserRouters = async (roleId?: number):
    Promise<{
      routers: routers[], code: string
      description: string;
      name: string;
      roleId: number;
    } | false> => {
    loading.value = true;
    error.value = null;
    try {
      const query: any = {};
      if (roleId) {
        query.roleId = roleId;
      }
      const { data: response, error: apiError, execute } = useApiGet(`/api/v1/users/routers`, { query, lazy: true });
      await execute();
      if (apiError.value) {
        error.value = apiError.value.message;
        throw new Error(apiError.value.message);
      }
      if (response.value) {
        return response.value;
      }
      return false;
    } catch (err: any) {
      logger.error('获取用户权限路由失败:', err)
      throw err;
    } finally {
      loading.value = false;
    }
  }

  const getUserRouters = async (roleId?: number): Promise<routers[]> => {
    try {
      const routerData: any = await fetchUserRouters(roleId);
      if (!routerData) {
        throw new Error('获取用户权限路由为空');
      }
      logger.debug('获取用户权限路由:', routerData)
      currentRoleRouters.value = routerData[0].routers
      return routerData.routers;
    } catch (err: any) {
      logger.error('获取用户权限路由失败:', err)
      return []
    }
  }

  /**
   * 切换当前角色
   */
  const setCurrentRoleIndex = async (index: number) => {
    currentRoleIndex.value = index;
    // 切换角色后获取对应的路由
    if (currentRole.value?.id) {
      await getUserRouters(currentRole.value.id);
    } else {
      currentRoleRouters.value = [];
    }
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
    fetchUserRoles,
    fetchUserRouters,
    getUserRoles,
    getUserRouters,
    setCurrentRoleIndex
  };
});
