/**
 * 获取当前用户权限
 * GET /api/v1/users/permissions
 * 
 * 返回当前登录用户的 API 权限和路由权限
 */
export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 获取用户权限
    const permissions = await getUserPermissions(user.id)

    return resSuccess(event, '获取成功', {
        apiPermissions: permissions.apiPermissions,
        routePermissions: permissions.routePermissions,
        isSuperAdmin: permissions.isSuperAdmin,
    })
})
