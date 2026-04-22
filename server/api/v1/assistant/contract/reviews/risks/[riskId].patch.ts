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

const bodySchema = z.object({
    archivedStatus: z.enum(['handled', 'ignored']).nullable(),
})

export default defineEventHandler(async (event) => {
    const guard = await loadOwnedReviewByRiskId(event, { actionLabel: '处置风险' })
    if (!guard.ok) return resError(event, guard.status, guard.message)

    const raw = await readBody(event)
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')

    const riskId = Number(getRouterParam(event, 'riskId'))
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
