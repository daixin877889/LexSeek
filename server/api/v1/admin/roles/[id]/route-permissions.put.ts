/**
 * 分配角色路由权限
 * PUT /api/v1/admin/roles/:id/route-permissions
 */
import { z } from 'zod'

const bodySchema = z.object({
    routerIds: z.array(z.number().int()),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    const id = Number(getRouterParam(event, 'id'))
    if (isNaN(id)) {
        return resError(event, 400, '无效的角色 ID')
    }

    // 解析请求体
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, result.error.issues[0]?.message || '参数错误')
    }

    const { routerIds } = result.data

    // 检查角色是否存在
    const role = await prisma.roles.findFirst({
        where: { id, deletedAt: null },
    })
    if (!role) {
        return resError(event, 404, '角色不存在')
    }

    // 禁止修改超级管理员角色的权限
    if (role.code === 'super_admin') {
        return resError(event, 403, '不能修改超级管理员角色的权限')
    }

    // 使用事务更新路由权限
    await prisma.$transaction(async (tx) => {
        // 删除现有路由权限
        await tx.roleRouters.deleteMany({
            where: { roleId: id },
        })

        // 创建新路由权限
        if (routerIds.length > 0) {
            await tx.roleRouters.createMany({
                data: routerIds.map(routerId => ({ roleId: id, routerId })),
            })
        }
    })

    // 获取路由路径用于审计日志
    const routers = await prisma.routers.findMany({
        where: { id: { in: routerIds } },
        select: { path: true },
    })

    // 记录审计日志
    await logRoleAssignRoutePermission(event, user.id, id, routers.map(r => r.path))

    // 刷新该角色所有用户的权限缓存
    await refreshRoleUsersPermissions(id)

    return resSuccess(event, '分配成功', { count: routerIds.length })
})
