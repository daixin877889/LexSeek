/**
 * POST /api/v1/assistant/contract/reviews/add-risk/:id
 *
 * 律师在合同预览中针对某段落手动新增一条风险。
 * 请求体：风险内容字段 + clauseText（段落原文）+ clauseParagraphIndex（段落序号）。
 * 前置：审查归属当前用户、status=completed、currentVersionId 非空（已迁移）。
 *
 * 错误码：400 参数 / 401 未登录 / 403 无权 / 404 不存在 / 409 状态不允许
 */
import { z } from 'zod'
import { loadOwnedReview } from '~~/server/services/assistant/contract/reviewGuard'
import { addManualRiskService } from '~~/server/agents/contract/contractRisk.service'
import { REVIEW_EDITABLE_STATUSES } from '#shared/types/contract'
import type { ContractReviewStatus } from '#shared/types/contract'

const bodySchema = z.object({
    clauseText: z.string().trim().min(1).max(10000),
    clauseParagraphIndex: z.number().int().nonnegative(),
    level: z.enum(['high', 'medium', 'low']),
    category: z.string().trim().min(1).max(50),
    problem: z.string().trim().min(1).max(2000),
    legalBasis: z.string().trim().max(2000).nullish(),
    analysis: z.string().trim().max(2000).nullish(),
    suggestion: z.string().trim().max(2000).nullish(),
    suggestedClauseText: z.string().max(10000).nullish(),
}).refine(
    r => r.level === 'low' || !!r.suggestedClauseText,
    { message: 'high/medium 级别必须提供建议改写后的条款', path: ['suggestedClauseText'] },
)

export default defineEventHandler(async (event) => {
    const guard = await loadOwnedReview(event, { actionLabel: '新增风险' })
    if (!guard.ok) return resError(event, guard.status, guard.message)
    const { review } = guard

    if (!REVIEW_EDITABLE_STATUSES.includes(review.status as ContractReviewStatus)) {
        return resError(event, 409, `当前状态不允许新增风险：${review.status}`)
    }
    if (review.currentVersionId == null) {
        return resError(event, 409, '该审查尚未生成版本快照，暂不支持新增风险')
    }

    const raw = await readBody(event).catch(() => null)
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')

    const risk = await addManualRiskService({
        reviewId: review.id,
        clauseText: parsed.data.clauseText,
        clauseParagraphIndex: parsed.data.clauseParagraphIndex,
        level: parsed.data.level,
        category: parsed.data.category,
        problem: parsed.data.problem,
        legalBasis: parsed.data.legalBasis ?? null,
        analysis: parsed.data.analysis ?? null,
        suggestion: parsed.data.suggestion ?? null,
        suggestedClauseText: parsed.data.suggestedClauseText ?? null,
    })

    // 前端不消费返回的风险体（成功后走 versioning.refreshWorkspace 重拉），返回原始行即可
    return resSuccess(event, '新增成功', risk)
})
