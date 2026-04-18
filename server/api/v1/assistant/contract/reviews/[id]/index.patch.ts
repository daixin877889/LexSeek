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
import {
    getContractReviewDAO,
    patchReviewRisksDAO,
} from '~~/server/services/assistant/contract/contractReview.dao'
import { RISK_SHAPE } from '~~/server/services/assistant/contract/riskSchema.builder'
import { REVIEW_EDITABLE_STATUSES } from '#shared/types/contract'
import type { ContractReviewStatus } from '#shared/types/contract'

const BodySchema = z.object({
    risks: z.array(RISK_SHAPE).max(200),
}).strict()

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const idStr = getRouterParam(event, 'id')
    const id = Number(idStr)
    if (!idStr || !Number.isInteger(id) || id <= 0) {
        return resError(event, 400, 'reviewId 无效')
    }

    const raw = await readBody(event).catch(() => null)
    if (!raw || typeof raw !== 'object') return resError(event, 400, '请求体无效')

    const parsed = BodySchema.safeParse(raw)
    if (!parsed.success) {
        const first = parsed.error.issues[0]
        const path = first?.path.join('.') ?? ''
        return resError(event, 400, `${path || 'body'}: ${first?.message ?? '参数校验失败'}`)
    }

    const review = await getContractReviewDAO(id)
    if (!review) return resError(event, 404, '合同审查不存在')
    if (review.userId !== user.id) return resError(event, 403, '无权编辑该审查')
    if (!REVIEW_EDITABLE_STATUSES.includes(review.status as ContractReviewStatus)) {
        return resError(event, 409, `当前状态不允许编辑：${review.status}`)
    }

    await patchReviewRisksDAO(id, parsed.data.risks)
    return resSuccess(event, '保存成功', { reviewId: id })
})
