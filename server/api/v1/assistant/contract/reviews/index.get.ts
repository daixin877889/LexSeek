/**
 * GET /api/v1/assistant/contract/reviews
 *
 * 用户端合同审查列表。owner-only（仅返回 event.context.auth?.user 名下的 review，deletedAt=null）。
 *
 * Query：
 *  - skip   int >= 0，默认 0
 *  - take   int >= 1，<= 100，默认 20
 *  - status 可选字符串（精确匹配 contract_reviews.status）
 *  - q      可选字符串（模糊搜原文件名 originalFile.fileName，case-insensitive）
 *  - caseId 可选 int >= 1，按关联案件过滤；未传则返回所有归属状态（独立 + 案件下）
 *
 * 响应：
 *  { items: ReviewListItem[], total, skip, take }
 *
 * 排序：createdAt desc
 *
 * 参见 spec §11 - 合同审查
 *
 * **Feature: contract-review-m6.1a（Task 4）** + **M6.3（caseId 过滤）**
 */
import { z } from 'zod'
import { listUserReviewsDAO } from '~~/server/services/assistant/contract/contractReview.dao'

const QuerySchema = z.object({
    skip: z.coerce.number().int().min(0).default(0),
    take: z.coerce.number().int().min(1).max(100).default(20),
    status: z.string().min(1).max(30).optional(),
    q: z.string().min(1).max(100).optional(),
    caseId: z.coerce.number().int().min(1).optional(),
}).strict()

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const parsed = QuerySchema.safeParse(getQuery(event))
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    const { skip, take, status, q, caseId } = parsed.data

    const { items, total } = await listUserReviewsDAO({
        userId: user.id,
        skip,
        take,
        status,
        q,
        caseId,
    })

    return resSuccess(event, '获取成功', { items, total, skip, take })
})
