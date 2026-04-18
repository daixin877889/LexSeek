/**
 * POST /api/v1/assistant/contract/reviews/:id/stance
 *
 * 合同审查"立场确认"回调端点。当 workflow 在解析阶段 interrupt 并将 review.status
 * 置为 `awaiting_stance` 后，前端收集用户选择的立场（甲方/乙方/中立），通过本端点
 * 将立场作为 command 下发，触发 agent run 从 interrupt 点 resume 继续审查。
 *
 * 路径严格对齐 `server/api/v1/assistant/document/chat.post.ts:59-64` 的 INTERRUPTED
 * → COMPLETED 释放范式：resume 前先把旧 run 置为 completed，释放
 * `(sessionId, status IN pending/running/interrupted)` 的 partial unique index，
 * 否则 enqueueRunService 会因索引冲突失败。
 *
 * **Feature: contract-review-m3**
 */
import { z } from 'zod'
import { getContractReviewDAO } from '~~/server/services/assistant/contract/contractReview.dao'
import { enqueueRunService } from '~~/server/services/agent/agentRun.service'
import {
    findActiveRunBySessionIdDAO,
    updateRunStatusDAO,
} from '~~/server/services/agent/agentRun.dao'
import { AGENT_RUN_STATUS } from '#shared/types/agentRun'

const BodySchema = z.object({
    stance: z.enum(['partyA', 'partyB', 'neutral']),
    partyA: z.string().optional(),
    partyB: z.string().optional(),
})

export default defineEventHandler(async (event) => {
    // 1. 鉴权
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 2. 校验 reviewId
    const reviewId = Number(getRouterParam(event, 'id'))
    if (!Number.isInteger(reviewId) || reviewId <= 0) {
        return resError(event, 400, 'id 无效')
    }

    // 3. 校验 body
    const parsed = BodySchema.safeParse(await readBody(event))
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    // 4. 查 review + 归属校验
    const review = await getContractReviewDAO(reviewId)
    if (!review) {
        return resError(event, 404, '审查不存在')
    }
    if (review.userId !== user.id) {
        return resError(event, 403, '无权操作')
    }

    // 5. 非 awaiting_stance → 幂等返回（不调入队，避免重复触发）
    if (review.status !== 'awaiting_stance') {
        return resSuccess(event, `立场已提交（状态：${review.status}）`, { reviewId })
    }

    // 6. resume 前释放 INTERRUPTED 旧 run，对齐 document/chat.post.ts:59-64
    const activeRun = await findActiveRunBySessionIdDAO(review.sessionId)
    if (activeRun && activeRun.status === AGENT_RUN_STATUS.INTERRUPTED) {
        await updateRunStatusDAO(activeRun.id, AGENT_RUN_STATUS.COMPLETED, {
            completedAt: new Date(),
        })
    }

    // 7. 入队 resume run（携带 command={stance, partyA?, partyB?}）
    const result = await enqueueRunService({
        sessionId: review.sessionId,
        threadId: review.sessionId,
        userId: user.id,
        caseId: null,
        input: {
            message: undefined,
            command: { ...parsed.data },
        },
    })
    if ('error' in result) {
        return resError(event, 429, result.error)
    }

    return resSuccess(event, '立场已提交，审查继续', {
        reviewId,
        runId: result.runId,
    })
})
