/**
 * 获取模型 API 密钥详情
 *
 * GET /api/v1/admin/model-api-keys/:id
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
        return resError(event, 400, '参数错误：' + result.error.issues[0]!!.message)
    }

    try {
        const apiKey = await findModelApiKeyByIdDao(result.data.id)
        if (!apiKey) {
            return resError(event, 404, 'API密钥不存在')
        }
        // 隐藏 API 密钥的部分内容
        return resSuccess(event, '获取API密钥详情成功', {
            ...apiKey,
            apiKey: maskApiKey(apiKey.apiKey),
        })
    } catch (error) {
        logger.error('获取API密钥详情失败：', error)
        return resError(event, 500, '获取API密钥详情失败')
    }
})

/** 隐藏 API 密钥中间部分 */
function maskApiKey(apiKey: string): string {
    if (apiKey.length <= 8) {
        return '****'
    }
    return apiKey.slice(0, 4) + '****' + apiKey.slice(-4)
}
