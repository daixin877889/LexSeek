/**
 * 删除模型 API 密钥
 *
 * DELETE /api/v1/admin/model-api-keys/:id
 */

import { z } from 'zod'
import { findModelApiKeyByIdDao, softDeleteModelApiKeyDao } from '~~/server/services/model/modelApiKeys.dao'

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
        // 检查密钥是否存在
        const existing = await findModelApiKeyByIdDao(result.data.id)
        if (!existing) {
            return resError(event, 404, 'API密钥不存在')
        }

        await softDeleteModelApiKeyDao(result.data.id)
        return resSuccess(event, '删除API密钥成功', null)
    } catch (error) {
        logger.error('删除API密钥失败：', error)
        return resError(event, 500, '删除API密钥失败')
    }
})
