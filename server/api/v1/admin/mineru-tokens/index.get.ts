/**
 * 获取 MinerU Token 列表
 *
 * GET /api/v1/admin/mineru-tokens
 * Requirements: 3.1.1.1
 */

import { z } from 'zod'

/** 查询参数验证 */
const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: z.coerce.number().int().min(0).max(1).optional(),
    keyword: z.string().optional(),
    orderBy: z.enum(['id', 'name', 'status', 'createdAt']).default('createdAt'),
    orderDir: z.enum(['asc', 'desc']).default('desc'),
})

export default defineEventHandler(async (event) => {
    const query = getQuery(event)
    const result = querySchema.safeParse(query)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!!.message)
    }

    const { page, pageSize, status, keyword, orderBy, orderDir } = result.data

    try {
        const data = await getMineruTokensService({
            page,
            pageSize,
            status,
            keyword,
            orderBy,
            orderDir,
        })
        return resSuccess(event, '获取 MinerU Token 列表成功', {
            items: data.list,
            total: data.total,
            totalPages: Math.ceil(data.total / pageSize),
        })
    } catch (error) {
        logger.error('获取 MinerU Token 列表失败：', error)
        return resError(event, 500, '获取 MinerU Token 列表失败')
    }
})
