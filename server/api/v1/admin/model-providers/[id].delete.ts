/**
 * 删除模型提供商
 *
 * DELETE /api/v1/admin/model-providers/:id
 */

import { z } from 'zod'
import { findModelProviderByIdDao, softDeleteModelProviderDao } from '~~/server/services/model/modelProviders.dao'

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
        // 检查提供商是否存在
        const existing = await findModelProviderByIdDao(result.data.id)
        if (!existing) {
            return resError(event, 404, '模型提供商不存在')
        }

        await softDeleteModelProviderDao(result.data.id)
        return resSuccess(event, '删除模型提供商成功', null)
    } catch (error) {
        logger.error('删除模型提供商失败：', error)
        return resError(event, 500, '删除模型提供商失败')
    }
})
