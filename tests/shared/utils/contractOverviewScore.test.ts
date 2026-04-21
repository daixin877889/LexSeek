/**
 * contractOverviewScore 纯函数测试
 *
 * **Feature: contract-review-m6.1**
 */
import { describe, it, expect } from 'vitest'
import {
    computeCounts,
    computeScore,
    computeScoreLabel,
} from '#shared/utils/contractOverviewScore'
import type { Risk } from '#shared/types/contract'

function makeRisk(level: Risk['level']): Risk {
    return {
        id: `${level}-id`,
        clauseIndex: 1,
        clauseText: '测试条款',
        level,
        category: '测试',
        problem: '测试问题',
        analysis: '分析',
        risk: '风险',
        suggestion: '建议',
    }
}

describe('computeCounts', () => {
    it('按 level 分组统计', () => {
        const risks: Risk[] = [
            makeRisk('high'), makeRisk('high'), makeRisk('high'),
            makeRisk('medium'), makeRisk('medium'),
            makeRisk('low'),
        ]
        expect(computeCounts(risks)).toEqual({ high: 3, medium: 2, low: 1 })
    })

    it('空数组返回全 0', () => {
        expect(computeCounts([])).toEqual({ high: 0, medium: 0, low: 0 })
    })
})

describe('computeScore', () => {
    it('按 3h + 1.5m + 0.5l 加权公式计算', () => {
        // 3×3 + 1.5×5 + 0.5×2 = 9 + 7.5 + 1 = 17.5 → round → 18
        expect(computeScore({ high: 3, medium: 5, low: 2 })).toBe(18)
    })

    it('score ≥ 100 时封顶为 100', () => {
        expect(computeScore({ high: 50, medium: 0, low: 0 })).toBe(100)
    })
})

describe('computeScoreLabel', () => {
    it('分段标签正确', () => {
        expect(computeScoreLabel(70)).toBe('极高风险')
        expect(computeScoreLabel(100)).toBe('极高风险')
        expect(computeScoreLabel(50)).toBe('风险偏高，建议谈判')
        expect(computeScoreLabel(69)).toBe('风险偏高，建议谈判')
        expect(computeScoreLabel(30)).toBe('风险可控')
        expect(computeScoreLabel(49)).toBe('风险可控')
        expect(computeScoreLabel(29)).toBe('低风险')
        expect(computeScoreLabel(0)).toBe('低风险')
    })
})
