/**
 * 批量设置 API 权限公开状态
 * PUT /api/v1/admin/api-permissions/batch-public
 */
import { z } from 'zod'

const bodySchema = z.object({
    ids: z.array(
        z.number({ message: '权限ID必须是数字' }).int('权限ID必须是整数')
    ).min(1, '请选择至少一个权限'),
    isPublic: z.boolean({ message: '公开状态必须是布尔值' }),
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

    const { ids, isPublic } = result.data

    // 批量更新
    const updateResult = await updateApiPermissionsPublicStatusDao(ids, isPublic)

    // 记录审计日志
    await logApiPermissionBatchPublic(event, user.id, ids, isPublic)

    // 刷新公开权限缓存
    await refreshPublicApiPermissions()

    return resSuccess(event, '更新成功', { count: updateResult.count })
})
