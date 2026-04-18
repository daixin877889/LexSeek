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

import { getContractReviewDAO } from '~~/server/services/assistant/contract/contractReview.dao'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isInteger(id) || id <= 0) return resError(event, 400, 'id 无效')

    const review = await getContractReviewDAO(id)
    if (!review) return resError(event, 404, '审查不存在')
    if (review.userId !== user.id) return resError(event, 403, '无权访问')

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
