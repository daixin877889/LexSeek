/**
 * 删除 API 权限
 * DELETE /api/v1/admin/api-permissions/:id
 *
 * 安全模型：
 * 1) 仅超管可调用——能撤销系统权限规则；
 * 2) DAO 层 deleteApiPermissionDao 会同步软删 role_api_permissions 关联（H7）；
 * 3) 完成后必须清缓存：公开权限缓存 + 全量用户权限缓存。
 */
import { deleteApiPermissionDao, findApiPermissionByIdDao } from '~~/server/services/rbac/apiPermission.dao'
import { logApiPermissionDelete } from '~~/server/services/rbac/auditLog.service'
import { clearAllUserPermissionCache } from '~~/server/services/rbac/cache.service'
import { requireSuperAdminGuard } from '~~/server/services/rbac/guard.service'
import { refreshPublicApiPermissions } from '~~/server/services/rbac/permission.service'

export default defineEventHandler(async (event) => {
    const guard = await requireSuperAdminGuard(event)
    if (!guard.ok) return guard.response
    const operatorId = guard.userId

    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isInteger(id) || id <= 0) {
        return resError(event, 400, '无效的权限 ID')
    }

    const existing = await findApiPermissionByIdDao(id)
    if (!existing) {
        return resError(event, 404, '权限不存在')
    }

    // DAO 内部包事务：同步软删 role_api_permissions 关联
    await deleteApiPermissionDao(id)

    await logApiPermissionDelete(event, operatorId, id, {
        path: existing.path,
        method: existing.method,
        name: existing.name,
    })

    if (existing.isPublic) {
        await refreshPublicApiPermissions()
    }

    clearAllUserPermissionCache()

    return resSuccess(event, '删除成功', null)
})
