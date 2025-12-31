/**
 * 获取路由组列表
 * GET /api/v1/admin/routers/groups
 */

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    const groups = await prisma.routerGroups.findMany({
        where: { deletedAt: null, status: 1 },
        orderBy: [{ sort: 'asc' }, { id: 'asc' }],
        select: {
            id: true,
            name: true,
            description: true,
        },
    })

    return resSuccess(event, '获取成功', groups)
})
