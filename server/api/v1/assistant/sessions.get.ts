/**
 * GET /api/v1/assistant/sessions
 *
 * 分页获取当前登录用户的 assistant 会话列表（按 updatedAt desc）。
 *
 * 查询参数：
 * - page     : 页码，正整数，默认 1
 * - pageSize : 每页数量，正整数，最大 100，默认 20
 *
 * 参见 spec §5.6.1。
 */

import { z } from 'zod'
import { listAssistantSessionsService } from '~~/server/services/assistant/assistantSession.service'

const QuerySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const parsed = QuerySchema.safeParse(getQuery(event))
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    try {
        const result = await listAssistantSessionsService({
            userId: user.id,
            page: parsed.data.page,
            pageSize: parsed.data.pageSize,
        })
        return resSuccess(event, '获取会话列表成功', result)
    } catch (error: any) {
        logger.error('获取 assistant 会话列表失败', {
            userId: user.id,
            error: error?.message,
        })
        return resError(event, 500, error?.message || '获取会话列表失败')
    }
})
