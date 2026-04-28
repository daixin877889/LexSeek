/**
 * 合同审查生命周期 - 子 composable（阶段 7 拆分自 useContractReview）
 *
 * 范围（业务动作 + 业务事件，**不管 stream**）：
 * - startReview：POST 创建 review，返回 reviewId + sessionId（供薄包装挂工厂）
 * - loadReview：GET 已有 review，回填 stages / risks 快照
 * - refreshReview：流末回拉，由工厂 onStreamSettled 钩子驱动
 * - submitStance：POST stance 端点（不走 LangGraph command.resume）
 * - cancelReview：清空 review / reviewId / 业务状态
 * - applyCustomEvent：处理 stage/progress/risk/overview 4 类业务事件（dispatch 给 stages 或写 review）
 *
 * stream 管理交由 useDomainAgentSession 工厂；本 composable 只暴露业务动作。
 */

import { toast } from 'vue-sonner'
import type { Ref } from 'vue'
import type {
    CreateReviewRequest,
    CreateReviewResponse,
    StanceRequest,
    ReviewWithParsedRisks,
    ContractReviewEvent,
} from '#shared/types/contract'
import { useApiFetch } from '~/composables/useApiFetch'
import type { useContractReviewStages } from './useContractReviewStages'
import type { useContractReviewRisksEditing } from './useContractReviewRisksEditing'

export interface UseContractReviewLifecycleDeps {
    reviewId: Ref<number | null>
    review: Ref<ReviewWithParsedRisks | null>
    hasUnsavedDocxChanges: Ref<boolean>
    stages: ReturnType<typeof useContractReviewStages>
    risksEditing: ReturnType<typeof useContractReviewRisksEditing>
}

/** 类型守卫：判断 useStreamChat 透传过来的 unknown 是否为合同审查域的 custom event */
function isContractReviewCustomEvent(data: unknown): data is { name: 'contract_review'; data: unknown } {
    if (!data || typeof data !== 'object') return false
    const ev = data as { name?: unknown; data?: unknown }
    return ev.name === 'contract_review' && ev.data != null
}

export function useContractReviewLifecycle(deps: UseContractReviewLifecycleDeps) {
    /** 重置所有业务状态（onStart / mountReview / cancelReview 入口） */
    function resetAll() {
        deps.review.value = null
        deps.reviewId.value = null
        deps.hasUnsavedDocxChanges.value = false
        deps.stages.reset()
        deps.risksEditing.resetSnapshot()
    }

    /**
     * POST 创建 review。返回 { reviewId, sessionId } 供薄包装挂工厂；失败返回 null。
     */
    async function startReview(payload: CreateReviewRequest): Promise<{ reviewId: number; sessionId: string } | null> {
        resetAll()
        const resp = await useApiFetch<CreateReviewResponse>(
            '/api/v1/assistant/contract/reviews',
            { method: 'POST', body: payload },
        )
        if (!resp) return null
        deps.reviewId.value = resp.reviewId
        return { reviewId: resp.reviewId, sessionId: resp.sessionId }
    }

    /**
     * GET 已有 review + 回填 stages / risks 快照
     * 返回 { reviewId, sessionId } 供薄包装挂工厂；review 不存在返回 null。
     */
    async function loadReview(id: number): Promise<{ reviewId: number; sessionId: string } | null> {
        resetAll()
        const resp = await useApiFetch<{ review: ReviewWithParsedRisks }>(
            `/api/v1/assistant/contract/reviews/${id}`,
            { showError: false },
        )
        if (!resp?.review) return null
        const r = resp.review
        deps.review.value = r
        deps.reviewId.value = r.id
        deps.risksEditing.syncFromServer(r.risks ?? [], r.hasUnsavedDocxChanges)
        deps.stages.fillFromStatus(r.status, Array.isArray(r.risks) ? r.risks.length : undefined)
        if (typeof r.hasUnsavedDocxChanges === 'boolean') {
            deps.hasUnsavedDocxChanges.value = r.hasUnsavedDocxChanges
        }
        return { reviewId: r.id, sessionId: r.sessionId }
    }

    /**
     * 流末回拉钩子（由工厂 onStreamSettled 调用）
     * 静默拉取最新 review 写回 risks / summary / status
     */
    async function refreshReview(): Promise<boolean> {
        if (!deps.reviewId.value) return false
        const latest = await useApiFetch<{ review: ReviewWithParsedRisks }>(
            `/api/v1/assistant/contract/reviews/${deps.reviewId.value}`,
            { showError: false },
        )
        if (!latest?.review) {
            toast.error('刷新审查数据失败，请检查网络')
            return false
        }
        deps.review.value = latest.review
        deps.risksEditing.syncFromServer(latest.review.risks ?? [], latest.review.hasUnsavedDocxChanges)
        return true
    }

    /**
     * 立场选择提交（M3：/stance 端点已在服务端处理 INTERRUPTED → COMPLETED + enqueue 新 run，
     * 前端只需 reset stream 后 submit(undefined) 重订阅 SSE）。
     * stream 重订阅由薄包装层调用工厂的 reset() / sendMessage(undefined)。
     */
    async function submitStance(payload: StanceRequest): Promise<boolean> {
        if (!deps.reviewId.value) return false
        const result = await useApiFetch<{ reviewId: number; runId: number }>(
            `/api/v1/assistant/contract/reviews/stance/${deps.reviewId.value}`,
            { method: 'POST', body: payload },
        )
        return !!result
    }

    /** 取消当前审查（薄包装应另行 stop stream） */
    function cancelReview() {
        resetAll()
    }

    /** 工厂 onCustomEvent 钩子的实现：分发到 stages / 写 review */
    function applyCustomEvent(data: unknown) {
        if (!isContractReviewCustomEvent(data)) return
        const event = data.data as ContractReviewEvent
        switch (event.type) {
            case 'stage':
                deps.stages.handleStageEvent(event)
                break
            case 'progress':
                deps.stages.handleProgressEvent(event)
                break
            case 'risk':
                if (deps.review.value) {
                    const existing = deps.review.value.risks ?? []
                    deps.review.value = { ...deps.review.value, risks: [...existing, event.risk] }
                }
                break
            case 'overview':
                if (deps.review.value) {
                    deps.review.value = { ...deps.review.value, summary: event.overview }
                }
                break
        }
    }

    return {
        startReview,
        loadReview,
        refreshReview,
        submitStance,
        cancelReview,
        applyCustomEvent,
    }
}
