/**
 * 获取提示词版本历史
 *
 * GET /api/v1/admin/prompts/versions/:id
 * Requirements: 15.8
 *
 * 根据提示词ID获取同名称、同类型的所有版本历史
 */

import { z } from 'zod'

/** 路由参数验证 */
const paramsSchema = z.object({
    id: z.coerce.number().int().positive('ID必须是正整数'),
})

export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id')
    const paramsResult = paramsSchema.safeParse({ id })
    if (!paramsResult.success) {
        return resError(event, 400, '参数错误：' + paramsResult.error.issues[0].message)
    }

    try {
        const versions = await getPromptVersionsService(paramsResult.data.id)
        return resSuccess(event, '获取提示词版本历史成功', versions)
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === '提示词不存在') {
            return resError(event, 404, error.message)
        }
        logger.error('获取提示词版本历史失败：', error)
        return resError(event, 500, '获取提示词版本历史失败')
    }
})
