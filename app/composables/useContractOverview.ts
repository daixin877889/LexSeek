// app/composables/useContractOverview.ts
import type { Ref } from 'vue'
import type { Risk } from '#shared/types/contract'
import { computeCounts, computeScore, computeScoreLabel } from '#shared/utils/contractOverviewScore'

/**
 * 从 risks 数组派生 counts / score / scoreLabel
 *
 * 不访问 DB / 不请求网络；纯派生，单一来源。
 * 计算公式由 shared/utils/contractOverviewScore.ts 统一管理（前后端共用）。
 */
export function useContractOverview(risks: Ref<Risk[] | null>) {
    const counts = computed(() => computeCounts(risks.value ?? []))
    const score = computed(() => computeScore(counts.value))
    const scoreLabel = computed(() => computeScoreLabel(score.value))

    return { counts, score, scoreLabel }
}
