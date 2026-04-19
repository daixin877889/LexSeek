/**
 * PATCH /api/v1/assistant/contract/reviews/:id
 *
 * 用户编辑风险清单（全量替换）。
 *
 * 约束（对齐 spec §8.3）：
 *   - 仅 status='completed' 可编辑（REVIEW_EDITABLE_STATUSES），其它状态 409
 *   - body 只接受 risks；.strict() 拒绝 summary 等额外字段（YAGNI，UI 无 summary 编辑入口）
 *   - risks 经 z.array(RISK_SHAPE).max(200) 校验（RISK_SHAPE refine 含 high/medium 必填 suggestedClauseText）
 *   - 不触发批注重生（需用户显式调 /rebuild-docx）
 *
 * 错误分支（7 条）+ 成功分支（1 条）：
 *   401 / 400(id) / 400(body) / 400(Zod) / 404 / 403 / 409 / 200
 */
import { z } from 'zod'
import { patchReviewRisksDAO } from '~~/server/services/assistant/contract/contractReview.dao'
import { RISK_SHAPE } from '~~/server/services/assistant/contract/riskSchema.builder'
import { loadOwnedReview } from '~~/server/services/assistant/contract/reviewGuard'
import { REVIEW_EDITABLE_STATUSES } from '#shared/types/contract'
import type { ContractReviewStatus } from '#shared/types/contract'

const BodySchema = z.object({
    risks: z.array(RISK_SHAPE).max(200),
}).strict()

export default defineEventHandler(async (event) => {
    // body 校验先于 guard：保持 fail-fast 语义，避免无效 body 也产生 review DB 查询
    const raw = await readBody(event).catch(() => null)
    if (!raw || typeof raw !== 'object') return resError(event, 400, '请求体无效')

    const parsed = BodySchema.safeParse(raw)
    if (!parsed.success) {
        const first = parsed.error.issues[0]
        const path = first?.path.join('.') ?? ''
        return resError(event, 400, `${path || 'body'}: ${first?.message ?? '参数校验失败'}`)
    }

    const guard = await loadOwnedReview(event, { actionLabel: '编辑该审查' })
    if (!guard.ok) return resError(event, guard.status, guard.message)
    const { review } = guard

    if (!REVIEW_EDITABLE_STATUSES.includes(review.status as ContractReviewStatus)) {
        return resError(event, 409, `当前状态不允许编辑：${review.status}`)
    }

    try {
        // patchReviewRisksDAO 在单语句 UPDATE 内同时置 hasUnsavedDocxChanges=true
        await patchReviewRisksDAO(review.id, parsed.data.risks)
        return resSuccess(event, '保存成功', { reviewId: review.id })
    } catch (err) {
        logger.error('patch review risks 失败', {
            reviewId: review.id,
            err: err instanceof Error ? err.message : String(err),
        })
        return resError(event, 500, '保存风险清单失败，请稍后重试')
    }
})
