/**
 * 分配角色 API 权限
 * PUT /api/v1/admin/roles/api-permissions/:roleId
 *
 * 安全模型：
 * 1) 仅超管可调用——通过给非超管角色加 user-role-管理权限就能联动提权（C2 跳板）；
 * 2) 禁止修改 super_admin 角色的权限（其权限通过代码旁路放行，强制 RBAC 表静止）；
 * 3) permissionIds 必须全部存在且未软删 / 未禁用——避免给角色重新激活已撤销的权限；
 * 4) 全量替换 + 软删旧关联 + 创建新关联，事务内完成。
 */
import { z } from 'zod'
import { logRoleAssignApiPermission } from '~~/server/services/rbac/auditLog.service'
import { requireSuperAdminGuard } from '~~/server/services/rbac/guard.service'
import { refreshRoleUsersPermissions } from '~~/server/services/rbac/permission.service'
import { setRoleApiPermissionsDao } from '~~/server/services/rbac/roleApiPermission.dao'

const bodySchema = z.object({
    permissionIds: z.array(
        z.number({ message: '权限ID必须是数字' })
            .int('权限ID必须是整数')
            .positive('权限ID必须为正数'),
    ),
})

export default defineEventHandler(async (event) => {
    // 1. 必须是超管
    const guard = await requireSuperAdminGuard(event)
    if (!guard.ok) return guard.response
    const operatorId = guard.userId

    const roleId = Number(getRouterParam(event, 'roleId'))
    if (!Number.isInteger(roleId) || roleId <= 0) {
        return resError(event, 400, '无效的角色 ID')
    }

    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, result.error.issues[0]?.message || '参数错误')
    }
    const permissionIds = Array.from(new Set(result.data.permissionIds))

    // 2. 角色必须存在且未软删
    const role = await prisma.roles.findFirst({
        where: { id: roleId, deletedAt: null },
        select: { id: true, code: true },
    })
    if (!role) {
        return resError(event, 404, '角色不存在')
    }

    // 3. 禁止改超管角色（其权限是代码旁路放行的）
    if (role.code === 'super_admin') {
        return resError(event, 403, '不能修改超级管理员角色的权限')
    }

    // 4. 校验所有权限存在 / 未软删 / 未禁用
    if (permissionIds.length > 0) {
        const validCount = await prisma.apiPermissions.count({
            where: {
                id: { in: permissionIds },
                deletedAt: null,
                status: 1,
            },
        })
        if (validCount !== permissionIds.length) {
            return resError(event, 400, '部分权限不存在或已禁用')
        }
    }

    // 5. 全量替换
    await setRoleApiPermissionsDao(roleId, permissionIds)

    // 6. 审计 + 刷新该角色所有用户的缓存
    await logRoleAssignApiPermission(event, operatorId, roleId, permissionIds)
    await refreshRoleUsersPermissions(roleId)

    return resSuccess(event, '分配成功', { count: permissionIds.length })
})
