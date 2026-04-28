/**
 * 分配角色路由权限
 * PUT /api/v1/admin/roles/route-permissions/:roleId
 *
 * 安全模型：
 * 1) 仅超管可调用（与 api-permissions/[roleId].put 同理，避免 C3 跳板）；
 * 2) 禁止修改 super_admin 角色（其路由通过代码旁路放行）；
 * 3) routerIds 必须全部未软删——否则会把已撤销的路由重新激活授权。
 */
import { z } from 'zod'
import { logRoleAssignRoutePermission } from '~~/server/services/rbac/auditLog.service'
import { requireSuperAdminGuard } from '~~/server/services/rbac/guard.service'
import { refreshRoleUsersPermissions } from '~~/server/services/rbac/permission.service'

const bodySchema = z.object({
    routerIds: z.array(
        z.number({ message: '路由ID必须是数字' })
            .int('路由ID必须是整数')
            .positive('路由ID必须为正数'),
    ),
})

export default defineEventHandler(async (event) => {
    // 1. 必须是超管
    const guard = await requireSuperAdminGuard(event)
    if (!guard.ok) return guard.response
    const operatorId = guard.userId

    const roleId = Number(getRouterParam(event, 'roleId'))
    if (!Number.isInteger(roleId) || roleId <= 0) {
        return resError(event, 400, '无效的角色 ID')
    }

    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, result.error.issues[0]?.message || '参数错误')
    }
    const routerIds = Array.from(new Set(result.data.routerIds))

    // 2. 角色必须存在且未软删
    const role = await prisma.roles.findFirst({
        where: { id: roleId, deletedAt: null },
        select: { id: true, code: true },
    })
    if (!role) {
        return resError(event, 404, '角色不存在')
    }
    if (role.code === 'super_admin') {
        return resError(event, 403, '不能修改超级管理员角色的权限')
    }

    // 3. 校验所有 router 都存在 / 未软删
    let validRouters: { id: number; path: string }[] = []
    if (routerIds.length > 0) {
        validRouters = await prisma.routers.findMany({
            where: { id: { in: routerIds }, deletedAt: null },
            select: { id: true, path: true },
        })
        if (validRouters.length !== routerIds.length) {
            return resError(event, 400, '部分路由不存在或已删除')
        }
    }

    // 4. 事务：upsert 增量 + 删除不在列表里的旧关联
    //    使用 (roleId, routerId) 唯一键 upsert，避免 deleteMany + createMany 在 PG 序列冲突
    await prisma.$transaction(async (tx) => {
        for (const routerId of routerIds) {
            await tx.roleRouters.upsert({
                where: { idx_role_router_unique: { roleId, routerId } },
                create: { roleId, routerId },
                update: {
                    // 关键：如果之前被软删过（撤销过），重新分配时清掉 deletedAt
                    deletedAt: null,
                    updatedAt: new Date(),
                },
            })
        }

        // 删除不在列表里的旧关联——同样改为软删，保留历史
        await tx.roleRouters.updateMany({
            where: routerIds.length > 0
                ? { roleId, routerId: { notIn: routerIds }, deletedAt: null }
                : { roleId, deletedAt: null },
            data: { deletedAt: new Date(), updatedAt: new Date() },
        })
    })

    // 5. 审计 + 刷新该角色所有用户的缓存
    await logRoleAssignRoutePermission(
        event,
        operatorId,
        roleId,
        validRouters.map(r => r.path),
    )
    await refreshRoleUsersPermissions(roleId)

    return resSuccess(event, '分配成功', { count: routerIds.length })
})
