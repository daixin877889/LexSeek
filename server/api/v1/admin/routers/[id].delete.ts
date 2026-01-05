/**
 * 删除路由权限
 * DELETE /api/v1/admin/routers/:id
 */
export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    const id = Number(getRouterParam(event, 'id'))
    if (isNaN(id)) {
        return resError(event, 400, '无效的路由 ID')
    }

    // 查询现有路由
    const existing = await prisma.routers.findFirst({
        where: { id, deletedAt: null },
    })
    if (!existing) {
        return resError(event, 404, '路由不存在')
    }

    // 软删除路由
    await prisma.routers.update({
        where: { id },
        data: {
            deletedAt: new Date(),
            updatedAt: new Date(),
        },
    })

    return resSuccess(event, '删除成功', null)
})
