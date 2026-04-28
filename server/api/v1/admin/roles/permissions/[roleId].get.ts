/**
 * 获取角色权限
 * GET /api/v1/admin/roles/permissions/:roleId
 *
 * findRoleApiPermissionsDao 已经在 DAO 层过滤了软删 / 禁用；
 * roleRouters 在 handler 层显式过滤 deletedAt:null + router.deletedAt:null。
 * 这两处行为对齐，避免出现"列表显示已撤销的路由"。
 */
import { findRoleApiPermissionsDao } from '~~/server/services/rbac/roleApiPermission.dao'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    const roleId = Number(getRouterParam(event, 'roleId'))
    if (!Number.isInteger(roleId) || roleId <= 0) {
        return resError(event, 400, '无效的角色 ID')
    }

    // 检查角色是否存在
    const role = await prisma.roles.findFirst({
        where: { id: roleId, deletedAt: null },
        select: { id: true },
    })
    if (!role) {
        return resError(event, 404, '角色不存在')
    }

    // 获取 API 权限（DAO 已过滤）
    const apiPermissions = await findRoleApiPermissionsDao(roleId)

    // 获取路由权限：必须过滤掉软删的关联和软删的 router 本身
    const roleRouters = await prisma.roleRouters.findMany({
        where: {
            roleId,
            deletedAt: null,
            router: { deletedAt: null },
        },
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
