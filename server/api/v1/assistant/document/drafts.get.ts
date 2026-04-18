/**
 * GET /api/v1/assistant/document/drafts
 *
 * 列出当前用户的文书草稿。支持 caseId 过滤和 skip/take 分页。
 *
 * Query 参数：
 * - caseId: 案件 ID（可选），不传返回用户所有草稿
 * - skip: 偏移量，默认 0
 * - take: 每页数量，最大 100，默认 20
 *
 * 参见 spec §3.11
 */

import { z } from 'zod'
import { listDocumentDraftsDAO } from '~~/server/services/assistant/document/documentDraft.dao'

const QuerySchema = z.object({
    caseId: z.coerce.number().int().positive().optional(),
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

    const { caseId, skip, take } = parsed.data
    const result = await listDocumentDraftsDAO({ userId: user.id, caseId, skip, take })

    const items = result.list.map((draft: any) => ({
        id: draft.id,
        templateId: draft.templateId,
        templateName: draft.template?.name ?? null,
        caseId: draft.caseId,
        sessionId: draft.sessionId,
        status: draft.status,
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
    }))

    return resSuccess(event, '获取草稿列表成功', {
        items,
        total: result.total,
        skip,
        take,
    })
})
