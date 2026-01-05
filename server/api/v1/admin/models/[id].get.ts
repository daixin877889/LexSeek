/**
 * 获取模型详情
 *
 * GET /api/v1/admin/models/:id
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
        return resError(event, 400, '参数错误：' + result.error.issues[0].message)
    }

    try {
        const model = await findModelByIdDao(result.data.id)
        if (!model) {
            return resError(event, 404, '模型不存在')
        }
        return resSuccess(event, '获取模型详情成功', model)
    } catch (error) {
        logger.error('获取模型详情失败：', error)
        return resError(event, 500, '获取模型详情失败')
    }
})
