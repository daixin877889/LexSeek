/**
 * 合同审查清单对照派生 composable
 *
 * 输入：playbookSnapshot（冻结在 review 里）+ risks（AI 输出）
 * 输出：命中 / 未命中 / 清单外三态 + enabled / total / hitCount 统计
 *
 * 用于 OverviewPanel"清单对照"板块 + RiskListPanel 风险卡徽章。
 *
 * **Feature: contract-review-playbook (M7)**
 */
import { computed, type ComputedRef, type Ref } from 'vue'
import type { PlaybookSnapshot, PlaybookPointSnapshot, Risk } from '#shared/types/contract'

export interface PlaybookMatchResult {
    enabled: ComputedRef<boolean>
    total: ComputedRef<number>
    hitCount: ComputedRef<number>
    hits: ComputedRef<Array<{ point: PlaybookPointSnapshot; risk: Risk }>>
    misses: ComputedRef<PlaybookPointSnapshot[]>
    extras: ComputedRef<Risk[]>
}

export function useContractPlaybookMatch(
    snapshot: Ref<PlaybookSnapshot | null>,
    risks: Ref<Risk[]>,
): PlaybookMatchResult {
    const enabled = computed(() => snapshot.value !== null && snapshot.value.points.length > 0)

    const validCodes = computed(() => {
        if (!snapshot.value) return new Set<string>()
        return new Set(snapshot.value.points.map(p => p.code))
    })

    const total = computed(() => snapshot.value?.points.length ?? 0)

    // code -> 首个匹配的 risk（按 risks 数组顺序取首个）
    const codeToRisk = computed(() => {
        const m = new Map<string, Risk>()
        for (const r of risks.value) {
            const code = r.matchedPointCode
            if (!code) continue
            if (!validCodes.value.has(code)) continue
            if (!m.has(code)) m.set(code, r)
        }
        return m
    })

    const hitCount = computed(() => codeToRisk.value.size)

    const hits = computed(() => {
        if (!snapshot.value) return []
        return snapshot.value.points
            .filter(p => codeToRisk.value.has(p.code))
            .map(p => ({ point: p, risk: codeToRisk.value.get(p.code)! }))
    })

    const misses = computed(() => {
        if (!snapshot.value) return []
        return snapshot.value.points.filter(p => !codeToRisk.value.has(p.code))
    })

    const extras = computed(() => {
        return risks.value.filter((r) => {
            if (!r.matchedPointCode) return true
            if (!validCodes.value.has(r.matchedPointCode)) return true
            return false
        })
    })

    return { enabled, total, hitCount, hits, misses, extras }
}
