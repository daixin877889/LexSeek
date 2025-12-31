/**
 * 创建 API 权限
 * POST /api/v1/admin/api-permissions
 */
import { z } from 'zod'

const bodySchema = z.object({
    path: z.string().min(1, '路径不能为空').max(200),
    method: z.string().min(1, '方法不能为空').max(10),
    name: z.string().min(1, '名称不能为空').max(100),
    description: z.string().max(500).optional(),
    groupId: z.number().int().optional(),
    isPublic: z.boolean().default(false),
    status: z.number().int().min(0).max(1).default(1),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 解析请求体
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, result.error.issues[0]?.message || '参数错误')
    }

    const data = result.data

    // 检查是否已存在
    const exists = await checkApiPermissionExistsDao(data.path, data.method)
    if (exists) {
        return resError(event, 400, '该 API 权限已存在')
    }

    // 创建权限
    const permission = await createApiPermissionDao(data)

    // 记录审计日志
    await logApiPermissionCreate(event, user.id, permission.id, data)

    // 如果是公开权限，刷新缓存
    if (data.isPublic) {
        await refreshPublicApiPermissions()
    }

    return resSuccess(event, '创建成功', permission)
})
