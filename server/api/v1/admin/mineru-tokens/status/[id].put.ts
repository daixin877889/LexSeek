/**
 * 切换 MinerU Token 状态
 *
 * PUT /api/v1/admin/mineru-tokens/status/:id
 * Requirements: 3.1.1.5
 */

import { z } from 'zod'
import { toggleMineruTokenStatusService } from '~~/server/services/material/mineruToken.service'

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
        const token = await toggleMineruTokenStatusService(result.data.id)
        return resSuccess(event, '切换 MinerU Token 状态成功', token)
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === 'Token 不存在') {
            return resError(event, 404, error.message)
        }
        logger.error('切换 MinerU Token 状态失败：', error)
        return resError(event, 500, '切换 MinerU Token 状态失败')
    }
})
