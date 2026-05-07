/**
 * 激活提示词版本
 *
 * PUT /api/v1/admin/prompts/activate/:id
 *
 * Phase 4 改造：
 * - 解耦节点：版本互斥范围由 (nodeId, name, type) 收紧为 (name, type)
 * - 接入审计日志 logPromptUpdate（携带 oldVersion / newVersion）
 * - 激活后失效所有关联节点的 nodeConfig 缓存（按 node.name）
 *
 * 同 (name, type) 维度只能有一个版本处于生效状态，激活时其他版本自动置 0
 */

import { z } from 'zod'
import { invalidateNodeConfigCache } from '~~/server/services/agent-platform/nodeConfig/loader'
import { logPromptUpdate } from '~~/server/services/rbac/auditLog.service'
import { prisma } from '~~/server/utils/db'

/** 路由参数验证 */
const paramsSchema = z.object({
    id: z.coerce.number().int().positive('ID必须是正整数'),
})

export default defineEventHandler(async (event) => {
    const operatorId = event.context.auth?.user?.id
    if (!operatorId) {
        return resError(event, 401, '请先登录')
    }

    const id = getRouterParam(event, 'id')
    const paramsResult = paramsSchema.safeParse({ id })
    if (!paramsResult.success) {
        return resError(event, 400, '参数错误：' + paramsResult.error.issues[0]!.message)
    }
    const promptId = paramsResult.data.id

    try {
        const old = await prisma.prompts.findUnique({ where: { id: promptId } })
        if (!old || old.deletedAt) {
            return resError(event, 404, '提示词不存在')
        }

        // 已激活直接返回（保持幂等）
        if (old.status === 1) {
            return resSuccess(event, '提示词已是激活状态', old)
        }

        // 同 name + type 其他版本置 0；当前版本激活
        const updated = await prisma.$transaction(async (tx) => {
            await tx.prompts.updateMany({
                where: {
                    name: old.name,
                    type: old.type,
                    status: 1,
                    deletedAt: null,
                    id: { not: promptId },
                },
                data: { status: 0, updatedAt: new Date() },
            })
            return tx.prompts.update({
                where: { id: promptId },
                data: { status: 1, updatedAt: new Date() },
            })
        })

        await logPromptUpdate(
            event,
            operatorId,
            promptId,
            { version: old.version, status: old.status },
            { version: updated.version, status: updated.status },
        )

        // 失效所有引用该 (name, type) 业务身份的节点缓存
        // 阶段 F 改造：node_prompts 不再绑定具体 promptId，改按业务身份反查
        const links = await prisma.node_prompts.findMany({
            where: { promptName: old.name, promptType: old.type },
            select: { node: { select: { name: true } } },
        })
        const uniqueNodeNames = new Set(links.map(l => l.node.name))
        for (const name of uniqueNodeNames) {
            invalidateNodeConfigCache(name)
        }

        return resSuccess(event, '激活提示词成功', updated)
    } catch (error) {
        logger.error('激活提示词失败：', error)
        return resError(event, 500, '激活提示词失败')
    }
})
