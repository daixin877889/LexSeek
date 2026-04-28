/**
 * 获取角色详情
 * GET /api/v1/admin/roles/:id
 *
 * 所有 include / _count 必须过滤 deletedAt:null（关联软删）+
 * 关联实体（permission/router）的 status:1 与 deletedAt:null。
 * 否则后台"角色已经分配的权限/路由"展示包含历史撤销项，会让管理员误判。
 */
export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isInteger(id) || id <= 0) {
        return resError(event, 400, '无效的角色 ID')
    }

    const role = await prisma.roles.findFirst({
        where: { id, deletedAt: null },
        include: {
            roleRouters: {
                where: {
                    deletedAt: null,
                    router: { deletedAt: null },
                },
                include: {
                    router: true,
                },
            },
            roleApiPermissions: {
                where: {
                    deletedAt: null,
                    permission: { deletedAt: null, status: 1 },
                },
                include: {
                    permission: {
                        include: { group: true },
                    },
                },
            },
            _count: {
                select: { userRoles: { where: { deletedAt: null } } },
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
