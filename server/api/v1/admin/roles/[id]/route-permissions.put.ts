/**
 * 分配角色路由权限
 * PUT /api/v1/admin/roles/:id/route-permissions
 */
import { z } from 'zod'
import type { routers } from '~~/generated/prisma/client'
import { logRoleAssignRoutePermission } from '~~/server/services/rbac/auditLog.service'
import { refreshRoleUsersPermissions } from '~~/server/services/rbac/permission.service'

const bodySchema = z.object({
    routerIds: z.array(
        z.number({ message: '路由ID必须是数字' })
            .int('路由ID必须是整数')
    ),
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
        return resError(event, 400, result.error.issues[0]!!?.message || '参数错误')
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

    // 使用 upsert 模式：利用 (roleId, routerId) 唯一约束直接创建/更新，
    // 避免 deleteMany + createMany 在 PostgreSQL 序列不同步时产生 ID 冲突
    await prisma.$transaction(async (tx) => {
        // 对每个路由：存在则跳过，不存在则创建
        for (const routerId of routerIds) {
            await tx.roleRouters.upsert({
                where: { idx_role_router_unique: { roleId: id, routerId } },
                create: { roleId: id, routerId },
                update: {},
            })
        }

        // 删除不在列表中的旧路由关联（只保留本次授权的）
        if (routerIds.length > 0) {
            await tx.roleRouters.deleteMany({
                where: { roleId: id, routerId: { notIn: routerIds } },
            })
        } else {
            await tx.roleRouters.deleteMany({ where: { roleId: id } })
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
