/**
 * 设置默认模型
 *
 * PUT /api/v1/admin/models/default/:id
 */

import { z } from 'zod'
import { setDefaultModelService } from '~~/server/services/model/models.service'

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
        await setDefaultModelService(result.data.id)
        return resSuccess(event, '设置默认模型成功', { id: result.data.id })
    } catch (error: any) {
        if (error.message === '模型不存在') {
            return resError(event, 404, '模型不存在')
        }
        logger.error('设置默认模型失败：', error)
        return resError(event, 500, '设置默认模型失败')
    }
})
