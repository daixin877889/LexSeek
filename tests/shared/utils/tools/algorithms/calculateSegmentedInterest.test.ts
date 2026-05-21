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

    it('跨利率切换 — 通过 rateChangePoints 显式分段', () => {
        const segments = calculateSegmentedInterest({
            principal: 10000,
            startDate: '2024-01-01',
            endDate: '2024-06-30',
            rateLookup: (d) => d < new Date('2024-03-01') ? 4.0 : 3.5,
            rateChangePoints: ['2024-03-01'],
        })
        expect(segments.length).toBeGreaterThan(1)
        expect(segments[0]!.rate).toBe(4.0)
        expect(segments[1]!.rate).toBe(3.5)
        expect(segments[0]!.endDate).toBe('2024-02-29')
        expect(segments[1]!.startDate).toBe('2024-03-01')
    })

    it('rateChangePoints 含范围外日期 — 应被过滤忽略', () => {
        const segments = calculateSegmentedInterest({
            principal: 10000,
            startDate: '2024-01-01',
            endDate: '2024-06-30',
            rateLookup: () => 4.0,
            rateChangePoints: ['2023-06-01', '2025-06-01'],
        })
        expect(segments).toHaveLength(1)
    })

    it('多个无序 rateChangePoints 应被排序后正确分段', () => {
        const segments = calculateSegmentedInterest({
            principal: 10000,
            startDate: '2024-01-01',
            endDate: '2024-12-31',
            rateLookup: (d) => {
                if (d < new Date('2024-04-01')) return 4.0
                if (d < new Date('2024-08-01')) return 3.5
                return 3.0
            },
            // 故意打乱顺序
            rateChangePoints: ['2024-08-01', '2024-04-01'],
        })
        expect(segments).toHaveLength(3)
        expect(segments[0]!.rate).toBe(4.0)
        expect(segments[1]!.rate).toBe(3.5)
        expect(segments[2]!.rate).toBe(3.0)
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
