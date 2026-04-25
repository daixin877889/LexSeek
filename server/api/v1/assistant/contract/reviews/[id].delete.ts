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
        // CORE-H5：级联取消 sessionId 关联的活跃 agentRuns（pending/running/interrupted），
        // 否则被软删的 review 还会在 partial unique index (sessionId, status) 里占位，
        // 后续重新创建同 sessionId（罕见但 admin 排错 / 测试场景会撞）会撞 P2002。
        // 不删 agentRuns 行（保留审计），仅把状态切到 cancelled 释放 unique 占位。
        await prisma.agentRuns.updateMany({
            where: {
                sessionId: review.sessionId,
                status: { in: ['pending', 'running', 'interrupted'] },
            },
            data: { status: 'cancelled' },
        })
        return resSuccess(event, '已删除', { id: review.id })
    } catch (err: any) {
        logger.error('[contract] 删除审查失败', { userId: user.id, reviewId: review.id, err: err?.message })
        return resError(event, 500, err?.message || '删除失败')
    }
})
