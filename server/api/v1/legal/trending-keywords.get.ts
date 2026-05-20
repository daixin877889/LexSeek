/**
 * 法律法规热搜词接口
 * GET /api/v1/legal/trending-keywords?scope=legal|article&limit=5
 *
 * 基于 Redis 7 天滑动窗口聚合，返回 top N 热搜词。
 */

import { z } from 'zod'
import { getTrendingKeywordsService } from '~~/server/services/legal/trending.service'

const querySchema = z.object({
    scope: z.enum(['legal', 'article']),
    limit: z.coerce.number().int().min(1).max(20).default(5),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const parsed = querySchema.safeParse(getQuery(event))
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]!.message)
    }

    const { scope, limit } = parsed.data
    const items = await getTrendingKeywordsService(scope, limit)
    return resSuccess(event, '获取成功', { items })
})
