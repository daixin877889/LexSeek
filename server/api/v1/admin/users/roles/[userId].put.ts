/**
 * 分配用户角色
 * PUT /api/v1/admin/users/roles/:userId
 *
 * 安全模型（必读）：
 * 1) 仅超管可调用——这是 RBAC 的"生命之钥"，给非超管授权等同把 root 给出去；
 * 2) 禁止给自己改角色——避免单点提权 / 误把自己降级；
 * 3) 全量替换语义——传入的 roleIds 即为该用户最终的角色集合；
 * 4) 校验角色都是启用的——避免把已禁用 / 已软删的角色重新激活授权；
 * 5) 至少保留一名超管——若操作导致系统无超管，整笔事务回滚。
 */
import { z } from 'zod'
import { logUserAssignRole } from '~~/server/services/rbac/auditLog.service'
import { clearUserPermissionCache } from '~~/server/services/rbac/cache.service'
import {
    ensureSuperAdminRemainingGuard,
    forbidSelfTargetGuard,
    requireSuperAdminGuard,
} from '~~/server/services/rbac/guard.service'

const bodySchema = z.object({
    roleIds: z.array(
        z.number({ message: '角色ID必须是数字' })
            .int('角色ID必须是整数')
            .positive('角色ID必须为正数'),
    ),
})

export default defineEventHandler(async (event) => {
    // 1. 必须是超管
    const guard = await requireSuperAdminGuard(event)
    if (!guard.ok) return guard.response
    const operatorId = guard.userId

    // 2. 解析路径参数
    const userId = Number(getRouterParam(event, 'userId'))
    if (!Number.isInteger(userId) || userId <= 0) {
        return resError(event, 400, '无效的用户 ID')
    }

    // 3. 禁止改自己
    const selfGuard = forbidSelfTargetGuard(event, operatorId, userId, '修改')
    if (!selfGuard.ok) return selfGuard.response

    // 4. 解析请求体
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, result.error.issues[0]?.message || '参数错误')
    }
    // 去重，防止前端误传重复 ID 导致 createMany 抛唯一约束
    const roleIds = Array.from(new Set(result.data.roleIds))

    // 5. 检查目标用户存在且未软删 / 未禁用
    const targetUser = await prisma.users.findFirst({
        where: { id: userId, deletedAt: null },
        select: { id: true, status: true },
    })
    if (!targetUser) {
        return resError(event, 404, '用户不存在')
    }

    // 6. 检查角色都是启用的
    if (roleIds.length > 0) {
        const roles = await prisma.roles.findMany({
            where: { id: { in: roleIds }, deletedAt: null, status: 1 },
            select: { id: true },
        })
        if (roles.length !== roleIds.length) {
            return resError(event, 400, '部分角色不存在或已禁用')
        }
    }

    // 7. 事务：upsert 增量授权 → 软删不在列表里的旧关联 → 校验"系统至少保留一名超管"
    //    用 (userId, roleId) 复合唯一键 upsert，避免"全删全建"模式下唯一约束撞车：
    //    userRoles 表上的 @@unique([userId, roleId]) 不带 deletedAt，软删行仍占用唯一名额，
    //    若先 updateMany 软删再 createMany 重插相同 (userId, roleId)，PG 必抛唯一约束冲突。
    //    把"剩余超管检查"放进同一个事务，避免并发场景下两个请求同时撤销最后两个超管。
    try {
        await prisma.$transaction(async (tx) => {
            const now = new Date()

            for (const roleId of roleIds) {
                await tx.userRoles.upsert({
                    where: { idx_user_role_unique: { userId, roleId } },
                    create: { userId, roleId },
                    update: {
                        // 关键：之前被软删（撤销）过的关联，重新分配时清掉 deletedAt 复用旧行
                        deletedAt: null,
                        updatedAt: now,
                    },
                })
            }

            // 不在新集合里的旧关联：软删而非物理删除，保留历史便于审计追溯
            await tx.userRoles.updateMany({
                where: roleIds.length > 0
                    ? { userId, roleId: { notIn: roleIds }, deletedAt: null }
                    : { userId, deletedAt: null },
                data: { deletedAt: now, updatedAt: now },
            })

            // 这里不用 excludeUserId——userRoles 已经在同一个事务里更新过
            const remaining = await ensureSuperAdminRemainingGuard(tx)
            if (!remaining.ok) {
                throw new Error(remaining.reason)
            }
        })
    } catch (error: any) {
        const msg = error?.message || '分配失败'
        if (msg.includes('超级管理员')) {
            return resError(event, 400, msg)
        }
        logger.error('[RBAC] 分配用户角色失败', { userId, roleIds, error: msg })
        return resError(event, 500, '分配失败，请稍后重试')
    }

    // 8. 审计 + 清缓存（只清目标用户；操作人本身的角色没动）
    await logUserAssignRole(event, operatorId, userId, roleIds)
    clearUserPermissionCache(userId)

    return resSuccess(event, '分配成功', { count: roleIds.length })
})
