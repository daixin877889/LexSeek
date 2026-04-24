/**
 * PATCH /api/v1/assistant/contract/reviews/annotations/:annotationId/restore
 *
 * 恢复推送（spec §12.6）：律师手动覆盖客户在 Word 中对某条批注的删除意图。
 * 将 suppressInExport 置为 false；removedByClient=true 保留作为历史证据，下次导出
 * docx 时该批注会被重新写入。
 *
 * 错误码：
 * - 401：未登录
 * - 400：annotationId 无效
 * - 403：无权恢复（批注所在 review 属于他人）
 * - 404：批注不存在或已软删
 * - 409：批注并非客户移除状态（无可恢复目标）
 */

import { loadOwnedReviewByAnnotationId } from '~~/server/services/assistant/contract/reviewGuard'
import { restoreAnnotationPushService } from '~~/server/services/assistant/contract/contractAnnotation.service'

export default defineEventHandler(async (event) => {
    const guard = await loadOwnedReviewByAnnotationId(event, { actionLabel: '恢复推送' })
    if (!guard.ok) return resError(event, guard.status, guard.message)

    const annotationId = Number(getRouterParam(event, 'annotationId'))
    const result = await restoreAnnotationPushService({ annotationId })

    if ('error' in result) {
        if (result.error === 'not_removed') {
            return resError(event, 409, '该批注并非客户移除状态，无需恢复')
        }
        return resError(event, 404, '批注不存在')
    }

    return resSuccess(event, '已恢复推送', { suppressInExport: result.suppressInExport })
})
