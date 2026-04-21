// app/composables/useContractOverview.ts
import type { Ref } from 'vue'
import type { Risk } from '#shared/types/contract'

/**
 * 从 risks 数组派生 counts / score / scoreLabel
 *
 * 不访问 DB / 不请求网络；纯派生，单一来源。
 *
 * 加权公式：score = min(100, round(3 × high + 1.5 × medium + 0.5 × low))
 * 分段：≥70 极高 / ≥50 偏高建议谈判 / ≥30 可控 / <30 低风险
 */
export function useContractOverview(risks: Ref<Risk[] | null>) {
    const counts = computed(() => {
        const list = risks.value ?? []
        return {
            high: list.filter(r => r.level === 'high').length,
            medium: list.filter(r => r.level === 'medium').length,
            low: list.filter(r => r.level === 'low').length,
        }
    })

    const score = computed(() => {
        const c = counts.value
        return Math.min(100, Math.round(3 * c.high + 1.5 * c.medium + 0.5 * c.low))
    })

    const scoreLabel = computed(() => {
        const s = score.value
        if (s >= 70) return '极高风险'
        if (s >= 50) return '风险偏高，建议谈判'
        if (s >= 30) return '风险可控'
        return '低风险'
    })

    return { counts, score, scoreLabel }
}
