/**
 * 获取节点详情
 *
 * GET /api/v1/admin/nodes/:id
 * Requirements: 15.1
 *
 * 返回体在原 node 字段基础上额外附加 `prompts: NodePromptRef[]`：
 *  - 来源：node_prompts 关联表（多对多），按 displayOrder 升序
 *  - 仅返回未软删的 prompts
 *  - 每条带 displayOrder + referencedByCount（被多少个节点引用）
 */

import { z } from 'zod'
import { prisma } from '~~/server/utils/db'
import { getNodeByIdService } from '~~/server/services/node/node.service'

/** 路由参数验证 */
const paramsSchema = z.object({
    id: z.coerce.number().int().positive('ID必须是正整数'),
})

export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id')
    const result = paramsSchema.safeParse({ id })
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!!.message)
    }

    try {
        const node = await getNodeByIdService(result.data.id)
        if (!node) {
            return resError(event, 404, '节点不存在')
        }

        // 单独查询关联的 prompts —— 跨多对多 + _count 引用计数
        const nodePromptRows = await prisma.node_prompts.findMany({
            where: {
                nodeId: result.data.id,
                prompt: { deletedAt: null },
            },
            orderBy: { displayOrder: 'asc' },
            include: {
                prompt: {
                    include: { _count: { select: { nodePrompts: true } } },
                },
            },
        })

        const prompts = nodePromptRows.map((np) => ({
            id: np.prompt.id,
            name: np.prompt.name,
            title: np.prompt.title,
            type: np.prompt.type,
            status: np.prompt.status,
            version: np.prompt.version,
            displayOrder: np.displayOrder,
            referencedByCount: np.prompt._count.nodePrompts,
        }))

        return resSuccess(event, '获取节点详情成功', { ...node, prompts })
    } catch (error) {
        logger.error('获取节点详情失败：', error)
        return resError(event, 500, '获取节点详情失败')
    }
})
