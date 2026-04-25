/**
 * DELETE /api/v1/assistant/contract/reviews/annotations/:annotationId
 *
 * 软删律师批注（只能删自己的 lawyer 批注，AI 批注不可删）。
 * 决策 11 铁律：批注永不物理删除，只设 deletedAt。
 *
 * 错误码：
 * - 401：未登录
 * - 403：无权删除（不是自己的批注或非 lawyer 类型）
 * - 404：批注不存在或已删除
 */

import { loadOwnedReviewByAnnotationId } from '~~/server/services/assistant/contract/reviewGuard'
import { softDeleteAnnotationService } from '~~/server/services/assistant/contract/contractAnnotation.service'

export default defineEventHandler(async (event) => {
    const guard = await loadOwnedReviewByAnnotationId(event, { actionLabel: '删除批注' })
    if (!guard.ok) return resError(event, guard.status, guard.message)

    const { user } = guard

    const annotationId = guard.subId!
    const result = await softDeleteAnnotationService({
        annotationId,
        ownerUserId: user.id,
    })

    if ('error' in result) {
        if (result.error === 'not_own') return resError(event, 403, '只能删除自己的批注')
        return resError(event, 404, '批注不存在')
    }

    return resSuccess(event, '已删除', { deleted: true })
})
