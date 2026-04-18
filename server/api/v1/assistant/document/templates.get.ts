/**
 * GET /api/v1/assistant/document/templates
 *
 * 列出文书模板。支持 scope/category/q 过滤和 skip/take 分页。
 * 普通用户可见所有 global 模板 + 自己的 user 模板（在 DAO 层做权限过滤）。
 *
 * Query 参数：
 * - scope: 'global' | 'user'（可选）
 * - category: 分类 key（可选）
 * - q: 名称模糊搜索（可选）
 * - skip: 偏移量，默认 0
 * - take: 每页数量，最大 100，默认 20
 *
 * 参见 spec §2.3
 */

import { z } from 'zod'
import { listDocumentTemplatesDAO } from '~~/server/services/assistant/document/documentTemplate.dao'

const QuerySchema = z.object({
    scope: z.enum(['global', 'user']).optional(),
    category: z.string().optional(),
    q: z.string().optional(),
    skip: z.coerce.number().int().nonnegative().optional().default(0),
    take: z.coerce.number().int().positive().max(100).optional().default(20),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const parsed = QuerySchema.safeParse(getQuery(event))
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    try {
        const { scope, category, q, skip, take } = parsed.data
        const result = await listDocumentTemplatesDAO({
            scope,
            category,
            q,
            skip,
            take,
            viewerUserId: user.id,
        })
        return resSuccess(event, '获取模板列表成功', {
            list: result.list,
            total: result.total,
            skip,
            take,
        })
    } catch (error: any) {
        logger.error('获取文书模板列表失败', { userId: user.id, error: error?.message })
        return resError(event, 500, error?.message || '获取模板列表失败')
    }
})
