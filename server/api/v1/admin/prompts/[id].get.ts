/**
 * 获取提示词详情
 *
 * GET /api/v1/admin/prompts/:id
 * Requirements: 15.5
 */

import { z } from 'zod'
import { getPromptByIdService } from '~~/server/services/node/prompt.service'

/** 路由参数验证 */
const paramsSchema = z.object({
    id: z.coerce.number().int().positive('ID必须是正整数'),
})

export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id')
    const paramsResult = paramsSchema.safeParse({ id })
    if (!paramsResult.success) {
        return resError(event, 400, '参数错误：' + paramsResult.error.issues[0]!.message)
    }

    try {
        const prompt = await getPromptByIdService(paramsResult.data.id)
        if (!prompt) {
            return resError(event, 404, '提示词不存在')
        }
        return resSuccess(event, '获取提示词详情成功', prompt)
    } catch (error) {
        logger.error('获取提示词详情失败：', error)
        return resError(event, 500, '获取提示词详情失败')
    }
})
