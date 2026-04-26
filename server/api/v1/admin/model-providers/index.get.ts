/**
 * 获取模型提供商列表
 *
 * GET /api/v1/admin/model-providers
 */

import { z } from 'zod'
import { findManyModelProvidersDao } from '~~/server/services/model/modelProviders.dao'

/** 查询参数验证 */
const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export default defineEventHandler(async (event) => {
    const query = getQuery(event)
    const result = querySchema.safeParse(query)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!!.message)
    }

    const { page, pageSize } = result.data

    try {
        const data = await findManyModelProvidersDao({ page, pageSize })
        return resSuccess(event, '获取模型提供商列表成功', {
            items: data.list,
            total: data.total,
            totalPages: Math.ceil(data.total / pageSize),
        })
    } catch (error) {
        logger.error('获取模型提供商列表失败：', error)
        return resError(event, 500, '获取模型提供商列表失败')
    }
})
