/**
 * GET /api/v1/assistant/contract/reviews/version-list/:id
 *
 * 获取合同审查的版本列表（不含 snapshotData，只有元信息）。
 *
 * 错误码：
 * - 401：未登录
 * - 403：审查不属于当前用户
 * - 404：审查不存在
 */

import { loadOwnedReview } from '~~/server/services/assistant/contract/reviewGuard'
import { listContractReviewVersionsDAO } from '~~/server/services/assistant/contract/contractReviewVersion.dao'

export default defineEventHandler(async (event) => {
    const guard = await loadOwnedReview(event, { actionLabel: '查看版本列表' })
    if (!guard.ok) return resError(event, guard.status, guard.message)

    const { review } = guard
    const versions = await listContractReviewVersionsDAO(review.id)

    return resSuccess(event, '获取成功', {
        versions: versions.map(v => ({
            id: v.id,
            reviewId: v.reviewId,
            versionNumber: v.versionNumber,
            systemLabel: v.systemLabel,
            lawyerNote: v.lawyerNote,
            createdById: v.createdById,
            createdByName: v.createdBy?.name ?? '',
            createdAt: v.createdAt.toISOString(),
        })),
        currentVersionId: review.currentVersionId,
        maxVersionNo: review.maxVersionNo,
    })
})
