/**
 * 删除节点
 *
 * DELETE /api/v1/admin/nodes/:id
 * Requirements: 15.4
 */

import { z } from 'zod'
import { deleteNodeService } from '~~/server/services/node/node.service'
import { invalidateNodeConfigCache } from '~~/server/services/agent-platform/nodeConfig/loader'
import { prisma } from '~~/server/utils/db'

/** 路由参数验证 */
const paramsSchema = z.object({
    id: z.coerce.number().int().positive('ID必须是正整数'),
})

export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id')
    const result = paramsSchema.safeParse({ id })
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!.message)
    }

    try {
        // 删除前取出 name —— invalidateNodeConfigCache 接节点名而非 id
        const node = await prisma.nodes.findUnique({
            where: { id: result.data.id },
            select: { name: true },
        })

        await deleteNodeService(result.data.id)

        // 节点已删除，失效 nodeConfig 缓存（本地清 + 广播给其它实例）
        if (node) invalidateNodeConfigCache(node.name)

        return resSuccess(event, '删除节点成功', null)
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === '节点不存在') {
            return resError(event, 404, error.message)
        }
        logger.error('删除节点失败：', error)
        return resError(event, 500, '删除节点失败')
    }
})
