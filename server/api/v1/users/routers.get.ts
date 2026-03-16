/**
 * 获取用户角色路由权限
 * @param event
 * @returns
 */
export default defineEventHandler(async (event) => {
  const logger = createLogger('users')
  const user = event.context.auth.user;
  try {

    const query = getQuery(event);
    const roleId = query.roleId;

    // 检查是否为超级管理员
    const isSuperAdmin = await checkIsSuperAdmin(user.id);

    const userRoles = await findUserRolesRouterByUserIdDao(user.id, {
      roleId: Number(roleId) || undefined
    });
    if (!userRoles) {
      return resError(event, 401, '用户角色不存在')
    }

    // 超级管理员获取所有路由
    let allRouters: any[] = [];
    if (isSuperAdmin) {
      const routers = await prisma.routers.findMany({
        where: { deletedAt: null },
        orderBy: [{ menuGroupSort: 'asc' }, { sort: 'asc' }]
      });
      allRouters = routers.map(({ createdAt, updatedAt, deletedAt, ...router }) => router);
    }

    const userRouters = userRoles.map((userRole) => {
      const role = userRole.role
      // 超级管理员使用所有路由，否则使用角色关联的路由
      let routers = isSuperAdmin && role.code === 'super_admin'
        ? allRouters
        : role.roleRouters.map((item: any) => {
          const { createdAt, updatedAt, deletedAt, ...router } = item.router;
          return router;
        });

      // 对路由进行排序（先按 menuGroupSort 排序，再按 sort 排序）
      if (!isSuperAdmin || role.code !== 'super_admin') {
        routers = routers.sort((a: any, b: any) => {
          // 先按菜单分组排序
          if (a.menuGroupSort !== b.menuGroupSort) {
            return (a.menuGroupSort || 0) - (b.menuGroupSort || 0);
          }
          // 再按路由排序
          return (a.sort || 0) - (b.sort || 0);
        });
      }
      return {
        roleId: role.id,
        name: role.name,
        code: role.code,
        description: role.description,
        routers
      }
    });

    return resSuccess(event, "获取用户角色路由权限成功", userRouters)

  } catch (error) {
    logger.error('获取用户角色路由权限失败', error)
    return resError(event, 500, '获取用户角色路由权限失败')
  }
})
