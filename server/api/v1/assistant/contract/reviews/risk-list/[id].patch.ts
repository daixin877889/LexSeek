/**
 * PATCH /api/v1/assistant/contract/reviews/risk-list/:id
 *
 * 用户对某条审查的风险清单做整体替换（全量替换）。`:id` 是 review id。
 *
 * 历史背景：本文件原位于 `reviews/[id]/index.patch.ts`，与同目录的 `reviews/[id].patch.ts`
 * （关联/解绑案件）撞同一个 URL，导致 Nuxt 路由解析不确定，两个功能至少有一个常年不生效。
 * 现在挪到独立路径 `reviews/risk-list/:id`，避免与已存在的 `reviews/risks/:riskId`
 * （单条风险更新）路由再次冲突。
 *
 * 约束（对齐 spec §8.3）：
 *   - 仅 REVIEW_EDITABLE_STATUSES 可编辑，其它状态 409
 *   - body 只接受 risks；.strict() 拒绝 summary 等额外字段（YAGNI，UI 无 summary 编辑入口）
 *   - risks 经 z.array(RISK_SHAPE).max(200) 校验（RISK_SHAPE refine 含 high/medium 必填 suggestedClauseText）
 *   - 不触发批注重生（需用户显式调 /rebuild-docx）
 *
 * 错误分支（7 条）+ 成功分支（1 条）：
 *   401 / 400(id) / 400(body) / 400(Zod) / 404 / 403 / 409 / 200
 */
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import {
    patchReviewRisksDAO,
    PatchReviewRisksUnknownIdsError,
} from '~~/server/services/assistant/contract/contractReview.dao'
import { RISK_SHAPE } from '~~/server/services/assistant/contract/riskSchema.builder'
import { loadOwnedReview } from '~~/server/services/assistant/contract/reviewGuard'
import { REVIEW_EDITABLE_STATUSES } from '#shared/types/contract'
import type { ContractReviewStatus, Risk } from '#shared/types/contract'

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
        // patchReviewRisksDAO 在单语句 UPDATE 内同时置 hasUnsavedDocxChanges=true，
        // 并对已迁移 review 做 keep/new/removed 三向 diff（CORE-H1）
        // RISK_SHAPE.id 为 optional（兼容 AI 路径），PATCH 路径补 UUID 让 Risk.id 必填
        const risksWithId: Risk[] = parsed.data.risks.map(r => ({ ...r, id: r.id ?? randomUUID() }))
        await patchReviewRisksDAO(review.id, risksWithId)
        return resSuccess(event, '保存成功', { reviewId: review.id })
    } catch (err) {
        if (err instanceof PatchReviewRisksUnknownIdsError) {
            return resError(
                event,
                400,
                `存在未知风险 id：${err.unknownIds.slice(0, 5).join(', ')}。新增请用 POST /reviews/:id/annotations 等子接口；不要在 PATCH 整数组里混入新 id。`,
            )
        }
        logger.error('patch review risks 失败', {
            reviewId: review.id,
            err: err instanceof Error ? err.message : String(err),
        })
        return resError(event, 500, '保存风险清单失败，请稍后重试')
    }
})
