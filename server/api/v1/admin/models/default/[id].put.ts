/**
 * 设置默认模型
 *
 * PUT /api/v1/admin/models/default/:id
 */

import { z } from 'zod'
import type { ModelType } from '#shared/types/model'

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
        // 检查模型是否存在
        const existing = await findModelByIdDao(result.data.id)
        if (!existing) {
            return resError(event, 404, '模型不存在')
        }

        await setDefaultModelDao(result.data.id, existing.modelType as ModelType)
        return resSuccess(event, '设置默认模型成功', { id: result.data.id })
    } catch (error) {
        logger.error('设置默认模型失败：', error)
        return resError(event, 500, '设置默认模型失败')
    }
})
