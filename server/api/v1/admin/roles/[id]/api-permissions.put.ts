/**
 * 分配角色 API 权限
 * PUT /api/v1/admin/roles/:id/api-permissions
 */
import { z } from 'zod'

const bodySchema = z.object({
    permissionIds: z.array(z.number().int()),
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

    const { permissionIds } = result.data

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

    // 设置角色 API 权限（全量替换）
    await setRoleApiPermissionsDao(id, permissionIds)

    // 记录审计日志
    await logRoleAssignApiPermission(event, user.id, id, permissionIds)

    // 刷新该角色所有用户的权限缓存
    await refreshRoleUsersPermissions(id)

    return resSuccess(event, '分配成功', { count: permissionIds.length })
})
