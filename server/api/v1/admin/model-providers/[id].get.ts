/**
 * 获取模型提供商详情
 *
 * GET /api/v1/admin/model-providers/:id
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
        const provider = await findModelProviderByIdDao(result.data.id)
        if (!provider) {
            return resError(event, 404, '模型提供商不存在')
        }
        return resSuccess(event, '获取模型提供商详情成功', provider)
    } catch (error) {
        logger.error('获取模型提供商详情失败：', error)
        return resError(event, 500, '获取模型提供商详情失败')
    }
})
