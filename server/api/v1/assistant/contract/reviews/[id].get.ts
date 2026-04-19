/**
 * GET /api/v1/assistant/contract/reviews/:id
 *
 * 获取合同审查详情。
 *
 * 返回字段白名单（不含 userId / deletedAt）：
 * - id, sessionId, status, contractType, partyA, partyB, stance
 * - risks, summary, originalFileId, reviewedFileId, createdAt, updatedAt
 *
 * 其中 sessionId 供前端订阅 SSE 消息使用。
 *
 * 错误码：
 * - 400：id 无效（非整数或 ≤ 0）
 * - 401：未登录
 * - 403：审查不属于当前用户
 * - 404：审查不存在或已软删
 *
 * 参见 spec §11 - 合同审查
 */

import { loadOwnedReview } from '~~/server/services/assistant/contract/reviewGuard'

export default defineEventHandler(async (event) => {
    const guard = await loadOwnedReview(event)
    if (!guard.ok) return resError(event, guard.status, guard.message)
    const { review } = guard

    return resSuccess(event, '获取成功', {
        review: {
            id: review.id,
            sessionId: review.sessionId,
            status: review.status,
            contractType: review.contractType,
            partyA: review.partyA,
            partyB: review.partyB,
            stance: review.stance,
            risks: review.risks,
            summary: review.summary,
            originalFileId: review.originalFileId,
            reviewedFileId: review.reviewedFileId,
            createdAt: review.createdAt,
            updatedAt: review.updatedAt,
        },
    })
})
