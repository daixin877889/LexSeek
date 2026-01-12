/**
 * 删除 MinerU Token
 *
 * DELETE /api/v1/admin/mineru-tokens/:id
 * Requirements: 3.1.1.4
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
        await deleteMineruTokenService(result.data.id)
        return resSuccess(event, '删除 MinerU Token 成功', null)
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === 'Token 不存在') {
            return resError(event, 404, error.message)
        }
        logger.error('删除 MinerU Token 失败：', error)
        return resError(event, 500, '删除 MinerU Token 失败')
    }
})
