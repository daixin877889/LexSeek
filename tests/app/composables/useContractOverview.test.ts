import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useContractOverview } from '~/composables/useContractOverview'
import type { Risk } from '#shared/types/contract'

describe('useContractOverview', () => {
    it('counts 按 level 分组统计', () => {
        const risks = ref<Risk[]>([
            { level: 'high' } as Risk, { level: 'high' } as Risk, { level: 'high' } as Risk,
            { level: 'medium' } as Risk, { level: 'medium' } as Risk,
            { level: 'low' } as Risk,
        ])
        const { counts } = useContractOverview(risks)
        expect(counts.value).toEqual({ high: 3, medium: 2, low: 1 })
    })

    it('score 按 3h + 1.5m + 0.5l 公式加权且上限 100', () => {
        const risks = ref<Risk[]>([
            ...Array(3).fill({ level: 'high' } as Risk),   // 9
            ...Array(5).fill({ level: 'medium' } as Risk), // 7.5
            ...Array(2).fill({ level: 'low' } as Risk),    // 1
        ])
        const { score } = useContractOverview(risks)
        expect(score.value).toBe(18)  // round(9+7.5+1) = 18
    })

    it('score ≥ 100 封顶', () => {
        const risks = ref<Risk[]>(Array(50).fill({ level: 'high' } as Risk))
        const { score } = useContractOverview(risks)
        expect(score.value).toBe(100)
    })

    it('scoreLabel 按分段派生', () => {
        expect(useContractOverview(ref(Array(25).fill({ level: 'high' } as Risk))).scoreLabel.value).toBe('极高风险')
        expect(useContractOverview(ref(Array(17).fill({ level: 'high' } as Risk))).scoreLabel.value).toBe('风险偏高，建议谈判')
        expect(useContractOverview(ref(Array(10).fill({ level: 'high' } as Risk))).scoreLabel.value).toBe('风险可控')
        expect(useContractOverview(ref([{ level: 'low' } as Risk])).scoreLabel.value).toBe('低风险')
    })
})
