/**
 * PATCH /api/v1/assistant/contract/reviews/risks/:riskId
 *
 * 处置风险（标记为已处理/已忽略，或取消处置）。
 *
 * 请求体：
 * - archivedStatus: 'handled' | 'ignored' | null
 *
 * 错误码：
 * - 400：参数错误
 * - 401：未登录
 * - 403：审查不属于当前用户
 * - 404：风险不存在
 */

import { z } from 'zod'
import { loadOwnedReviewByRiskId } from '~~/server/services/assistant/contract/reviewGuard'
import { archiveContractRiskService } from '~~/server/services/assistant/contract/contractRisk.service'

/**
 * 律师 PATCH risk 仅允许处置状态字段。锚点字段（clause/quote 系列）一律视为只读——
 * 律师改业务文字不应破坏与原文的锚定；重定位锚点是 v2 功能，本 PR 不实现。
 * `.strict()` 让传入未知字段直接 400 拒绝（spec §5.0）。
 */
const bodySchema = z.object({
    archivedStatus: z.enum(['handled', 'ignored']).nullable(),
}).strict()

export default defineEventHandler(async (event) => {
    const guard = await loadOwnedReviewByRiskId(event, { actionLabel: '处置风险' })
    if (!guard.ok) return resError(event, guard.status, guard.message)

    const raw = await readBody(event)
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')

    const riskId = guard.subId!
    const updated = await archiveContractRiskService({
        riskId,
        archivedStatus: parsed.data.archivedStatus,
    })

    return resSuccess(event, '已更新', {
        id: updated.id,
        archivedStatus: updated.archivedStatus,
        archivedAt: updated.archivedAt?.toISOString() ?? null,
    })
})
