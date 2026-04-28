/**
 * 删除角色
 * DELETE /api/v1/admin/roles/:id
 *
 * 安全模型：
 * 1) 仅超管可调用；
 * 2) 不允许删除 super_admin 角色（系统保留）；
 * 3) 角色下还有用户绑定时拒绝（_count 必须过滤软删，避免脏数据误拦或误放）。
 */
import { logRoleDelete } from '~~/server/services/rbac/auditLog.service'
import { requireSuperAdminGuard } from '~~/server/services/rbac/guard.service'

export default defineEventHandler(async (event) => {
    const guard = await requireSuperAdminGuard(event)
    if (!guard.ok) return guard.response
    const operatorId = guard.userId

    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isInteger(id) || id <= 0) {
        return resError(event, 400, '无效的角色 ID')
    }

    const existing = await prisma.roles.findFirst({
        where: { id, deletedAt: null },
        include: {
            _count: {
                // 必须过滤软删的关联，否则计数失真（C6 配套修复）
                select: { userRoles: { where: { deletedAt: null } } },
            },
        },
    })
    if (!existing) {
        return resError(event, 404, '角色不存在')
    }

    if (existing.code === 'super_admin') {
        return resError(event, 403, '不能删除超级管理员角色')
    }

    if (existing._count.userRoles > 0) {
        return resError(event, 400, `该角色下还有 ${existing._count.userRoles} 个用户，请先移除用户后再删除`)
    }

    await prisma.roles.update({
        where: { id },
        data: { deletedAt: new Date(), updatedAt: new Date() },
    })

    await logRoleDelete(event, operatorId, id, {
        name: existing.name,
        code: existing.code,
        description: existing.description,
    })

    return resSuccess(event, '删除成功', null)
})
