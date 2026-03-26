/**
 * 获取示范案例详情
 *
 * GET /api/v1/admin/demo-cases/:id
 * Requirements: 18.7
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
        const demoCase = await getDemoCaseByIdService(result.data.id)
        if (!demoCase) {
            return resError(event, 404, '示范案例不存在')
        }
        return resSuccess(event, '获取示范案例详情成功', demoCase)
    } catch (error) {
        logger.error('获取示范案例详情失败：', error)
        return resError(event, 500, '获取示范案例详情失败')
    }
})
