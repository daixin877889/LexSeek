/**
 * 合同审查阶段进度 - 子 composable（阶段 7 拆分自 useContractReview）
 *
 * 范围：5 段阶段进度（detect/stance/segment/analyze/summarize）+ totalClauses + analyzingClauseIndex + analyzeWarnings
 * 仅消费 stage / progress 两类 SSE custom event；risk / overview 由 useContractReviewLifecycle 处理
 */

import { ref } from 'vue'
import { toast } from 'vue-sonner'
import type { ContractReviewEvent } from '#shared/types/contract'

export type StageStepStatus = 'wait' | 'running' | 'done'

export interface StageStatus {
    detect: StageStepStatus
    stance: StageStepStatus
    segment: StageStepStatus
    analyze: StageStepStatus
    summarize: StageStepStatus
}

const INITIAL_STAGE_STATUS: StageStatus = {
    detect: 'wait', stance: 'wait', segment: 'wait', analyze: 'wait', summarize: 'wait',
}

export function useContractReviewStages() {
    const stageStatus = ref<StageStatus>({ ...INITIAL_STAGE_STATUS })
    const totalClauses = ref<number | null>(null)
    const analyzingClauseIndex = ref<number | null>(null)
    const analyzeWarnings = ref<string[]>([])

    function reset() {
        stageStatus.value = { ...INITIAL_STAGE_STATUS }
        totalClauses.value = null
        analyzingClauseIndex.value = null
        analyzeWarnings.value = []
    }

    /** 处理 stage 事件：5 段进度切换 */
    function handleStageEvent(event: Extract<ContractReviewEvent, { type: 'stage' }>) {
        stageStatus.value = {
            ...stageStatus.value,
            [event.stage]: event.status,
        }
        if (event.stage === 'segment' && event.status === 'done') {
            totalClauses.value = event.totalClauses ?? null
        }
        if (event.stage === 'analyze' && event.status === 'done' && event.warnings?.length) {
            analyzeWarnings.value = event.warnings
            toast.warning(`${event.warnings.length} 条条款分析失败，已跳过`)
        }
    }

    /** 处理 progress 事件：分析中的条款下标 */
    function handleProgressEvent(event: Extract<ContractReviewEvent, { type: 'progress' }>) {
        analyzingClauseIndex.value = event.current
        if (event.error) {
            toast.warning(`第 ${event.current} 条分析失败，已跳过：${event.error}`)
        }
    }

    /**
     * 根据 review.status 回填 stageStatus（mountReview 时使用）
     * 进入已存在的 review 时，从持久化状态推断已完成阶段
     */
    function fillFromStatus(status: string | null | undefined, riskCount?: number) {
        if (status === 'completed' || status === 'rebuilding' || status === 'failed') {
            stageStatus.value = {
                detect: 'done', stance: 'done', segment: 'done', analyze: 'done', summarize: 'done',
            }
            totalClauses.value = riskCount ?? null
        } else if (status === 'reviewing') {
            stageStatus.value = {
                detect: 'done', stance: 'done', segment: 'done', analyze: 'running', summarize: 'wait',
            }
        } else if (status === 'awaiting_stance') {
            stageStatus.value = {
                detect: 'done', stance: 'running', segment: 'wait', analyze: 'wait', summarize: 'wait',
            }
        }
    }

    return {
        stageStatus,
        totalClauses,
        analyzingClauseIndex,
        analyzeWarnings,
        reset,
        handleStageEvent,
        handleProgressEvent,
        fillFromStatus,
    }
}
