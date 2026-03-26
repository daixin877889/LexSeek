/**
 * 获取模型 API 密钥列表
 *
 * GET /api/v1/admin/model-api-keys
 */

import { z } from 'zod'

/** 查询参数验证 */
const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    providerId: z.coerce.number().int().positive().optional(),
    status: z.coerce.number().int().min(0).max(1).optional(),
})

export default defineEventHandler(async (event) => {
    const query = getQuery(event)
    const result = querySchema.safeParse(query)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!!.message)
    }

    const { page, pageSize, providerId, status } = result.data

    try {
        const data = await findManyModelApiKeysDao({ page, pageSize, providerId, status })
        // 隐藏 API 密钥的部分内容
        const items = data.list.map(item => ({
            ...item,
            apiKey: maskApiKey(item.apiKey),
        }))
        return resSuccess(event, '获取API密钥列表成功', {
            items,
            total: data.total,
            totalPages: Math.ceil(data.total / pageSize),
        })
    } catch (error) {
        logger.error('获取API密钥列表失败：', error)
        return resError(event, 500, '获取API密钥列表失败')
    }
})

/** 隐藏 API 密钥中间部分 */
function maskApiKey(apiKey: string): string {
    if (apiKey.length <= 8) {
        return '****'
    }
    return apiKey.slice(0, 4) + '****' + apiKey.slice(-4)
}
