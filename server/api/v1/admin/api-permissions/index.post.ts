/**
 * 创建 API 权限
 * POST /api/v1/admin/api-permissions
 */
import { z } from 'zod'
import { checkApiPermissionExistsDao, createApiPermissionDao } from '~~/server/services/rbac/apiPermission.dao'
import { logApiPermissionCreate } from '~~/server/services/rbac/auditLog.service'
import { refreshPublicApiPermissions } from '~~/server/services/rbac/permission.service'

const bodySchema = z.object({
    path: z.string({ message: '路径不能为空' }).min(1, '路径不能为空').max(200, '路径不能超过200个字符'),
    method: z.string({ message: '方法不能为空' }).min(1, '方法不能为空').max(10, '方法不能超过10个字符'),
    name: z.string({ message: '名称不能为空' }).min(1, '名称不能为空').max(100, '名称不能超过100个字符'),
    description: z.string().max(500, '描述不能超过500个字符').optional(),
    groupId: z.number({ message: '分组ID必须是数字' }).int('分组ID必须是整数').optional(),
    isPublic: z.boolean().default(false),
    status: z.number({ message: '状态必须是数字' }).int('状态必须是整数').min(0, '状态值无效').max(1, '状态值无效').default(1),
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
        return resError(event, 400, result.error.issues[0]!!?.message || '参数错误')
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
