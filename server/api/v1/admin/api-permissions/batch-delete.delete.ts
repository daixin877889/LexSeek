/**
 * 批量删除 API 权限
 * DELETE /api/v1/admin/api-permissions/batch-delete
 */
import { z } from 'zod'

const bodySchema = z.object({
    ids: z.array(z.number().int()).min(1, '请选择至少一个权限'),
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

    const { ids } = result.data

    // 批量删除
    const deleteResult = await prisma.apiPermissions.deleteMany({
        where: { id: { in: ids } }
    })

    // 记录审计日志
    await logApiPermissionBatchDelete(event, user.id, ids)

    // 刷新公开权限缓存
    await refreshPublicApiPermissions()

    return resSuccess(event, '删除成功', { count: deleteResult.count })
})
