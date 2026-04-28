/**
 * 更新 API 权限
 * PUT /api/v1/admin/api-permissions/:id
 *
 * 安全模型：
 * 1) 仅超管可调用——能扩张系统权限边界；
 * 2) path / method 修改时必须规范化（H5/C4）；
 * 3) 任何 path/method/status/isPublic 字段变更后，必须清空所有用户权限缓存，
 *    避免 5 分钟缓存窗口内出现"撤销不生效 / 改 path 旧用户匹配失败"等。
 */
import { z } from 'zod'
import { checkApiPermissionExistsDao, findApiPermissionByIdDao, updateApiPermissionDao } from '~~/server/services/rbac/apiPermission.dao'
import { logApiPermissionUpdate } from '~~/server/services/rbac/auditLog.service'
import { clearAllUserPermissionCache } from '~~/server/services/rbac/cache.service'
import {
    normalizeApiMethod,
    normalizeApiPath,
    requireSuperAdminGuard,
    validateApiPathFormat,
} from '~~/server/services/rbac/guard.service'
import { refreshPublicApiPermissions } from '~~/server/services/rbac/permission.service'

const bodySchema = z.object({
    path: z.string().min(1, '路径不能为空').max(200, '路径不能超过200个字符').optional(),
    method: z.string().min(1, '方法不能为空').max(10, '方法不能超过10个字符').optional(),
    name: z.string().min(1, '名称不能为空').max(100, '名称不能超过100个字符').optional(),
    description: z.string().max(500, '描述不能超过500个字符').nullable().optional(),
    groupId: z.number({ message: '分组ID必须是数字' }).int('分组ID必须是整数').positive().nullable().optional(),
    isPublic: z.boolean().optional(),
    status: z.number({ message: '状态必须是数字' }).int('状态必须是整数').min(0, '状态值无效').max(1, '状态值无效').optional(),
})

export default defineEventHandler(async (event) => {
    const guard = await requireSuperAdminGuard(event)
    if (!guard.ok) return guard.response
    const operatorId = guard.userId

    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isInteger(id) || id <= 0) {
        return resError(event, 400, '无效的权限 ID')
    }

    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, result.error.issues[0]?.message || '参数错误')
    }

    const existing = await findApiPermissionByIdDao(id)
    if (!existing) {
        return resError(event, 404, '权限不存在')
    }

    const updateData = { ...result.data }

    // 规范化 path/method
    if (typeof updateData.path === 'string') {
        const normalized = normalizeApiPath(updateData.path)
        const reason = validateApiPathFormat(normalized)
        if (reason) {
            return resError(event, 400, reason)
        }
        updateData.path = normalized
    }
    if (typeof updateData.method === 'string') {
        try {
            updateData.method = normalizeApiMethod(updateData.method)
        } catch (error: any) {
            return resError(event, 400, error?.message || '无效的 HTTP 方法')
        }
    }

    // 路径或方法变更时检查唯一约束
    if (updateData.path || updateData.method) {
        const newPath = updateData.path || existing.path
        const newMethod = updateData.method || existing.method
        const exists = await checkApiPermissionExistsDao(newPath, newMethod, id)
        if (exists) {
            return resError(event, 400, '该 API 权限已存在')
        }
    }

    const permission = await updateApiPermissionDao(id, updateData)

    await logApiPermissionUpdate(event, operatorId, id,
        { path: existing.path, method: existing.method, name: existing.name, isPublic: existing.isPublic },
        updateData,
    )

    // 公开状态变更必须刷新公开 API 缓存
    if (updateData.isPublic !== undefined && updateData.isPublic !== existing.isPublic) {
        await refreshPublicApiPermissions()
    }

    // path / method / status / isPublic 任何变更都要清用户缓存
    clearAllUserPermissionCache()

    return resSuccess(event, '更新成功', permission)
})
