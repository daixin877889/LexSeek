/**
 * 日期推算计算服务测试
 *
 * 测试 calculateDateAfterDays, calculateDateAfterMonths, calculateDateAfterYears,
 * calculateWorkingDays, calculateLegalDeadline, calculateLimitationPeriod 函数
 */
import { describe, it, expect } from 'vitest'
import {
    calculateDateAfterDays,
    calculateDateAfterMonths,
    calculateDateAfterYears,
    calculateWorkingDays,
    calculateLegalDeadline,
    calculateLimitationPeriod
} from '#shared/utils/tools/dateCalculatorService'

describe('calculateDateAfterDays', () => {
    it('应正确推算指定天数后的日期', () => {
        const result = calculateDateAfterDays('2025-01-01', 10)
        expect(result.resultDate).toBe('2025-01-11')
    })

    it('应正确处理负天数', () => {
        const result = calculateDateAfterDays('2025-01-15', -5)
        expect(result.resultDate).toBe('2025-01-10')
    })

    it('应包含正确的开始日期', () => {
        const result = calculateDateAfterDays('2025-03-01', 30)
        expect(result.startDate).toBe('2025-03-01')
    })

    it('应包含正确推算的天数', () => {
        const result = calculateDateAfterDays('2025-03-01', 30)
        expect(result.days).toBe(30)
    })

    it('应包含计算明细', () => {
        const result = calculateDateAfterDays('2025-03-01', 30)
        expect(result.details).toContain('向后推算30天')
    })

    it('向前推算的明细应包含向前描述', () => {
        const result = calculateDateAfterDays('2025-03-01', -30)
        expect(result.details).toContain('向前推算30天')
    })
})

describe('calculateDateAfterMonths', () => {
    it('应正确推算指定月数后的日期', () => {
        const result = calculateDateAfterMonths('2025-01-01', 6)
        expect(result.resultDate).toBe('2025-07-01')
    })

    it('应正确处理跨年推算', () => {
        const result = calculateDateAfterMonths('2025-10-01', 5)
        expect(result.resultDate).toBe('2026-03-01')
    })

    it('应正确处理负月数', () => {
        const result = calculateDateAfterMonths('2025-05-01', -3)
        expect(result.resultDate).toBe('2025-02-01')
    })

    it('应包含正确的开始日期', () => {
        const result = calculateDateAfterMonths('2025-01-01', 6)
        expect(result.startDate).toBe('2025-01-01')
    })

    it('应包含正确推算的月数', () => {
        const result = calculateDateAfterMonths('2025-01-01', 6)
        expect(result.months).toBe(6)
    })

    it('应包含计算明细', () => {
        const result = calculateDateAfterMonths('2025-01-01', 6)
        expect(result.details).toContain('向后推算6个月')
    })
})

describe('calculateDateAfterYears', () => {
    it('应正确推算指定年数后的日期', () => {
        const result = calculateDateAfterYears('2025-01-01', 2)
        expect(result.resultDate).toBe('2027-01-01')
    })

    it('应正确处理负年数', () => {
        const result = calculateDateAfterYears('2025-01-01', -1)
        expect(result.resultDate).toBe('2024-01-01')
    })

    it('应包含正确的开始日期', () => {
        const result = calculateDateAfterYears('2025-01-01', 5)
        expect(result.startDate).toBe('2025-01-01')
    })

    it('应包含正确推算的年数', () => {
        const result = calculateDateAfterYears('2025-01-01', 5)
        expect(result.years).toBe(5)
    })

    it('应包含计算明细', () => {
        const result = calculateDateAfterYears('2025-01-01', 5)
        expect(result.details).toContain('向后推算5年')
    })
})

describe('calculateWorkingDays', () => {
    it('应正确计算两个日期之间的工作日天数', () => {
        const result = calculateWorkingDays('2025-01-01', '2025-01-10')
        expect(result.workingDays).toBeGreaterThan(0)
    })

    it('应包含正确的开始日期', () => {
        const result = calculateWorkingDays('2025-01-01', '2025-01-10')
        expect(result.startDate).toBe('2025-01-01')
    })

    it('应包含正确的结束日期', () => {
        const result = calculateWorkingDays('2025-01-01', '2025-01-10')
        expect(result.endDate).toBe('2025-01-10')
    })

    it('应包含计算明细', () => {
        const result = calculateWorkingDays('2025-01-01', '2025-01-10')
        expect(result.details).toContain('工作日天数')
    })

    it('周末应被排除', () => {
        const result = calculateWorkingDays('2025-01-03', '2025-01-05')
        expect(result.workingDays).toBeLessThan(3)
    })
})

describe('calculateLegalDeadline', () => {
    it('应正确计算法定期限', () => {
        const result = calculateLegalDeadline('2025-01-01', 15, false)
        expect(result.resultDate).toBe('2025-01-16')
    })

    it('排除节假日时应计算更多自然日', () => {
        const resultWithHolidays = calculateLegalDeadline('2025-01-01', 15, true)
        const resultWithoutHolidays = calculateLegalDeadline('2025-01-01', 15, false)
        expect(resultWithHolidays.resultDate >= resultWithoutHolidays.resultDate).toBe(true)
    })

    it('应包含正确的开始日期', () => {
        const result = calculateLegalDeadline('2025-01-01', 30)
        expect(result.startDate).toBe('2025-01-01')
    })

    it('应包含正确的期限天数', () => {
        const result = calculateLegalDeadline('2025-01-01', 30)
        expect(result.days).toBe(30)
    })

    it('应包含是否排除节假日标记', () => {
        const resultExclude = calculateLegalDeadline('2025-01-01', 30, true)
        const resultInclude = calculateLegalDeadline('2025-01-01', 30, false)
        expect(resultExclude.excludeHolidays).toBe(true)
        expect(resultInclude.excludeHolidays).toBe(false)
    })

    it('应包含计算明细', () => {
        const result = calculateLegalDeadline('2025-01-01', 30)
        expect(result.details).toContain('法定期限')
    })
})

describe('calculateLimitationPeriod', () => {
    it('一般民事诉讼时效应为3年', () => {
        const result = calculateLimitationPeriod('2025-01-01', 'general')
        expect(result.years).toBe(3)
        expect(result.resultDate).toBe('2028-01-01')
    })

    it('合同纠纷诉讼时效应为3年', () => {
        const result = calculateLimitationPeriod('2025-01-01', 'contract')
        expect(result.years).toBe(3)
    })

    it('人身伤害诉讼时效应为1年', () => {
        const result = calculateLimitationPeriod('2025-01-01', 'personal')
        expect(result.years).toBe(1)
        expect(result.resultDate).toBe('2026-01-01')
    })

    it('默认类型应为一般民事', () => {
        const result = calculateLimitationPeriod('2025-01-01')
        expect(result.years).toBe(3)
        expect(result.type).toBe('general')
    })

    it('应包含正确的开始日期', () => {
        const result = calculateLimitationPeriod('2025-01-01')
        expect(result.startDate).toBe('2025-01-01')
    })

    it('应包含正确的时效类型', () => {
        const result = calculateLimitationPeriod('2025-01-01', 'contract')
        expect(result.type).toBe('contract')
    })

    it('应包含计算明细', () => {
        const result = calculateLimitationPeriod('2025-01-01')
        expect(result.details).toContain('诉讼时效')
    })
})
