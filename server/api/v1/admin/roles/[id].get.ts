/**
 * 获取角色详情
 * GET /api/v1/admin/roles/:id
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

    const role = await prisma.roles.findFirst({
        where: { id, deletedAt: null },
        include: {
            roleRouters: {
                include: {
                    router: true,
                },
            },
            roleApiPermissions: {
                include: {
                    permission: {
                        include: { group: true },
                    },
                },
            },
            _count: {
                select: { userRoles: true },
            },
        },
    })

    if (!role) {
        return resError(event, 404, '角色不存在')
    }

    return resSuccess(event, '获取成功', {
        ...role,
        routePermissions: role.roleRouters.map(r => r.router),
        apiPermissions: role.roleApiPermissions.map(r => r.permission),
        userCount: role._count.userRoles,
        roleRouters: undefined,
        roleApiPermissions: undefined,
        _count: undefined,
    })
})
