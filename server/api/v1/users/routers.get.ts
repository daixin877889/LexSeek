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

    const userRoles = await findUserRolesRouterByUserIdDao(user.id, {
      roleId: Number(roleId) || undefined
    });
    if (!userRoles) {
      return resError(event, 401, '用户角色不存在')
    }

    const userRouters = userRoles.map((userRole) => {
      const role = userRole.role
      return {
        roleId: role.id,
        name: role.name,
        code: role.code,
        description: role.description,
        routers: role.roleRouters.map((item: any) => {
          const { createdAt, updatedAt, deletedAt, ...router } = item.router;
          return router;
        })
      }
    });

    return resSuccess(event, "获取用户角色路由权限成功", userRouters)

  } catch (error) {
    logger.error('获取用户角色路由权限失败', error)
    return resError(event, 500, '获取用户角色路由权限失败')
  }
})
