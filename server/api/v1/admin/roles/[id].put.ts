/**
 * 更新角色
 * PUT /api/v1/admin/roles/:id
 */
import { z } from 'zod'

const bodySchema = z.object({
    name: z.string().min(1).max(50).optional(),
    description: z.string().max(200).optional(),
    status: z.number().int().min(0).max(1).optional(),
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

    // 查询现有角色
    const existing = await prisma.roles.findFirst({
        where: { id, deletedAt: null },
    })
    if (!existing) {
        return resError(event, 404, '角色不存在')
    }

    // 禁止修改超级管理员角色
    if (existing.code === 'super_admin') {
        return resError(event, 403, '不能修改超级管理员角色')
    }

    const updateData = result.data

    // 更新角色
    const role = await prisma.roles.update({
        where: { id },
        data: { ...updateData, updatedAt: new Date() },
    })

    // 记录审计日志
    await logRoleUpdate(event, user.id, id,
        { name: existing.name, description: existing.description, status: existing.status },
        updateData
    )

    // 如果状态变更，清除相关用户的权限缓存
    if (updateData.status !== undefined && updateData.status !== existing.status) {
        await refreshRoleUsersPermissions(id)
    }

    return resSuccess(event, '更新成功', role)
})
