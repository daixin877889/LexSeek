/**
 * 管理端：获取节点当前关联的 Skills 列表
 *
 * GET /api/v1/admin/nodes/:id/skills
 * 返回该节点所有关联的 skill 名称（含停用 skill，不做状态过滤）。
 * 主要用于编辑页回显当前选中的 skills。
 *
 * 鉴权：依赖 server/middleware/03.permission.ts 的 super_admin 拦截
 *
 * @see docs/superpowers/plans/2026-04-26-ai-unify-stage-2-factory-and-vertical.md Task 21
 */

import { z } from 'zod'
import { getNodeByIdService } from '~~/server/services/node/node.service'

const paramsSchema = z.object({
    id: z.coerce.number().int().positive('节点 ID 必须是正整数'),
})

export default defineEventHandler(async (event) => {
    const rawId = getRouterParam(event, 'id')
    const paramsResult = paramsSchema.safeParse({ id: rawId })
    if (!paramsResult.success) {
        return resError(event, 400, '参数错误：' + paramsResult.error.issues[0]!.message)
    }
    const nodeId = paramsResult.data.id

    const node = await getNodeByIdService(nodeId)
    if (!node) {
        return resError(event, 404, '节点不存在')
    }

    try {
        const rows = await prisma.node_skills.findMany({
            where: { nodeId },
            select: { skillName: true, priority: true },
            orderBy: { priority: 'asc' },
        })
        return resSuccess(event, '获取节点 skills 成功', {
            nodeId,
            skills: rows.map(r => ({ skillName: r.skillName, priority: r.priority })),
        })
    } catch (err) {
        logger.error('[admin/nodes/skills] 获取失败：', err)
        return resError(event, 500, '获取节点 skills 失败')
    }
})
