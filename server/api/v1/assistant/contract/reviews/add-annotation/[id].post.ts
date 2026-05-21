/**
 * POST /api/v1/assistant/contract/reviews/add-annotation/:id
 *
 * 新增律师批注（针对特定风险的回复）。
 *
 * 请求体：
 * - riskId: number（必填）
 * - content: string（必填，1-2000 字）
 * - parentAnnotationId?: number | null（父批注 ID，用于对话线）
 *
 * 错误码：
 * - 400：参数错误
 * - 401：未登录
 * - 403：审查不属于当前用户
 * - 404：审查/风险不存在
 */

import { z } from 'zod'
import { loadOwnedReview } from '~~/server/services/assistant/contract/reviewGuard'
import { createLawyerAnnotationService } from '~~/server/services/assistant/contract/contractAnnotation.service'
import { resolveContractExportSignatureService } from '~~/server/services/users/contractSignature.service'

const bodySchema = z.object({
    riskId: z.number().int().positive(),
    content: z.string().trim().min(1).max(2000),
    parentAnnotationId: z.number().int().positive().nullish(),
})

export default defineEventHandler(async (event) => {
    const guard = await loadOwnedReview(event, { actionLabel: '新增批注' })
    if (!guard.ok) return resError(event, guard.status, guard.message)

    const { user, review } = guard

    const raw = await readBody(event).catch(() => null)
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')

    // 批注署名与 docx 导出口径统一：优先用户配置的「合同导出署名」，否则用户名，
    // 最终兜底「审查人」——不再用通用的「律师」。
    const signature = await resolveContractExportSignatureService(user.id)
    const result = await createLawyerAnnotationService({
        reviewId: review.id,
        riskId: parsed.data.riskId,
        content: parsed.data.content,
        parentAnnotationId: parsed.data.parentAnnotationId ?? null,
        user: { id: user.id, name: signature },
    })

    if ('error' in result) {
        if (result.error === 'parent_invalid') {
            return resError(event, 400, '父批注不存在或不属于该审查')
        }
        return resError(event, 404, '风险不存在或不属于该审查')
    }

    const { annotation } = result
    return resSuccess(event, '已发送', {
        id: annotation.id,
        riskId: annotation.riskId,
        parentAnnotationId: annotation.parentAnnotationId,
        authorType: annotation.authorType,
        authorName: annotation.authorName,
        authorUserId: annotation.authorUserId,
        content: annotation.content,
        createdAt: annotation.createdAt.toISOString(),
    })
})
