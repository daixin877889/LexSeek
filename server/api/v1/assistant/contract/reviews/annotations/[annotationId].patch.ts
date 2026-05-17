/**
 * PATCH /api/v1/assistant/contract/reviews/annotations/:annotationId
 *
 * 修改律师批注内容（只能修改自己的 lawyer 批注）。
 *
 * 请求体：
 * - content: string（必填，1-2000 字）
 *
 * 错误码：
 * - 400：参数错误
 * - 401：未登录
 * - 403：无权修改（不是自己的批注或非 lawyer 类型）
 * - 404：批注不存在或已删除
 */

import { z } from 'zod'
import { loadOwnedReviewByAnnotationId } from '~~/server/services/assistant/contract/reviewGuard'
import { updateAnnotationContentService } from '~~/server/services/assistant/contract/contractAnnotation.service'

const bodySchema = z.object({
    content: z.string().trim().min(1).max(2000),
})

export default defineEventHandler(async (event) => {
    const guard = await loadOwnedReviewByAnnotationId(event, { actionLabel: '修改批注' })
    if (!guard.ok) return resError(event, guard.status, guard.message)

    const { user } = guard

    const raw = await readBody(event).catch(() => null)
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')

    const annotationId = guard.subId!
    const result = await updateAnnotationContentService({
        annotationId,
        ownerUserId: user.id,
        content: parsed.data.content,
    })

    if ('error' in result) {
        if (result.error === 'not_own') return resError(event, 403, '只能修改自己的批注')
        return resError(event, 404, '批注不存在')
    }

    return resSuccess(event, '已更新', {
        id: result.annotation.id,
        content: result.annotation.content,
    })
})
