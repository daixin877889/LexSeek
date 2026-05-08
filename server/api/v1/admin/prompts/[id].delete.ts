/**
 * 删除提示词
 *
 * DELETE /api/v1/admin/prompts/:id
 *
 * Phase 4 改造：
 * - 接入审计日志 logPromptDelete
 * - 删除后失效所有关联节点的 nodeConfig 缓存（按 node.name）
 */

import { z } from 'zod'
import { invalidateNodeConfigCache } from '~~/server/services/agent-platform/nodeConfig/loader'
import { logPromptDelete } from '~~/server/services/rbac/auditLog.service'
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
        // 取旧值用于审计 oldValue
        const target = await prisma.prompts.findUnique({ where: { id: promptId } })
        if (!target || target.deletedAt) {
            return resError(event, 404, '提示词不存在')
        }

        // 取所有引用该 (name, type) 业务身份的节点（缓存失效用；invalidateNodeConfigCache 接 nodeName 不是 nodeId）
        // 阶段 F 改造：node_prompts 不再绑定具体 promptId，改按业务身份反查
        const links = await prisma.node_prompts.findMany({
            where: { promptName: target.name, promptType: target.type },
            select: { node: { select: { name: true } } },
        })

        // 软删
        await prisma.prompts.update({
            where: { id: promptId },
            data: { deletedAt: new Date() },
        })

        await logPromptDelete(event, operatorId, promptId, {
            name: target.name,
            type: target.type,
            version: target.version,
        })

        const uniqueNodeNames = new Set(links.map(l => l.node.name))
        for (const name of uniqueNodeNames) {
            invalidateNodeConfigCache(name)
        }

        return resSuccess(event, '删除提示词成功', null)
    } catch (error) {
        logger.error('删除提示词失败：', error)
        return resError(event, 500, '删除提示词失败')
    }
})
