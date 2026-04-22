/**
 * DELETE /api/v1/assistant/contract/reviews/:id
 *
 * 用户端软删除合同审查。owner-only（loadOwnedReview 通过后才允许）。
 * 置 deletedAt=now，不级联清理 risks / OSS 文件（便于超管排查）。
 *
 * 错误码：
 * - 400：id 无效
 * - 401：未登录
 * - 403：非本人所有
 * - 404：不存在或已软删
 * - 409：审查尚在 reviewing / pending / awaiting_stance / rebuilding 态，禁止删除
 * - 500：服务端错误
 */
import { loadOwnedReview } from '~~/server/services/assistant/contract/reviewGuard'
import { softDeleteContractReviewDAO } from '~~/server/services/assistant/contract/contractReview.dao'

const BUSY_STATUSES = new Set(['pending', 'reviewing', 'awaiting_stance', 'rebuilding'])

export default defineEventHandler(async (event) => {
    const guard = await loadOwnedReview(event, { actionLabel: '删除合同审查' })
    if (!guard.ok) return resError(event, guard.status, guard.message)

    const { user, review } = guard
    if (BUSY_STATUSES.has(review.status)) {
        return resError(event, 409, `审查当前为"${review.status}"状态，请等待完成后再删除`)
    }

    try {
        await softDeleteContractReviewDAO(review.id)
        return resSuccess(event, '已删除', { id: review.id })
    } catch (err: any) {
        logger.error('[contract] 删除审查失败', { userId: user.id, reviewId: review.id, err: err?.message })
        return resError(event, 500, err?.message || '删除失败')
    }
})
