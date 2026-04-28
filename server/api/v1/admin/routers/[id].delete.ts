/**
 * 删除路由权限
 * DELETE /api/v1/admin/routers/:id
 */
import { clearAllUserPermissionCache } from '~~/server/services/rbac/cache.service'

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

    // 路由被删除后，已缓存了该路由 path 的用户权限必须重新计算，
    // 否则 5 分钟缓存窗口内用户仍认为自己拥有这个路由权限。
    clearAllUserPermissionCache()

    return resSuccess(event, '删除成功', null)
})
