/**
 * 迟延履行利息计算服务测试
 *
 * 测试 calculateDelayInterest 函数
 */
import { describe, it, expect, vi } from 'vitest'
import { calculateDelayInterest } from '#shared/utils/tools/delayInterestService'
import { getInterestRates } from '#shared/utils/tools/interestService'

// Mock logger
vi.mock('#shared/utils/logger', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }
}))

// Mock date utility
vi.mock('#shared/utils/tools/utils/date', () => ({
    daysBetween: vi.fn((start: string, end: string) => {
        const startDate = new Date(start)
        const endDate = new Date(end)
        return Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    }),
    formatDate: vi.fn((date: Date) => {
        const y = date.getFullYear()
        const m = String(date.getMonth() + 1).padStart(2, '0')
        const d = String(date.getDate()).padStart(2, '0')
        return `${y}-${m}-${d}`
    })
}))

vi.mock('#shared/utils/tools/interestService', () => ({
    getInterestRates: vi.fn((type: number, period: number) => {
        if (type === 1 && period === 2) {
            return [
                { sTime: '2019-01-01', rate: 4.35, type: 1, period: 2 },
                { sTime: '2019-08-01', rate: 4.30, type: 1, period: 2 }
            ]
        }
        if (type === 2 && period === 1) {
            return [
                { sTime: '2019-08-20', rate: 4.25, type: 2, period: 1 },
                { sTime: '2020-01-01', rate: 4.15, type: 2, period: 1 }
            ]
        }
        return []
    })
}))

describe('calculateDelayInterest', () => {
    it('应正确计算迟延履行利息', () => {
        const result = calculateDelayInterest(10000, '2024-01-01', '2024-12-31')
        expect(result.amount).toBe(10000)
        expect(result.startDate).toBe('2024-01-01')
        expect(result.endDate).toBe('2024-12-31')
        expect(result.days).toBeGreaterThan(0)
        expect(result.totalInterest).toBeGreaterThan(0)
        expect(result.total).toBe(10000 + result.totalInterest)
    })

    it('应接受字符串类型的本金', () => {
        const result = calculateDelayInterest('50000', '2024-01-01', '2024-06-30')
        expect(result.amount).toBe(50000)
    })

    it('完全在2019年8月20日前的期间应使用基准利率1.5倍', () => {
        const result = calculateDelayInterest(10000, '2018-01-01', '2019-01-01')
        expect(result.totalInterest).toBeGreaterThan(0)
        expect(result.details.some(d => d.includes('基准利率'))).toBe(true)
    })

    it('完全在2019年8月20日后的期间应使用LPR的4倍', () => {
        const result = calculateDelayInterest(10000, '2020-01-01', '2021-01-01')
        expect(result.totalInterest).toBeGreaterThan(0)
        expect(result.details.some(d => d.includes('LPR'))).toBe(true)
    })

    it('跨越2019年8月20日的期间应分段计算', () => {
        const result = calculateDelayInterest(10000, '2019-01-01', '2019-12-31')
        expect(result.totalInterest).toBeGreaterThan(0)
        expect(result.details.some(d => d.includes('跨越2019年8月20日'))).toBe(true)
        expect(result.interestDetails.length).toBeGreaterThan(1)
    })

    it('应包含计算明细', () => {
        const result = calculateDelayInterest(10000, '2020-01-01', '2020-06-30')
        expect(result.details.length).toBeGreaterThan(0)
        expect(result.interestDetails.length).toBeGreaterThan(0)
    })

    it('应返回正确的利息明细项', () => {
        const result = calculateDelayInterest(10000, '2020-01-01', '2020-06-30')
        result.interestDetails.forEach(detail => {
            expect(detail.startDate).toBeDefined()
            expect(detail.endDate).toBeDefined()
            expect(detail.days).toBeGreaterThan(0)
            expect(detail.rate).toBeGreaterThan(0)
            expect(detail.adjustedRate).toBeGreaterThan(0)
            expect(detail.interest).toBeGreaterThan(0)
        })
    })

    it('应包含利息明细项的详细描述', () => {
        const result = calculateDelayInterest(10000, '2020-01-01', '2020-06-30')
        expect(result.details.some(d => d.includes('利率'))).toBe(true)
    })

    it('应正确计算总额', () => {
        const result = calculateDelayInterest(10000, '2020-01-01', '2020-06-30')
        expect(result.total).toBeCloseTo(result.amount + result.totalInterest, 2)
    })

    it('零本金应正常处理', () => {
        const result = calculateDelayInterest(0, '2020-01-01', '2020-06-30')
        expect(result.amount).toBe(0)
        expect(result.totalInterest).toBe(0)
    })

    it('LPR数据为空时应使用默认值3.85%', () => {
        vi.mocked(getInterestRates).mockImplementation((type: number, period: number) => {
            if (type === 2 && period === 1) return []
            if (type === 1 && period === 2) return [
                { sTime: '2019-01-01', rate: 4.35, type: 1, period: 2 }
            ]
            return []
        })
        const result = calculateDelayInterest(10000, '2020-01-01', '2020-06-30')
        expect(result.totalInterest).toBeGreaterThan(0)
    })

    it('基准利率数据为空时应使用默认值4.35%', () => {
        vi.mocked(getInterestRates).mockImplementation((type: number, period: number) => {
            if (type === 2 && period === 1) return [
                { sTime: '2019-08-20', rate: 4.25, type: 2, period: 1 }
            ]
            if (type === 1 && period === 2) return []
            return []
        })
        const result = calculateDelayInterest(10000, '2018-01-01', '2019-01-01')
        expect(result.totalInterest).toBeGreaterThan(0)
    })

    it('跨越多段利率变化期间应正确遍历所有利率段（覆盖 lines 178-179）', () => {
        // 覆盖 calculateBeforePolicyPeriods 中 while 循环的 lines 178-179
        // 模拟多个利率变化点，触发 currentRateIndex 递增
        // 注意：代码会对利率按日期升序排序，需要使用晚于部分利率点的开始日期
        vi.mocked(getInterestRates).mockImplementation((type: number, period: number) => {
            if (type === 1 && period === 2) {
                return [
                    { sTime: '2015-10-24', rate: 4.35, type: 1, period: 2 },
                    { sTime: '2015-08-26', rate: 4.60, type: 1, period: 2 },
                    { sTime: '2015-06-28', rate: 4.85, type: 1, period: 2 },
                    { sTime: '2015-05-11', rate: 5.10, type: 1, period: 2 },
                    { sTime: '2015-03-01', rate: 5.35, type: 1, period: 2 }
                ]
            }
            if (type === 2 && period === 1) return []
            return []
        })
        // 使用晚于部分利率点的开始日期（2015-03-01 和 2015-05-11 早于 2015-04-15）
        // 排序后：'2015-03-01', '2015-05-11', '2015-06-28'...
        // 条件：new Date('2015-05-11') <= '2015-04-15' = false，不会进入 if
        // 需要用 2015-06-01 这样晚于前两个利率点的日期
        const result = calculateDelayInterest(10000, '2015-06-01', '2015-12-31')
        expect(result.totalInterest).toBeGreaterThan(0)
        expect(result.interestDetails.length).toBeGreaterThan(1)
    })

    it('跨越多段 LPR 变化期间应正确遍历所有利率段（覆盖 lines 308-311）', () => {
        // 覆盖 calculateAfterPolicyPeriods 中 while 循环的 lines 308-311
        // 模拟多个 LPR 变化点，触发 currentRateIndex 递增
        // 注意：代码会对利率按日期升序排序，需要使用早于所有利率点的开始日期
        vi.mocked(getInterestRates).mockImplementation((type: number, period: number) => {
            if (type === 2 && period === 1) {
                return [
                    { sTime: '2020-01-20', rate: 4.15, type: 2, period: 1 },
                    { sTime: '2020-02-20', rate: 4.05, type: 2, period: 1 },
                    { sTime: '2020-03-20', rate: 4.05, type: 2, period: 1 },
                    { sTime: '2020-04-20', rate: 3.85, type: 2, period: 1 },
                    { sTime: '2020-05-20', rate: 3.85, type: 2, period: 1 }
                ]
            }
            if (type === 1 && period === 2) return []
            return []
        })
        // 使用早于所有利率点的开始日期，确保触发 currentRateIndex++ 分支
        const result = calculateDelayInterest(10000, '2019-09-01', '2020-06-30')
        expect(result.totalInterest).toBeGreaterThan(0)
        expect(result.interestDetails.length).toBeGreaterThan(1)
    })

    it('空利率数组应使用默认值（覆盖 lines 190, 303 的防御性分支）', () => {
        // 覆盖 calculateBeforePolicyPeriods 和 calculateAfterPolicyPeriods 中
        // if (!currentRateData) break 的防御性分支
        vi.mocked(getInterestRates).mockImplementation(() => [])
        // 这种情况下会使用默认利率 4.35%
        const result = calculateDelayInterest(10000, '2018-01-01', '2019-01-01')
        expect(result.totalInterest).toBeGreaterThan(0)
        expect(result.details.some(d => d.includes('基准利率'))).toBe(true)
    })
})
