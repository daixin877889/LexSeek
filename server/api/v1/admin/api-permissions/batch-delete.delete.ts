/**
 * 批量删除 API 权限
 * DELETE /api/v1/admin/api-permissions/batch-delete
 *
 * 安全模型：
 * 1) 仅超管可调用——能批量影响整个系统的权限边界；
 * 2) 软删而非硬删——与单条删除语义对齐，保留 role_api_permissions 历史关联，
 *    审计日志中 targetId 不会指向消失的行；
 * 3) 同步软删 role_api_permissions 中的关联，避免脏关联在未来误激活；
 * 4) 操作完成后清空所有用户权限缓存。
 */
import { z } from 'zod'
import { logApiPermissionBatchDelete } from '~~/server/services/rbac/auditLog.service'
import { clearAllUserPermissionCache } from '~~/server/services/rbac/cache.service'
import { requireSuperAdminGuard } from '~~/server/services/rbac/guard.service'
import { refreshPublicApiPermissions } from '~~/server/services/rbac/permission.service'

const bodySchema = z.object({
    ids: z.array(
        z.number({ message: '权限ID必须是数字' })
            .int('权限ID必须是整数')
            .positive('权限ID必须为正数'),
    ).min(1, '请选择至少一个权限'),
})

export default defineEventHandler(async (event) => {
    // 1. 必须是超管
    const guard = await requireSuperAdminGuard(event)
    if (!guard.ok) return guard.response
    const operatorId = guard.userId

    // 2. 解析请求体
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, result.error.issues[0]?.message || '参数错误')
    }
    const ids = Array.from(new Set(result.data.ids))

    // 3. 事务：软删权限 + 同步软删角色关联
    const now = new Date()
    const deleteResult = await prisma.$transaction(async (tx) => {
        const updated = await tx.apiPermissions.updateMany({
            where: { id: { in: ids }, deletedAt: null },
            data: { deletedAt: now, updatedAt: now },
        })

        // 同步软删 role_api_permissions：避免脏关联在未来误激活
        await tx.roleApiPermissions.updateMany({
            where: { permissionId: { in: ids }, deletedAt: null },
            data: { deletedAt: now, updatedAt: now },
        })

        return updated
    })

    // 4. 审计
    await logApiPermissionBatchDelete(event, operatorId, ids)

    // 5. 全量缓存刷新
    await refreshPublicApiPermissions()
    clearAllUserPermissionCache()

    return resSuccess(event, '删除成功', { count: deleteResult.count })
})
