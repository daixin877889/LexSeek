/**
 * 设置默认 API 密钥
 *
 * PUT /api/v1/admin/model-api-keys/default/:id
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
        // 检查密钥是否存在
        const existing = await findModelApiKeyByIdDao(result.data.id)
        if (!existing) {
            return resError(event, 404, 'API密钥不存在')
        }

        await setDefaultModelApiKeyDao(result.data.id, existing.providerId)
        return resSuccess(event, '设置默认API密钥成功', null)
    } catch (error) {
        logger.error('设置默认API密钥失败：', error)
        return resError(event, 500, '设置默认API密钥失败')
    }
})
