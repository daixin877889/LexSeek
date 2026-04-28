/**
 * 更新角色
 * PUT /api/v1/admin/roles/:id
 *
 * 安全模型：
 * 1) 仅超管可调用；
 * 2) 显式拒绝任何 code 修改尝试（M3 防御深度）——code 是 RBAC 的"系统保留代码"
 *    锚点，运营改名会破坏 super_admin 检查；
 * 3) 禁止修改 super_admin 角色（保留为只读）；
 * 4) 禁用 super_admin 时校验"系统至少保留一名超管"。
 */
import { z } from 'zod'
import { logRoleUpdate } from '~~/server/services/rbac/auditLog.service'
import {
    ensureSuperAdminRemainingGuard,
    requireSuperAdminGuard,
} from '~~/server/services/rbac/guard.service'
import { refreshRoleUsersPermissions } from '~~/server/services/rbac/permission.service'

const bodySchema = z.object({
    name: z.string().min(1, '角色名称不能为空').max(50, '角色名称不能超过50个字符').optional(),
    description: z.string().max(200, '描述不能超过200个字符').optional(),
    status: z.number({ message: '状态必须是数字' }).int('状态必须是整数').min(0, '状态值无效').max(1, '状态值无效').optional(),
})

export default defineEventHandler(async (event) => {
    const guard = await requireSuperAdminGuard(event)
    if (!guard.ok) return guard.response
    const operatorId = guard.userId

    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isInteger(id) || id <= 0) {
        return resError(event, 400, '无效的角色 ID')
    }

    const body = await readBody(event)

    // M3：显式拒绝 code 修改（即使前端传了，也拒绝）
    if (body && typeof body === 'object' && 'code' in body) {
        return resError(event, 400, '不允许修改角色代码')
    }

    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, result.error.issues[0]?.message || '参数错误')
    }

    const existing = await prisma.roles.findFirst({
        where: { id, deletedAt: null },
    })
    if (!existing) {
        return resError(event, 404, '角色不存在')
    }

    // 禁止修改 super_admin 角色（包括停用 / 改名 / 改描述）
    if (existing.code === 'super_admin') {
        return resError(event, 403, '不能修改超级管理员角色')
    }

    const updateData = result.data

    const role = await prisma.roles.update({
        where: { id },
        data: { ...updateData, updatedAt: new Date() },
    })

    await logRoleUpdate(event, operatorId, id,
        { name: existing.name, description: existing.description, status: existing.status },
        updateData,
    )

    // 状态变更时刷新该角色所有用户的权限缓存
    if (updateData.status !== undefined && updateData.status !== existing.status) {
        await refreshRoleUsersPermissions(id)
    }

    return resSuccess(event, '更新成功', role)
})
