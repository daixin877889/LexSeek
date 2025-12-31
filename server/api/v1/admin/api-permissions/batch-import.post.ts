/**
 * 批量导入 API 权限
 * POST /api/v1/admin/api-permissions/batch-import
 * 
 * 将扫描发现的新 API 批量导入到数据库
 */
import { z } from 'zod'

const itemSchema = z.object({
    path: z.string().min(1),
    method: z.string().min(1),
    name: z.string().min(1),
})

const bodySchema = z.object({
    items: z.array(itemSchema).min(1, '至少需要一个 API'),
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

    const { items } = result.data

    // 查询已存在的权限，避免重复导入
    const existingPermissions = await findApiPermissionsDao({}, { page: 1, pageSize: 1000 })
    const existingSet = new Set(
        existingPermissions.items.map(p => `${p.method}:${p.path}`)
    )

    // 过滤出真正需要导入的新 API
    const newItems = items.filter(item => !existingSet.has(`${item.method}:${item.path}`))

    if (newItems.length === 0) {
        return resSuccess(event, '没有需要导入的新 API', { imported: 0 })
    }

    // 批量创建
    let importedCount = 0
    const importedIds: number[] = []

    for (const item of newItems) {
        try {
            const permission = await createApiPermissionDao({
                path: item.path,
                method: item.method,
                name: item.name,
                isPublic: false,
                status: 1,
            })
            importedCount++
            importedIds.push(permission.id)
        } catch (error) {
            // 忽略单个导入失败，继续处理其他
            console.error(`导入 API 权限失败: ${item.method} ${item.path}`, error)
        }
    }

    // 记录审计日志
    if (importedCount > 0) {
        await createAuditLogDao({
            action: 'api_permission_batch_import',
            targetType: 'api_permission',
            targetId: importedIds[0] || 0,
            operatorId: user.id,
            oldValue: null,
            newValue: { count: importedCount, ids: importedIds },
            ip: getRequestIP(event, { xForwardedFor: true }) || null,
        })
    }

    return resSuccess(event, `成功导入 ${importedCount} 个 API 权限`, {
        imported: importedCount,
        total: items.length,
        skipped: items.length - importedCount,
    })
})
