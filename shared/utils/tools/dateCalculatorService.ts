/**
 * 日期推算服务
 */

import { addDays, addMonths, addYears, formatDate, getWorkingDays } from './utils/date'
import type {
    DateCalculationResult,
    WorkingDaysResult,
    LegalDeadlineResult,
    LimitationPeriodResult,
    LimitationType
} from '@/types/tools'

/**
 * 计算从起始日期推算指定天数后的日期
 * @param startDate 起始日期，格式YYYY-MM-DD
 * @param days 天数，可以为负数
 * @returns 计算结果
 */
export function calculateDateAfterDays(startDate: string, days: number): DateCalculationResult {
    const result = addDays(startDate, days)

    return {
        startDate,
        days,
        resultDate: formatDate(result),
        details: `从${startDate}开始，${days >= 0 ? '向后' : '向前'}推算${Math.abs(days)}天，结果是${formatDate(result)}`
    }
}

/**
 * 计算从起始日期推算指定月数后的日期
 * @param startDate 起始日期，格式YYYY-MM-DD
 * @param months 月数，可以为负数
 * @returns 计算结果
 */
export function calculateDateAfterMonths(startDate: string, months: number): DateCalculationResult {
    const result = addMonths(startDate, months)

    return {
        startDate,
        months,
        resultDate: formatDate(result),
        details: `从${startDate}开始，${months >= 0 ? '向后' : '向前'}推算${Math.abs(months)}个月，结果是${formatDate(result)}`
    }
}

/**
 * 计算从起始日期推算指定年数后的日期
 * @param startDate 起始日期，格式YYYY-MM-DD
 * @param years 年数，可以为负数
 * @returns 计算结果
 */
export function calculateDateAfterYears(startDate: string, years: number): DateCalculationResult {
    const result = addYears(startDate, years)

    return {
        startDate,
        years,
        resultDate: formatDate(result),
        details: `从${startDate}开始，${years >= 0 ? '向后' : '向前'}推算${Math.abs(years)}年，结果是${formatDate(result)}`
    }
}

/**
 * 计算两个日期之间的工作日天数（不包括周六日）
 * @param startDate 起始日期，格式YYYY-MM-DD
 * @param endDate 结束日期，格式YYYY-MM-DD
 * @returns 计算结果
 */
export function calculateWorkingDays(startDate: string, endDate: string): WorkingDaysResult {
    const workingDays = getWorkingDays(startDate, endDate)

    return {
        startDate,
        endDate,
        workingDays,
        details: `从${startDate}到${endDate}之间的工作日天数（不包括周六日）为${workingDays}天`
    }
}

/**
 * 计算法定期限
 * @param startDate 起始日期，格式YYYY-MM-DD
 * @param days 法定期限天数
 * @param excludeHolidays 是否排除节假日，默认为true
 * @returns 计算结果
 */
export function calculateLegalDeadline(startDate: string, days: number, excludeHolidays: boolean = true): LegalDeadlineResult {
    // 这里简化处理，实际应用中需要一个节假日数据库
    // 这里假设只排除周六日
    let result: Date

    if (excludeHolidays) {
        // 如果排除节假日，需要计算实际需要的自然日
        // 简化：假设平均每7天有5个工作日，所以需要的自然日约为 days * 7/5
        const naturalDays = Math.ceil(days * 7 / 5)
        result = addDays(startDate, naturalDays)
    } else {
        // 不排除节假日，直接加天数
        result = addDays(startDate, days)
    }

    return {
        startDate,
        days,
        excludeHolidays,
        resultDate: formatDate(result),
        details: `从${startDate}开始，法定期限${days}天${excludeHolidays ? '（排除节假日）' : ''}，截止日期是${formatDate(result)}`
    }
}

/**
 * 计算诉讼时效
 * @param startDate 起始日期，格式YYYY-MM-DD
 * @param type 诉讼时效类型，可选值：'general'(一般民事), 'contract'(合同), 'personal'(人身伤害)
 * @returns 计算结果
 */
export function calculateLimitationPeriod(startDate: string, type: LimitationType = 'general'): LimitationPeriodResult {
    let years = 3 // 默认一般民事诉讼时效为3年

    if (type === 'contract') {
        years = 3 // 合同纠纷诉讼时效为3年
    } else if (type === 'personal') {
        years = 1 // 人身伤害诉讼时效为1年
    }

    const result = addYears(startDate, years)

    let typeText = '一般民事'
    if (type === 'contract') {
        typeText = '合同纠纷'
    } else if (type === 'personal') {
        typeText = '人身伤害'
    }

    return {
        startDate,
        type,
        years,
        resultDate: formatDate(result),
        details: `从${startDate}开始，${typeText}诉讼时效为${years}年，截止日期是${formatDate(result)}`
    }
}
