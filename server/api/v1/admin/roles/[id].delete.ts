/**
 * 删除角色
 * DELETE /api/v1/admin/roles/:id
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

    // 查询现有角色
    const existing = await prisma.roles.findFirst({
        where: { id, deletedAt: null },
        include: {
            _count: { select: { userRoles: true } },
        },
    })
    if (!existing) {
        return resError(event, 404, '角色不存在')
    }

    // 禁止删除超级管理员角色
    if (existing.code === 'super_admin') {
        return resError(event, 403, '不能删除超级管理员角色')
    }

    // 检查是否有用户关联
    if (existing._count.userRoles > 0) {
        return resError(event, 400, `该角色下还有 ${existing._count.userRoles} 个用户，请先移除用户后再删除`)
    }

    // 软删除角色
    await prisma.roles.update({
        where: { id },
        data: { deletedAt: new Date(), updatedAt: new Date() },
    })

    // 记录审计日志
    await logRoleDelete(event, user.id, id, {
        name: existing.name,
        code: existing.code,
        description: existing.description,
    })

    return resSuccess(event, '删除成功', null)
})
