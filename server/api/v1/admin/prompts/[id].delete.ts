/**
 * 删除提示词
 *
 * DELETE /api/v1/admin/prompts/:id
 * Requirements: 15.5
 */

import { z } from 'zod'
import { deletePromptService } from '~~/server/services/node/prompt.service'

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
        await deletePromptService(paramsResult.data.id)
        return resSuccess(event, '删除提示词成功', null)
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === '提示词不存在') {
            return resError(event, 404, error.message)
        }
        logger.error('删除提示词失败：', error)
        return resError(event, 500, '删除提示词失败')
    }
})
