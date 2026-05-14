import { describe, it, expect } from 'vitest'
import { calculateSegmentedInterest } from '#shared/utils/tools/algorithms/calculateSegmentedInterest'

describe('calculateSegmentedInterest', () => {
    it('单一利率全段', () => {
        const segments = calculateSegmentedInterest({
            principal: 10000,
            startDate: '2024-01-01',
            endDate: '2024-12-31',
            rateLookup: () => 4.0,
        })
        expect(segments).toHaveLength(1)
        expect(segments[0]!.interest).toBeCloseTo(10000 * 0.04 / 365 * 365, 2)
    })

    it('跨利率切换 — 利率在中间日期变化', () => {
        const segments = calculateSegmentedInterest({
            principal: 10000,
            startDate: '2024-01-01',
            endDate: '2024-06-30',
            rateLookup: (d) => d < new Date('2024-03-01') ? 4.0 : 3.5,
        })
        expect(segments.length).toBeGreaterThan(1)
    })

    it('startDate > endDate 返回空数组', () => {
        const segments = calculateSegmentedInterest({
            principal: 10000,
            startDate: '2024-12-31',
            endDate: '2024-01-01',
            rateLookup: () => 4.0,
        })
        expect(segments).toEqual([])
    })
})
