/**
 * 批量设置 API 权限公开状态
 * PUT /api/v1/admin/api-permissions/batch-public
 *
 * 安全模型：仅超管可调用——批量改 isPublic 直接影响"是否需要权限校验"语义。
 */
import { z } from 'zod'
import { updateApiPermissionsPublicStatusDao } from '~~/server/services/rbac/apiPermission.dao'
import { logApiPermissionBatchPublic } from '~~/server/services/rbac/auditLog.service'
import { clearAllUserPermissionCache } from '~~/server/services/rbac/cache.service'
import { requireSuperAdminGuard } from '~~/server/services/rbac/guard.service'
import { refreshPublicApiPermissions } from '~~/server/services/rbac/permission.service'

const bodySchema = z.object({
    ids: z.array(
        z.number({ message: '权限ID必须是数字' })
            .int('权限ID必须是整数')
            .positive('权限ID必须为正数'),
    ).min(1, '请选择至少一个权限'),
    isPublic: z.boolean({ message: '公开状态必须是布尔值' }),
})

export default defineEventHandler(async (event) => {
    const guard = await requireSuperAdminGuard(event)
    if (!guard.ok) return guard.response
    const operatorId = guard.userId

    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, result.error.issues[0]?.message || '参数错误')
    }

    const ids = Array.from(new Set(result.data.ids))
    const { isPublic } = result.data

    const updateResult = await updateApiPermissionsPublicStatusDao(ids, isPublic)

    await logApiPermissionBatchPublic(event, operatorId, ids, isPublic)

    await refreshPublicApiPermissions()
    clearAllUserPermissionCache()

    return resSuccess(event, '更新成功', { count: updateResult.count })
})
