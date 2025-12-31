/**
 * 分配用户角色
 * PUT /api/v1/admin/users/:id/roles
 */
import { z } from 'zod'

const bodySchema = z.object({
    roleIds: z.array(z.number().int()),
})

export default defineEventHandler(async (event) => {
    const currentUser = event.context.auth?.user
    if (!currentUser) {
        return resError(event, 401, '请先登录')
    }

    const id = Number(getRouterParam(event, 'id'))
    if (isNaN(id)) {
        return resError(event, 400, '无效的用户 ID')
    }

    // 解析请求体
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, result.error.issues[0]?.message || '参数错误')
    }

    const { roleIds } = result.data

    // 检查用户是否存在
    const targetUser = await prisma.users.findUnique({
        where: { id },
    })
    if (!targetUser) {
        return resError(event, 404, '用户不存在')
    }

    // 检查角色是否都存在
    if (roleIds.length > 0) {
        const roles = await prisma.roles.findMany({
            where: { id: { in: roleIds }, deletedAt: null, status: 1 },
        })
        if (roles.length !== roleIds.length) {
            return resError(event, 400, '部分角色不存在或已禁用')
        }
    }

    // 使用事务更新用户角色
    await prisma.$transaction(async (tx) => {
        // 删除现有角色
        await tx.userRoles.deleteMany({
            where: { userId: id },
        })

        // 创建新角色关联
        if (roleIds.length > 0) {
            await tx.userRoles.createMany({
                data: roleIds.map(roleId => ({ userId: id, roleId })),
            })
        }
    })

    // 记录审计日志
    await logUserAssignRole(event, currentUser.id, id, roleIds)

    // 清除用户权限缓存
    clearUserPermissionCache(id)

    return resSuccess(event, '分配成功', { count: roleIds.length })
})
