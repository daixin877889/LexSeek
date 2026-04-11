/**
 * 获取模型列表
 *
 * GET /api/v1/admin/models
 */

import { z } from 'zod'
import { MODEL_TYPES } from '#shared/types/model'
import type { ModelType } from '#shared/types/model'

/** 查询参数验证 */
const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    modelType: z.enum(MODEL_TYPES).optional(),
    providerId: z.coerce.number().int().positive().optional(),
    status: z.coerce.number().int().min(0).max(1).optional(),
    orderBy: z.enum(['priority', 'name', 'createdAt']).default('priority'),
    orderDir: z.enum(['asc', 'desc']).default('asc'),
})

export default defineEventHandler(async (event) => {
    const query = getQuery(event)
    const result = querySchema.safeParse(query)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!!.message)
    }

    const { page, pageSize, modelType, providerId, status, orderBy, orderDir } = result.data

    try {
        const data = await getModelsService({
            page,
            pageSize,
            modelType: modelType as ModelType | undefined,
            providerId,
            status,
            orderBy,
            orderDir,
        })
        return resSuccess(event, '获取模型列表成功', {
            items: data.list,
            total: data.total,
            totalPages: Math.ceil(data.total / pageSize),
        })
    } catch (error) {
        logger.error('获取模型列表失败：', error)
        return resError(event, 500, '获取模型列表失败')
    }
})
