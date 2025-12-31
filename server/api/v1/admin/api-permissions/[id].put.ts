/**
 * 更新 API 权限
 * PUT /api/v1/admin/api-permissions/:id
 */
import { z } from 'zod'

const bodySchema = z.object({
    path: z.string().min(1).max(200).optional(),
    method: z.string().min(1).max(10).optional(),
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
    groupId: z.number().int().nullable().optional(),
    isPublic: z.boolean().optional(),
    status: z.number().int().min(0).max(1).optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    const id = Number(getRouterParam(event, 'id'))
    if (isNaN(id)) {
        return resError(event, 400, '无效的权限 ID')
    }

    // 解析请求体
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, result.error.issues[0]?.message || '参数错误')
    }

    // 查询现有权限
    const existing = await findApiPermissionByIdDao(id)
    if (!existing) {
        return resError(event, 404, '权限不存在')
    }

    const updateData = result.data

    // 如果修改了路径或方法，检查是否冲突
    if (updateData.path || updateData.method) {
        const newPath = updateData.path || existing.path
        const newMethod = updateData.method || existing.method
        const exists = await checkApiPermissionExistsDao(newPath, newMethod, id)
        if (exists) {
            return resError(event, 400, '该 API 权限已存在')
        }
    }

    // 更新权限
    const permission = await updateApiPermissionDao(id, updateData)

    // 记录审计日志
    await logApiPermissionUpdate(event, user.id, id,
        { path: existing.path, method: existing.method, name: existing.name, isPublic: existing.isPublic },
        updateData
    )

    // 如果公开状态变更，刷新缓存
    if (updateData.isPublic !== undefined && updateData.isPublic !== existing.isPublic) {
        await refreshPublicApiPermissions()
    }

    return resSuccess(event, '更新成功', permission)
})
