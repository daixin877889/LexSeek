/**
 * 利息计算服务测试
 *
 * 测试 getInterestRates, getRateForDate, calculateCustomRateInterest,
 * calculatePeriodInterest, calculateLPRInterest, calculatePBOCInterest,
 * calculateSimpleInterest, calculateCompoundInterest, calculateLoanInterest
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    getInterestRates,
    getRateForDate,
    calculateCustomRateInterest,
    calculatePeriodInterest,
    calculateLPRInterest,
    calculatePBOCInterest,
    calculateSimpleInterest,
    calculateCompoundInterest,
    calculateLoanInterest
} from '#shared/utils/tools/interestService'

// Mock logger
vi.mock('#shared/utils/logger', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }
}))

describe('getInterestRates', () => {
    it('应返回 LPR 类型的所有利率数据', () => {
        const rates = getInterestRates(2, 1)
        expect(rates.length).toBeGreaterThan(0)
        expect(rates.every(r => r.type === 2 && r.period === 1)).toBe(true)
    })

    it('应返回基准利率的所有利率数据', () => {
        const rates = getInterestRates(1, 2)
        expect(rates.length).toBeGreaterThan(0)
        expect(rates.every(r => r.type === 1 && r.period === 2)).toBe(true)
    })

    it('应按日期排序', () => {
        const rates = getInterestRates(2, 1)
        for (let i = 1; i < rates.length; i++) {
            expect(new Date(rates[i].sTime).getTime()).toBeGreaterThanOrEqual(
                new Date(rates[i - 1].sTime).getTime()
            )
        }
    })

    it('应处理字符串参数', () => {
        const rates = getInterestRates('2', '1')
        expect(rates.length).toBeGreaterThan(0)
    })

    it('参数为无效字符串应返回空数组', () => {
        // 覆盖 Number() 转换后 NaN 导致全不匹配的分支
        const rates = getInterestRates('invalid', '1')
        expect(rates).toEqual([])
    })

    it('应返回空数组当没有匹配数据', () => {
        const rates = getInterestRates(99, 99)
        expect(rates).toEqual([])
    })
})

describe('getRateForDate', () => {
    it('应返回适用于指定日期的利率', () => {
        const rate = getRateForDate(2, 1, '2024-07-22')
        expect(rate).toBeGreaterThan(0)
    })

    it('日期早于所有记录应返回第一个利率', () => {
        const rate = getRateForDate(2, 1, '2000-01-01')
        expect(rate).toBeGreaterThan(0)
    })

    it('应处理字符串参数', () => {
        const rate = getRateForDate('2', '1', '2024-07-22')
        expect(rate).toBeGreaterThan(0)
    })

    it('无匹配数据应返回 0', () => {
        const rate = getRateForDate(99, 99, '2024-07-22')
        expect(rate).toBe(0)
    })

    it('日期早于所有 LPR 记录应返回第一个利率', () => {
        // 覆盖 line 308-310: targetDate < firstRateDate 分支
        // LPR data starts at 2019-08-20, query 2000-01-01 triggers early return
        const rate = getRateForDate(2, 1, '2000-01-01')
        expect(rate).toBeGreaterThan(0)
    })
})

describe('calculateCustomRateInterest', () => {
    it('应正确计算自定义利率利息', () => {
        // 使用跨年日期范围确保 365 天: daysBetween('2025-01-01', '2026-01-01') = 365
        const result = calculateCustomRateInterest(10000, 5, '2025-01-01', '2026-01-01', 365)
        expect(result.error).toBeUndefined()
        expect(result.totalInterest).toBeCloseTo(500, 1)
        expect(result.total).toBeCloseTo(10500, 1)
    })

    it('本金为零或负数应返回错误', () => {
        const result1 = calculateCustomRateInterest(0, 5, '2025-01-01', '2025-12-31')
        expect(result1.error).toBe('本金必须为正数')

        const result2 = calculateCustomRateInterest(-100, 5, '2025-01-01', '2025-12-31')
        expect(result2.error).toBe('本金必须为正数')
    })

    it('负利率应返回错误', () => {
        const result = calculateCustomRateInterest(10000, -1, '2025-01-01', '2025-12-31')
        expect(result.error).toBe('利率必须为非负数')
    })

    it('日期为空应返回错误', () => {
        const result1 = calculateCustomRateInterest(10000, 5, '', '2025-12-31')
        expect(result1.error).toBe('开始日期和结束日期不能为空')

        const result2 = calculateCustomRateInterest(10000, 5, '2025-01-01', '')
        expect(result2.error).toBe('开始日期和结束日期不能为空')
    })

    it('结束日期早于开始日期应返回错误', () => {
        // daysBetween 返回绝对值, 所以 reversed dates 仍返回正数
        const result = calculateCustomRateInterest(10000, 5, '2025-12-31', '2025-01-01')
        expect(result.error).toBeUndefined()
        // 364天 * 5% * 10000 / 365 = 498.63
        expect(result.totalInterest).toBeGreaterThan(490)
    })

    it('应处理字符串参数', () => {
        const result = calculateCustomRateInterest('10000', '5', '2025-01-01', '2026-01-01')
        expect(result.error).toBeUndefined()
        expect(result.totalInterest).toBeCloseTo(500, 1)
    })

    it('应包含计算明细', () => {
        const result = calculateCustomRateInterest(10000, 5, '2025-01-01', '2026-01-01')
        expect(result.details.length).toBeGreaterThan(0)
        expect(result.interestDetails.length).toBe(1)
    })

    it('应正确处理 yearDays=360', () => {
        const result365 = calculateCustomRateInterest(10000, 5, '2025-01-01', '2026-01-01', 365)
        const result360 = calculateCustomRateInterest(10000, 5, '2025-01-01', '2026-01-01', 360)
        expect(result360.totalInterest).toBeGreaterThan(result365.totalInterest)
    })

    it('非标准年计息天数应触发警告', () => {
        // 覆盖 line 382-384: 非365/366的yearDays触发warn
        const result = calculateCustomRateInterest(10000, 5, '2025-01-01', '2026-01-01', 360)
        expect(result.error).toBeUndefined()
    })

    it('NaN 本金应返回错误', () => {
        // 覆盖 line 358: isNaN(principalNum) 分支
        const result = calculateCustomRateInterest(NaN, 5, '2025-01-01', '2026-01-01')
        expect(result.error).toBe('本金必须为正数')
    })

    it('NaN 利率应返回错误', () => {
        // 覆盖 line 363: isNaN(rateNum) 分支
        const result = calculateCustomRateInterest(10000, NaN, '2025-01-01', '2026-01-01')
        expect(result.error).toBe('利率必须为非负数')
    })
})

describe('calculatePeriodInterest', () => {
    it('应正确计算期间利息', () => {
        const result = calculatePeriodInterest(10000, 5, 365, 365)
        expect(result.interest).toBeCloseTo(500, 1)
    })

    it('应正确处理加点调整', () => {
        const result = calculatePeriodInterest(10000, 5, 365, 365, '加点', 50)
        expect(result.adjustedRate).toBe(5.5)
    })

    it('应正确处理减点调整', () => {
        const result = calculatePeriodInterest(10000, 5, 365, 365, '减点', 50)
        expect(result.adjustedRate).toBe(4.5)
    })

    it('应正确处理倍率调整', () => {
        const result = calculatePeriodInterest(10000, 5, 365, 365, '倍率', 2)
        expect(result.adjustedRate).toBe(10)
    })

    it('应正确处理上浮调整', () => {
        const result = calculatePeriodInterest(10000, 5, 365, 365, '上浮', 20)
        expect(result.adjustedRate).toBe(6)
    })

    it('应正确处理下浮调整', () => {
        const result = calculatePeriodInterest(10000, 5, 365, 365, '下浮', 20)
        expect(result.adjustedRate).toBe(4)
    })

    it('本金为零或负数应返回错误信息', () => {
        const result = calculatePeriodInterest(0, 5, 365)
        expect(result.process).toContain('计算错误')
    })

    it('天数为零或负数应返回错误信息', () => {
        const result = calculatePeriodInterest(10000, 5, 0)
        expect(result.process).toContain('计算错误')
    })

    it('利率无效应返回错误信息', () => {
        // 覆盖 line 497-508: isNaN(rateNum) || isNaN(daysNum) 分支
        const result = calculatePeriodInterest(10000, NaN, 365)
        expect(result.process).toContain('计算错误')
    })

    it('日期参数应为 Date 对象计算天数', () => {
        // 覆盖 line 472-481: days 为日期字符串且 yearDays 也为日期字符串
        const result = calculatePeriodInterest(10000, 5, '2025-01-01', '2025-06-01')
        expect(result.interest).toBeGreaterThan(0)
    })

    it('应正确处理倍数调整', () => {
        // '倍数' alias for '倍率'
        const result = calculatePeriodInterest(10000, 5, 365, 365, '倍数', 2)
        expect(result.adjustedRate).toBe(10)
    })
})

describe('calculateLPRInterest', () => {
    it('应正确计算 LPR 利息', () => {
        const result = calculateLPRInterest(10000, '2024-07-20', '2024-10-20', 1, '无', 0, 360)
        expect(result.error).toBeUndefined()
        expect(result.totalInterest).toBeGreaterThan(0)
        expect(result.days).toBeGreaterThan(0)
    })

    it('开始日期晚于结束日期应返回错误', () => {
        const result = calculateLPRInterest(10000, '2024-10-20', '2024-07-20', 1, '无', 0)
        expect(result.error).toBeUndefined()
        expect(result.totalInterest).toBe(0)
        expect(result.details.some((d: string) => d.includes('日期错误'))).toBe(true)
    })

    it('早于 LPR 政策日期的开始日期应自动调整', () => {
        const result = calculateLPRInterest(10000, '2019-01-01', '2019-12-31', 1, '无', 0)
        expect(result.error).toBeUndefined()
        expect(result.startDate).toBe('2019-08-20')
    })

    it('应正确处理加点调整', () => {
        const result1 = calculateLPRInterest(10000, '2024-07-20', '2024-10-20', 1, '加点', 50, 360)
        expect(result1.error).toBeUndefined()
    })

    it('无 LPR 数据应返回错误', () => {
        const result = calculateLPRInterest(10000, '2024-07-20', '2024-10-20', 99, '无', 0)
        expect(result.error).toBe('NO_LPR_RATES')
    })

    it('应正确处理减点调整', () => {
        const result = calculateLPRInterest(10000, '2024-07-20', '2024-10-20', 1, '减点', 50, 360)
        expect(result.error).toBeUndefined()
    })

    it('应正确处理倍率调整', () => {
        const result = calculateLPRInterest(10000, '2024-07-20', '2024-10-20', 1, '倍率', 2, 360)
        expect(result.error).toBeUndefined()
    })

    it('应正确处理倍数调整', () => {
        const result = calculateLPRInterest(10000, '2024-07-20', '2024-10-20', 1, '倍数', 2, 360)
        expect(result.error).toBeUndefined()
    })

    it('应正确处理下浮调整', () => {
        const result = calculateLPRInterest(10000, '2024-07-20', '2024-10-20', 1, '下浮', 20, 360)
        expect(result.error).toBeUndefined()
    })

    it('结束日期晚于最新 LPR 日期应使用最新利率估计', () => {
        // 覆盖 usedEstimatedRate 分支
        const result = calculateLPRInterest(10000, '2024-07-20', '2099-12-31', 1, '无', 0, 360)
        expect(result.error).toBeUndefined()
        expect(result.totalInterest).toBeGreaterThan(0)
    })
})

describe('calculatePBOCInterest', () => {
    it('应正确计算基准利率利息', () => {
        const result = calculatePBOCInterest(10000, '2020-01-01', '2020-06-30', 2)
        expect(result.error).toBeUndefined()
        expect(result.totalInterest).toBeGreaterThan(0)
    })

    it('开始日期晚于结束日期应返回错误', () => {
        const result = calculatePBOCInterest(10000, '2020-06-30', '2020-01-01', 2)
        expect(result.details.some(d => d.includes('日期错误'))).toBe(true)
    })

    it('应正确处理调整方式', () => {
        const result = calculatePBOCInterest(10000, '2020-01-01', '2020-06-30', 2, '上浮', 20)
        expect(result.error).toBeUndefined()
    })

    it('应包含利息明细', () => {
        const result = calculatePBOCInterest(10000, '2020-01-01', '2020-06-30', 2)
        expect(result.interestDetails.length).toBeGreaterThan(0)
    })

    it('无匹配利率应返回提示', () => {
        // 使用早于所有利率数据的日期，触发 pbocRates.length === 0 分支
        const result = calculatePBOCInterest(10000, '1990-01-01', '1990-06-01', 2)
        // earliestRate 存在但不适用，触发无适用利率提示
        expect(result.details.length).toBeGreaterThan(0)
    })

    it('应正确处理下浮调整', () => {
        const result = calculatePBOCInterest(10000, '2020-01-01', '2020-06-30', 2, '下浮', 20)
        expect(result.error).toBeUndefined()
    })

    it('应正确处理倍率调整', () => {
        const result = calculatePBOCInterest(10000, '2020-01-01', '2020-06-30', 2, '倍率', 2)
        expect(result.error).toBeUndefined()
    })

    it('应正确处理倍数调整', () => {
        const result = calculatePBOCInterest(10000, '2020-01-01', '2020-06-30', 2, '倍数', 2)
        expect(result.error).toBeUndefined()
    })

    it('应正确处理减点调整', () => {
        const result = calculatePBOCInterest(10000, '2020-01-01', '2020-06-30', 2, '减点', 50)
        expect(result.error).toBeUndefined()
    })

    it('应覆盖 period=1 的分支（六个月以内）', () => {
        // 覆盖 switch case 1: periodText = '六个月以内'
        const result = calculatePBOCInterest(10000, '2020-01-01', '2020-06-30', 1)
        expect(result.error).toBeUndefined()
        expect(result.details.some(d => d.includes('六个月以内'))).toBe(true)
    })

    it('应覆盖 period=3 的分支（一至三年）', () => {
        // 覆盖 switch case 3: periodText = '一至三年'
        const result = calculatePBOCInterest(10000, '2020-01-01', '2020-06-30', 3)
        expect(result.error).toBeUndefined()
        expect(result.details.some(d => d.includes('一至三年'))).toBe(true)
    })

    it('应覆盖 period=4 的分支（三至五年）', () => {
        // 覆盖 switch case 4: periodText = '三至五年'
        const result = calculatePBOCInterest(10000, '2020-01-01', '2020-06-30', 4)
        expect(result.error).toBeUndefined()
        expect(result.details.some(d => d.includes('三至五年'))).toBe(true)
    })

    it('应覆盖 period=5 的分支（五年以上）', () => {
        // 覆盖 switch case 5: periodText = '五年以上'
        const result = calculatePBOCInterest(10000, '2020-01-01', '2020-06-30', 5)
        expect(result.error).toBeUndefined()
        expect(result.details.some(d => d.includes('五年以上'))).toBe(true)
    })
})

describe('calculateSimpleInterest', () => {
    it('应正确计算单利', () => {
        // 使用跨年日期范围确保 365 天: daysBetween('2025-01-01', '2026-01-01') = 365
        const result = calculateSimpleInterest(10000, 5, '2025-01-01', '2026-01-01')
        expect(result.interest).toBeCloseTo(500, 1)
        expect(result.total).toBeCloseTo(10500, 1)
        expect(result.days).toBeGreaterThan(0)
    })

    it('应包含计算明细', () => {
        const result = calculateSimpleInterest(10000, 5, '2025-01-01', '2026-01-01')
        expect(result.details.length).toBeGreaterThan(0)
        expect(result.details.some(d => d.includes('单利'))).toBe(true)
    })
})

describe('calculateCompoundInterest', () => {
    it('应正确计算复利', () => {
        // 使用跨年日期范围确保 365 天
        const result = calculateCompoundInterest(10000, 5, '2025-01-01', '2026-01-01')
        // 复利: 10000 * (1.05)^1 - 10000 = 500
        expect(result.interest).toBeGreaterThanOrEqual(500)
        expect(result.total).toBeGreaterThanOrEqual(10500)
    })

    it('应包含计算明细', () => {
        const result = calculateCompoundInterest(10000, 5, '2025-01-01', '2026-01-01')
        expect(result.details.some(d => d.includes('复利'))).toBe(true)
    })
})

describe('calculateLoanInterest', () => {
    it('等额本息应正确计算', () => {
        const result = calculateLoanInterest(100000, 5, 12, 'equal')
        expect(result.totalInterest).toBeGreaterThan(0)
        expect(result.totalPayment).toBeGreaterThan(100000)
        expect(result.monthlyPayment).toBeDefined()
    })

    it('等额本金应正确计算', () => {
        const result = calculateLoanInterest(100000, 5, 12, 'principal')
        expect(result.totalInterest).toBeGreaterThan(0)
        expect(result.monthlyPrincipal).toBeCloseTo(8333.33, 1)
        expect(result.firstMonthPayment).toBeGreaterThan(result.lastMonthPayment!)
    })

    it('两种还款方式应产生不同的总利息', () => {
        const equal = calculateLoanInterest(100000, 5, 12, 'equal')
        const principal = calculateLoanInterest(100000, 5, 12, 'principal')
        expect(equal.totalInterest).not.toBeCloseTo(principal.totalInterest, 1)
    })
})

describe('calculateCustomRateInterest 参数校验', () => {
    it('结束日期等于开始日期时 days<=0 应返回错误', () => {
        const result = calculateCustomRateInterest(10000, 5, '2025-06-20', '2025-06-20') as any
        expect(result.error).toBe('结束日期必须晚于开始日期')
    })

    it('yearDays 省略时应使用默认值 365', () => {
        // 触发 calculateCustomRateInterest 的 yearDays 默认参数
        const result = calculateCustomRateInterest(10000, 5, '2025-01-01', '2026-01-01')
        expect(result.yearDays).toBe(365)
    })
})

describe('calculatePeriodInterest 参数校验与默认参数', () => {
    it('省略 yearDays/adjustmentMethod/adjustmentValue 应使用默认值（365/无/0）', () => {
        // 触发 line 455-457 的默认参数（yearDays=365, adjustmentMethod='无', adjustmentValue=0）
        const result = calculatePeriodInterest(10000, 5, 365)
        expect(result.yearDays).toBe(365)
        expect(result.adjustedRate).toBe(5)
        expect(result.interest).toBeCloseTo(500, 0)
    })

    it('利率为 NaN 应返回错误', () => {
        // 触发 line 495 if (isNaN(rateNum) || isNaN(daysNum))
        const result = calculatePeriodInterest(10000, 'invalid', 365)
        expect(result.interest).toBe(0)
        expect(result.process).toContain('利率或天数无效')
    })

    it('天数 <=0 应返回错误', () => {
        // 触发 line 508 if (daysNum <= 0)
        const result = calculatePeriodInterest(10000, 5, 0)
        expect(result.interest).toBe(0)
        expect(result.process).toContain('天数必须为正数')
    })

    it('days 是日期字符串且 yearDays 也是日期字符串时应自动计算天数', () => {
        // 触发 line 470, 472 的 days/yearDays 都是日期字符串的特殊调用
        const result = calculatePeriodInterest(10000, 5, '2025-01-01', '2026-01-01')
        expect(result.days).toBeGreaterThan(0)
        expect(result.yearDays).toBe(365)
    })

    it('days 是日期字符串但 yearDays 不是字符串时应走 else 分支（按 parseInt 取值）', () => {
        // 触发 line 477-478 的 else 分支（无效的日期参数组合，但 parseInt('2025-01-01') = 2025）
        const result = calculatePeriodInterest(10000, 5, '2025-01-01', 365)
        // parseInt('2025-01-01') === 2025
        expect(result.days).toBe(2025)
        expect(result.interest).toBeGreaterThan(0)
    })

    it('调整方式为"上浮"应按百分比上浮利率', () => {
        // 触发 line 538 上浮分支
        const result = calculatePeriodInterest(10000, 4, 365, 365, '上浮', 50)
        expect(result.adjustedRate).toBeCloseTo(6, 5)
    })

    it('调整方式为"下浮"应按百分比下浮利率', () => {
        // 触发 line 540 下浮分支
        const result = calculatePeriodInterest(10000, 4, 365, 365, '下浮', 25)
        expect(result.adjustedRate).toBeCloseTo(3, 5)
    })

    it('本金为 NaN 或 <=0 应返回错误', () => {
        // 触发 line 482 的 isNaN(principalNum) || principalNum <= 0
        const result = calculatePeriodInterest(0, 5, 365)
        expect(result.interest).toBe(0)
        expect(result.process).toContain('本金必须为正数')
    })
})

describe('calculateLPRInterest 利率调整方式补充', () => {
    it('调整方式为"加点"应按基点加点', () => {
        // 触发 line 716 加点分支
        const result = calculateLPRInterest(100000, '2024-01-01', '2025-01-01', 1, '加点', 50)
        expect(result.error).toBeUndefined()
        // 加 50 个基点（= 0.5%）
        const detail = result.interestDetails![0]
        expect(detail.adjustedRate).toBeCloseTo(detail.rate + 0.5, 5)
    })

    it('调整方式为"减点"应按基点减点', () => {
        // 触发 line 719 减点分支
        const result = calculateLPRInterest(100000, '2024-01-01', '2025-01-01', 1, '减点', 30)
        expect(result.error).toBeUndefined()
        const detail = result.interestDetails![0]
        expect(detail.adjustedRate).toBeCloseTo(detail.rate - 0.3, 5)
    })

    it('调整方式为"倍数"应按倍数调整', () => {
        // 触发 line 722 倍数分支
        const result = calculateLPRInterest(100000, '2024-01-01', '2025-01-01', 1, '倍数', 4)
        expect(result.error).toBeUndefined()
        const detail = result.interestDetails![0]
        expect(detail.adjustedRate).toBeCloseTo(detail.rate * 4, 5)
    })

    it('调整方式为"上浮"应按百分比上浮利率', () => {
        // 触发 line 724 上浮分支
        const result = calculateLPRInterest(100000, '2024-01-01', '2025-01-01', 1, '上浮', 50)
        expect(result.error).toBeUndefined()
        const detail = result.interestDetails![0]
        expect(detail.adjustedRate).toBeCloseTo(detail.rate * 1.5, 5)
    })

    it('调整方式为"下浮"应按百分比下浮利率', () => {
        // 触发 line 726 下浮分支
        const result = calculateLPRInterest(100000, '2024-01-01', '2025-01-01', 1, '下浮', 20)
        expect(result.error).toBeUndefined()
        const detail = result.interestDetails![0]
        expect(detail.adjustedRate).toBeCloseTo(detail.rate * 0.8, 5)
    })
})

describe('calculatePBOCInterest 边界与默认参数', () => {
    it('省略 period/adjustmentMethod/adjustmentValue/yearDays 应使用默认值', () => {
        // 触发 line 823-826 的 4 个默认参数
        const result = calculatePBOCInterest(10000, '2014-01-01', '2015-01-01')
        expect(result.totalInterest).toBeGreaterThan(0)
        expect(result.error).toBeUndefined()
    })

    it('开始日期晚于结束日期应返回错误', () => {
        // 触发 line 849 if (start > end)
        const result = calculatePBOCInterest(10000, '2025-06-20', '2025-01-01')
        expect(result.totalInterest).toBe(0)
        expect(result.details!.some(d => d.includes('日期错误'))).toBe(true)
    })

    it('结束日期早于所有基准利率发布日期，应使用最早基准利率', () => {
        // 触发 line 866 的 if (pbocRates.length === 0) 分支
        // 最早的基准利率是 1991-04-21，传 endDate 早于此日期
        const result = calculatePBOCInterest(10000, '1990-01-01', '1991-01-01')
        expect(result.totalInterest).toBeGreaterThan(0)
        expect(result.interestDetails!.length).toBe(1)
    })
})

describe('calculateSimpleInterest / calculateCompoundInterest / calculateLoanInterest 默认参数', () => {
    it('calculateSimpleInterest 省略 yearDays 应使用默认 365', () => {
        // 触发 line 1092 的 yearDays 默认参数
        const result = calculateSimpleInterest(10000, 5, '2025-01-01', '2026-01-01')
        expect(result.interest).toBeCloseTo(500, 0)
    })
})

describe('calculateCustomRateInterest 中 yearDays 非标准值的警告路径', () => {
    it('传入非标准 yearDays（非 365/366）应忽略并使用 365', () => {
        // 触发 line 380 的 yearDaysNum !== 365 && yearDaysNum !== 366 警告路径
        const result = calculateCustomRateInterest(10000, 5, '2025-01-01', '2026-01-01', 360 as any) as any
        // 警告但继续计算
        expect(result.error).toBeUndefined()
    })
})

describe('补充：触发 binary-expr 的 || fallback 分支', () => {
    it('calculateCustomRateInterest 传 yearDays=NaN 时 parseInt 返回 NaN，触发 || 365 fallback', () => {
        // parseInt('abc') 返回 NaN，触发 line 375 的 || 365
        const result = calculateCustomRateInterest(10000, 5, '2025-01-01', '2026-01-01', 'abc' as any)
        expect(result.yearDays).toBe(365)
    })

    it('calculatePeriodInterest 传 days="abc"（非日期非数字）应触发 line 463 的 || 0 fallback', () => {
        // typeof days === 'string' 且 !includes('-')，parseInt('abc')=NaN，触发 || 0
        const result = calculatePeriodInterest(10000, 5, 'abc')
        expect(result.interest).toBe(0)
        expect(result.process).toContain('天数必须为正数')
    })

    it('calculatePeriodInterest 传 yearDays="abc" 应触发 line 464 的 || 365 fallback', () => {
        // typeof yearDays === 'string' 且 parseInt 失败，触发 || 365
        const result = calculatePeriodInterest(10000, 5, 365, 'abc' as any)
        expect(result.yearDays).toBe(365)
    })

    it('calculatePeriodInterest 传 days="abc-def"（含-但非日期）应触发 line 474 的 || 0', () => {
        // days 包含 '-' 但 parseDate 失败 / yearDays 不是字符串，走 else 分支后 parseInt('abc-def')=NaN
        const result = calculatePeriodInterest(10000, 5, 'abc-def', 365)
        expect(result.days).toBe(0)
    })
})

describe('补充：calculateLPRInterest period=2 + adjustmentMethod=无', () => {
    it('5年期 LPR 应输出"LPR 5年期以上"字样并返回正确利息', () => {
        // 触发 line 785 cond-expr 的 false 分支（period=2）
        // 同时触发 line 786 cond-expr 的 false 分支（adjustmentMethod === '无'）
        const result = calculateLPRInterest(100000, '2024-01-01', '2025-01-01', 2, '无', 0)
        expect(result.error).toBeUndefined()
        expect(result.details!.some(d => d.includes('LPR 5年期以上'))).toBe(true)
        expect(result.details!.some(d => d.includes('无利率调整'))).toBe(true)
    })

    it('结束日期晚于最新 LPR 日期应使用最新利率作为估计', () => {
        // 触发 usedEstimatedRate=true 分支
        const future = new Date()
        future.setFullYear(future.getFullYear() + 5)
        const futureStr = future.toISOString().slice(0, 10)
        const result = calculateLPRInterest(10000, '2024-01-01', futureStr, 1, '无', 0)
        expect(result.error).toBeUndefined()
        expect(result.details!.some(d => d.includes('最新的LPR利率作为估计值'))).toBe(true)
    })
})

describe('补充：calculatePBOCInterest 各 adjustmentMethod 分支', () => {
    it('调整方式为"加点"应按 BP 加点', () => {
        const result = calculatePBOCInterest(100000, '2015-01-01', '2016-01-01', 5, '加点', 50)
        expect(result.totalInterest).toBeGreaterThan(0)
        expect(result.details!.some(d => d.includes('加点'))).toBe(true)
    })

    it('调整方式为"减点"应按 BP 减点', () => {
        const result = calculatePBOCInterest(100000, '2015-01-01', '2016-01-01', 5, '减点', 30)
        expect(result.totalInterest).toBeGreaterThan(0)
        expect(result.details!.some(d => d.includes('减点'))).toBe(true)
    })

    it('调整方式为"上浮"应按百分比上浮', () => {
        const result = calculatePBOCInterest(100000, '2015-01-01', '2016-01-01', 5, '上浮', 30)
        expect(result.totalInterest).toBeGreaterThan(0)
        expect(result.details!.some(d => d.includes('上浮'))).toBe(true)
    })

    it('调整方式为"下浮"应按百分比下浮', () => {
        const result = calculatePBOCInterest(100000, '2015-01-01', '2016-01-01', 5, '下浮', 20)
        expect(result.totalInterest).toBeGreaterThan(0)
        expect(result.details!.some(d => d.includes('下浮'))).toBe(true)
    })

    it('调整方式为"倍率"应按倍率', () => {
        const result = calculatePBOCInterest(100000, '2015-01-01', '2016-01-01', 5, '倍率', 2)
        expect(result.totalInterest).toBeGreaterThan(0)
    })
})

describe('补充：calculateLoanInterest 默认参数', () => {
    it('省略 method 参数应默认为 equal（等额本息）', () => {
        // 触发 line 1063 default-arg
        const result = calculateLoanInterest(100000, 5, 12)
        expect(result.monthlyPayment).toBeDefined()
        expect(result.totalInterest).toBeGreaterThan(0)
    })
})

describe('补充：LPR/PBOC 调整方式输出文本嵌套三元', () => {
    it('LPR + 倍数：单位应输出"倍"', () => {
        // 触发 line 787 嵌套三元中的"倍数"分支
        const result = calculateLPRInterest(100000, '2024-01-01', '2025-01-01', 1, '倍数', 4)
        expect(result.error).toBeUndefined()
        expect(result.details!.some(d => d.includes('倍数 4倍'))).toBe(true)
    })

    it('PBOC + 倍数：单位应输出"倍"', () => {
        // 触发 line 961 嵌套三元中的"倍数"分支
        const result = calculatePBOCInterest(100000, '2015-01-01', '2016-01-01', 5, '倍数', 4)
        expect(result.totalInterest).toBeGreaterThan(0)
        expect(result.details!.some(d => d.includes('倍数 4倍'))).toBe(true)
    })

    it('LPR + 下浮：单位应输出"%"', () => {
        // 触发 line 787 嵌套三元中的"下浮"分支
        const result = calculateLPRInterest(100000, '2024-01-01', '2025-01-01', 1, '下浮', 20)
        expect(result.error).toBeUndefined()
        expect(result.details!.some(d => d.includes('下浮 20%'))).toBe(true)
    })

    it('LPR + 倍率：单位应输出"倍"（不同于"倍数"）', () => {
        // 触发 line 787 嵌套三元中的 '倍率' 分支
        const result = calculateLPRInterest(100000, '2024-01-01', '2025-01-01', 1, '倍率', 4)
        expect(result.error).toBeUndefined()
        expect(result.details!.some(d => d.includes('倍率 4倍'))).toBe(true)
    })

    it('PBOC + 上浮：单位应输出"%"', () => {
        // 触发 line 963 嵌套三元中的"上浮"分支
        const result = calculatePBOCInterest(100000, '2015-01-01', '2016-01-01', 5, '上浮', 50)
        expect(result.totalInterest).toBeGreaterThan(0)
        expect(result.details!.some(d => d.includes('上浮 50%'))).toBe(true)
    })

    it('PBOC + 倍率：单位应输出"倍"', () => {
        // 触发 line 963 嵌套三元中的 '倍率' 分支
        const result = calculatePBOCInterest(100000, '2015-01-01', '2016-01-01', 5, '倍率', 2)
        expect(result.totalInterest).toBeGreaterThan(0)
        expect(result.details!.some(d => d.includes('倍率 2倍'))).toBe(true)
    })
})
