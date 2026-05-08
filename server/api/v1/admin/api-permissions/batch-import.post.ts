/**
 * 批量导入 API 权限
 * POST /api/v1/admin/api-permissions/batch-import
 *
 * 安全模型：
 * 1) 仅超管可调用——批量写入直接影响系统权限边界（H6）；
 * 2) 已存在权限查询用 all:true 一次拿全，避免 1000 条分页限制重复导入（H3）；
 * 3) 所有 path 在 DAO 内部统一规范化校验（H5/C4）；
 * 4) 写完后必须刷新公共权限缓存 + 全量清用户缓存（H2）。
 */
import { z } from 'zod'
import { createManyApiPermissionsDao, findApiPermissionsDao } from '~~/server/services/rbac/apiPermission.dao'
import { createAuditLogDao } from '~~/server/services/rbac/auditLog.dao'
import { clearAllUserPermissionCache } from '~~/server/services/rbac/cache.service'
import {
    normalizeApiMethod,
    normalizeApiPath,
    requireSuperAdminGuard,
    validateApiPathFormat,
} from '~~/server/services/rbac/guard.service'
import { refreshPublicApiPermissions } from '~~/server/services/rbac/permission.service'

const itemSchema = z.object({
    path: z.string({ message: '路径不能为空' }).min(1, '路径不能为空'),
    method: z.string({ message: '方法不能为空' }).min(1, '方法不能为空'),
    name: z.string({ message: '名称不能为空' }).min(1, '名称不能为空'),
})

const bodySchema = z.object({
    items: z.array(itemSchema).min(1, '至少需要一个 API'),
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

    let normalizedItems: { path: string; method: string; name: string }[]
    try {
        normalizedItems = result.data.items.map(item => {
            const path = normalizeApiPath(item.path)
            const reason = validateApiPathFormat(path)
            if (reason) {
                throw new Error(`${reason}（path=${item.path}）`)
            }
            return {
                path,
                method: normalizeApiMethod(item.method),
                name: item.name,
            }
        })
    } catch (error: any) {
        return resError(event, 400, error?.message || '路径或方法格式错误')
    }

    // H3 修复：一次性拿全部已存在权限，不再受 1000 条分页限制
    const existing = await findApiPermissionsDao({}, { all: true })
    const existingSet = new Set(
        existing.items.map(p => `${p.method}:${p.path}`),
    )

    const newItems = normalizedItems.filter(
        item => !existingSet.has(`${item.method}:${item.path}`),
    )

    if (newItems.length === 0) {
        return resSuccess(event, '没有需要导入的新 API', { imported: 0 })
    }

    let importedCount = 0
    const failedItems: Array<{ method: string; path: string; reason: string }> = []

    try {
        const result = await createManyApiPermissionsDao(
            newItems.map(item => ({
                path: item.path,
                method: item.method,
                name: item.name,
                isPublic: false,
                status: 1,
            })),
        )
        importedCount = result.count
    } catch (error: any) {
        // 整批失败时把所有候选标为失败（path 格式已在前面校验通过，这里通常是 DB 层异常）
        const reason = error?.message || '未知错误'
        for (const item of newItems) {
            failedItems.push({ method: item.method, path: item.path, reason })
        }
        logger.error('[RBAC] 批量导入 API 权限失败', { count: newItems.length, error: reason })
    }

    if (importedCount > 0) {
        const importedKeys = newItems.map(i => `${i.method}:${i.path}`)
        await createAuditLogDao({
            action: 'api_permission_batch_import',
            targetType: 'api_permission',
            targetId: 0, // 批量操作无单一 target
            operatorId,
            oldValue: null,
            newValue: { count: importedCount, items: importedKeys },
            ip: getRequestIP(event, { xForwardedFor: true }) || null,
        })

        // H2：批量导入后必须刷新缓存（即使 isPublic 默认 false，仍要让用户权限重计算）
        await refreshPublicApiPermissions()
        clearAllUserPermissionCache()
    }

    return resSuccess(event, `成功导入 ${importedCount} 个 API 权限`, {
        imported: importedCount,
        total: normalizedItems.length,
        skipped: normalizedItems.length - importedCount - failedItems.length,
        failed: failedItems,
    })
})
