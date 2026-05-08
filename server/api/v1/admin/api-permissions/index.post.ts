/**
 * 创建 API 权限
 * POST /api/v1/admin/api-permissions
 *
 * 安全模型：
 * 1) 仅超管可调用——能扩张系统权限边界；
 * 2) path / method 必须经 normalizeApiPath / normalizeApiMethod 规范化后入库
 *    （H5），保证全表一致；
 * 3) 入库前 validateApiPathFormat 拒绝任何 [/]，根除 C4 类污染。
 */
import { z } from 'zod'
import { checkApiPermissionExistsDao, createApiPermissionDao } from '~~/server/services/rbac/apiPermission.dao'
import { logApiPermissionCreate } from '~~/server/services/rbac/auditLog.service'
import { clearAllUserPermissionCache } from '~~/server/services/rbac/cache.service'
import {
    normalizeApiMethod,
    normalizeApiPath,
    requireSuperAdminGuard,
    validateApiPathFormat,
} from '~~/server/services/rbac/guard.service'
import { refreshPublicApiPermissions } from '~~/server/services/rbac/permission.service'

const bodySchema = z.object({
    path: z.string({ message: '路径不能为空' }).min(1, '路径不能为空').max(200, '路径不能超过200个字符'),
    method: z.string({ message: '方法不能为空' }).min(1, '方法不能为空').max(10, '方法不能超过10个字符'),
    name: z.string({ message: '名称不能为空' }).min(1, '名称不能为空').max(100, '名称不能超过100个字符'),
    description: z.string().max(500, '描述不能超过500个字符').optional(),
    groupId: z.number({ message: '分组ID必须是数字' }).int('分组ID必须是整数').positive().optional(),
    isPublic: z.boolean().default(false),
    status: z.number({ message: '状态必须是数字' }).int('状态必须是整数').min(0, '状态值无效').max(1, '状态值无效').default(1),
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

    // 规范化 + 校验
    const normalizedPath = normalizeApiPath(result.data.path)
    const reason = validateApiPathFormat(normalizedPath)
    if (reason) {
        return resError(event, 400, reason)
    }
    let normalizedMethod: string
    try {
        normalizedMethod = normalizeApiMethod(result.data.method)
    } catch (error: any) {
        return resError(event, 400, error?.message || '无效的 HTTP 方法')
    }

    const data = {
        ...result.data,
        path: normalizedPath,
        method: normalizedMethod,
    }

    // 唯一约束 (path, method) 兜底检查（DB 层也有约束，提前给友好错误）
    const exists = await checkApiPermissionExistsDao(data.path, data.method)
    if (exists) {
        return resError(event, 400, '该 API 权限已存在')
    }

    const permission = await createApiPermissionDao(data)

    await logApiPermissionCreate(event, operatorId, permission.id, data)

    // 如果是公开权限，必须刷新公开 API 缓存
    if (data.isPublic) {
        await refreshPublicApiPermissions()
        // 公开权限新增也会让"非公开变公开"语义生效，需清用户缓存
        clearAllUserPermissionCache()
    }

    return resSuccess(event, '创建成功', permission)
})
