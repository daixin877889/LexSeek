/**
 * 获取积分消耗项目详情
 *
 * GET /api/v1/admin/point-consumption-items/:id
 */

import { z } from 'zod'
import { getPointConsumptionItemByIdService } from '~~/server/services/point/pointConsumptionItems.service'

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
        const item = await getPointConsumptionItemByIdService(result.data.id)
        if (!item) {
            return resError(event, 404, '积分消耗项目不存在')
        }
        return resSuccess(event, '获取积分消耗项目详情成功', item)
    } catch (error) {
        logger.error('获取积分消耗项目详情失败：', error)
        return resError(event, 500, '获取积分消耗项目详情失败')
    }
})
