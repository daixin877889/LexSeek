/**
 * 银行利率查询服务测试
 *
 * 测试 queryLPRRate, queryDepositRate, queryLoanRate,
 * getLPRHistory, getDepositRateHistory, getLoanRateHistory,
 * calculateAverageLPR, getLatestLPR, getLatestDepositRate, getLatestLoanRate 函数
 */
import { describe, it, expect } from 'vitest'
import {
    queryLPRRate,
    queryDepositRate,
    queryLoanRate,
    getLPRHistory,
    getDepositRateHistory,
    getLoanRateHistory,
    calculateAverageLPR,
    getLatestLPR,
    getLatestDepositRate,
    getLatestLoanRate
} from '#shared/utils/tools/bankRateService'

describe('queryLPRRate', () => {
    it('无参数应返回最新LPR利率', () => {
        const result = queryLPRRate()
        expect(result).not.toBeNull()
        expect(result!.date).toBeDefined()
        expect(result!.oneYear).toBeGreaterThan(0)
        expect(result!.fiveYear).toBeGreaterThan(0)
    })

    it('应返回指定日期的LPR利率', () => {
        const result = queryLPRRate('2025-07-21')
        expect(result).not.toBeNull()
        expect(result!.date).toBe('2025-07-21')
    })

    it('查询日期早于所有记录应返回null', () => {
        const result = queryLPRRate('2010-01-01')
        expect(result).toBeNull()
    })

    it('应返回最近日期的记录', () => {
        const result = queryLPRRate('2020-01-15')
        expect(result).not.toBeNull()
        expect(new Date(result!.date).getTime()).toBeLessThanOrEqual(new Date('2020-01-20').getTime())
    })
})

describe('queryDepositRate', () => {
    it('无参数应返回最新存款基准利率', () => {
        const result = queryDepositRate()
        expect(result).not.toBeNull()
        expect(result!.date).toBeDefined()
        expect(result!.demand).toBeGreaterThan(0)
        expect(result!.oneYear).toBeGreaterThan(0)
    })

    it('应返回指定日期的存款基准利率', () => {
        const result = queryDepositRate('2015-10-24')
        expect(result).not.toBeNull()
        expect(result!.date).toBe('2015-10-24')
    })

    it('查询日期早于所有记录应返回null', () => {
        const result = queryDepositRate('2000-01-01')
        expect(result).toBeNull()
    })
})

describe('queryLoanRate', () => {
    it('无参数应返回最新贷款基准利率', () => {
        const result = queryLoanRate()
        expect(result).not.toBeNull()
        expect(result!.date).toBeDefined()
        expect(result!.sixMonths).toBeGreaterThan(0)
        expect(result!.oneYear).toBeGreaterThan(0)
    })

    it('应返回指定日期的贷款基准利率', () => {
        const result = queryLoanRate('2015-10-24')
        expect(result).not.toBeNull()
        expect(result!.date).toBe('2015-10-24')
    })

    it('查询日期早于所有记录应返回null', () => {
        const result = queryLoanRate('2000-01-01')
        expect(result).toBeNull()
    })
})

describe('getLPRHistory', () => {
    it('应返回LPR利率历史记录', () => {
        const result = getLPRHistory()
        expect(result.length).toBeGreaterThan(0)
    })

    it('每条记录应包含必要字段', () => {
        const result = getLPRHistory()
        result.forEach(rate => {
            expect(rate.date).toBeDefined()
            expect(rate.oneYear).toBeGreaterThan(0)
            expect(rate.fiveYear).toBeGreaterThan(0)
        })
    })
})

describe('getDepositRateHistory', () => {
    it('应返回存款基准利率历史记录', () => {
        const result = getDepositRateHistory()
        expect(result.length).toBeGreaterThan(0)
    })

    it('每条记录应包含必要字段', () => {
        const result = getDepositRateHistory()
        result.forEach(rate => {
            expect(rate.date).toBeDefined()
            expect(rate.demand).toBeGreaterThan(0)
            expect(rate.oneYear).toBeGreaterThan(0)
        })
    })
})

describe('getLoanRateHistory', () => {
    it('应返回贷款基准利率历史记录', () => {
        const result = getLoanRateHistory()
        expect(result.length).toBeGreaterThan(0)
    })

    it('每条记录应包含必要字段', () => {
        const result = getLoanRateHistory()
        result.forEach(rate => {
            expect(rate.date).toBeDefined()
            expect(rate.sixMonths).toBeGreaterThan(0)
            expect(rate.oneYear).toBeGreaterThan(0)
        })
    })
})

describe('calculateAverageLPR', () => {
    it('应正确计算指定日期范围内的一年期LPR平均值', () => {
        const result = calculateAverageLPR('2025-01-20', '2025-07-21', 'oneYear')
        expect(result).toBeGreaterThan(0)
    })

    it('应正确计算指定日期范围的五年期LPR平均值', () => {
        const result = calculateAverageLPR('2025-01-20', '2025-07-21', 'fiveYear')
        expect(result).toBeGreaterThan(0)
    })

    it('默认期限应为一年期', () => {
        const result = calculateAverageLPR('2025-01-20', '2025-07-21')
        expect(result).toBeGreaterThan(0)
    })

    it('日期范围内无记录应返回0', () => {
        const result = calculateAverageLPR('2010-01-01', '2010-06-01', 'oneYear')
        expect(result).toBe(0)
    })

    it('平均LPR应介于最高和最低之间', () => {
        const result = calculateAverageLPR('2025-01-20', '2025-07-21', 'oneYear')
        const rates = getLPRHistory()
        const minRate = Math.min(...rates.map(r => r.oneYear))
        const maxRate = Math.max(...rates.map(r => r.oneYear))
        expect(result).toBeGreaterThanOrEqual(minRate)
        expect(result).toBeLessThanOrEqual(maxRate)
    })
})

describe('getLatestLPR', () => {
    it('应返回最新的LPR利率', () => {
        const result = getLatestLPR()
        expect(result.date).toBeDefined()
        expect(result.oneYear).toBeGreaterThan(0)
    })

    it('应与queryLPRRate无参数结果一致', () => {
        const latest = getLatestLPR()
        const queried = queryLPRRate()
        expect(latest.date).toBe(queried!.date)
    })
})

describe('getLatestDepositRate', () => {
    it('应返回最新的存款基准利率', () => {
        const result = getLatestDepositRate()
        expect(result.date).toBeDefined()
        expect(result.demand).toBeGreaterThan(0)
    })

    it('应与queryDepositRate无参数结果一致', () => {
        const latest = getLatestDepositRate()
        const queried = queryDepositRate()
        expect(latest.date).toBe(queried!.date)
    })
})

describe('getLatestLoanRate', () => {
    it('应返回最新的贷款基准利率', () => {
        const result = getLatestLoanRate()
        expect(result.date).toBeDefined()
        expect(result.sixMonths).toBeGreaterThan(0)
    })

    it('应与queryLoanRate无参数结果一致', () => {
        const latest = getLatestLoanRate()
        const queried = queryLoanRate()
        expect(latest.date).toBe(queried!.date)
    })
})
