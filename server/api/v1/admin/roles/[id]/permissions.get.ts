/**
 * 获取角色权限
 * GET /api/v1/admin/roles/:id/permissions
 */
export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    const id = Number(getRouterParam(event, 'id'))
    if (isNaN(id)) {
        return resError(event, 400, '无效的角色 ID')
    }

    // 检查角色是否存在
    const role = await prisma.roles.findFirst({
        where: { id, deletedAt: null },
    })
    if (!role) {
        return resError(event, 404, '角色不存在')
    }

    // 获取 API 权限
    const apiPermissions = await findRoleApiPermissionsDao(id)

    // 获取路由权限
    const roleRouters = await prisma.roleRouters.findMany({
        where: { roleId: id },
        include: {
            router: true,
        },
    })

    return resSuccess(event, '获取成功', {
        apiPermissions,
        routePermissions: roleRouters.map(r => r.router.path),
        routes: roleRouters.map(r => r.router),
    })
})
