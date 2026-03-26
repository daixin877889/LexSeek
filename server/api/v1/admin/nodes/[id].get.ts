/**
 * 获取节点详情
 *
 * GET /api/v1/admin/nodes/:id
 * Requirements: 15.1
 */

import { z } from 'zod'

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
        return resSuccess(event, '获取节点详情成功', node)
    } catch (error) {
        logger.error('获取节点详情失败：', error)
        return resError(event, 500, '获取节点详情失败')
    }
})
