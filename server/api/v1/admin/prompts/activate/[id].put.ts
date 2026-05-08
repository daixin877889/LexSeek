/**
 * 激活提示词版本
 *
 * PUT /api/v1/admin/prompts/activate/:id
 * Requirements: 15.7
 *
 * 同一节点、同一类型下只能有一个版本处于生效状态
 * 激活新版本时其他版本自动设为未生效
 */

import { z } from 'zod'
import { activatePromptService } from '~~/server/services/node/prompt.service'

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
        const prompt = await activatePromptService(paramsResult.data.id)
        return resSuccess(event, '激活提示词成功', prompt)
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === '提示词不存在') {
            return resError(event, 404, error.message)
        }
        logger.error('激活提示词失败：', error)
        return resError(event, 500, '激活提示词失败')
    }
})
