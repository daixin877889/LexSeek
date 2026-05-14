/**
 * 银行利率查询服务
 */

import type { LPRRate, DepositRate, LoanRate } from '#shared/types/tools'
import { getLPRRates, getDepositRates, getLoanRates } from '#shared/utils/tools/data'

/**
 * 查询LPR利率
 * @param date 查询日期，格式YYYY-MM-DD
 * @returns LPR利率数据
 */
export function queryLPRRate(date?: string): LPRRate | null {
    // 如果没有指定日期，返回最新的LPR利率（data 层数组非空，[0] 必存在）
    if (!date) {
        return getLPRRates()[0]!
    }

    // 将查询日期转换为时间戳
    const queryTimestamp = new Date(date).getTime()

    // 查找小于等于查询日期的最近一条记录
    const lprRates = getLPRRates()
    for (let i = 0; i < lprRates.length; i++) {
        const rate = lprRates[i]!
        const rateTimestamp = new Date(rate.date).getTime()
        if (queryTimestamp >= rateTimestamp) {
            return rate
        }
    }

    // 如果查询日期早于所有记录，返回null
    return null
}

/**
 * 查询存款基准利率
 * @param date 查询日期，格式YYYY-MM-DD
 * @returns 存款基准利率数据
 */
export function queryDepositRate(date?: string): DepositRate | null {
    // 如果没有指定日期，返回最新的存款基准利率（data 层数组非空，[0] 必存在）
    if (!date) {
        return getDepositRates()[0]!
    }

    // 将查询日期转换为时间戳
    const queryTimestamp = new Date(date).getTime()

    // 查找小于等于查询日期的最近一条记录
    const depositRates = getDepositRates()
    for (let i = 0; i < depositRates.length; i++) {
        const rate = depositRates[i]!
        const rateTimestamp = new Date(rate.date).getTime()
        if (queryTimestamp >= rateTimestamp) {
            return rate
        }
    }

    // 如果查询日期早于所有记录，返回null
    return null
}

/**
 * 查询贷款基准利率
 * @param date 查询日期，格式YYYY-MM-DD
 * @returns 贷款基准利率数据
 */
export function queryLoanRate(date?: string): LoanRate | null {
    // 如果没有指定日期，返回最新的贷款基准利率（data 层数组非空，[0] 必存在）
    if (!date) {
        return getLoanRates()[0]!
    }

    // 将查询日期转换为时间戳
    const queryTimestamp = new Date(date).getTime()

    // 查找小于等于查询日期的最近一条记录
    const loanRates = getLoanRates()
    for (let i = 0; i < loanRates.length; i++) {
        const rate = loanRates[i]!
        const rateTimestamp = new Date(rate.date).getTime()
        if (queryTimestamp >= rateTimestamp) {
            return rate
        }
    }

    // 如果查询日期早于所有记录，返回null
    return null
}

/**
 * 获取所有LPR利率历史记录
 * @returns LPR利率历史记录
 */
export function getLPRHistory(): LPRRate[] {
    return [...getLPRRates()]
}

/**
 * 获取所有存款基准利率历史记录
 * @returns 存款基准利率历史记录
 */
export function getDepositRateHistory(): DepositRate[] {
    return [...getDepositRates()]
}

/**
 * 获取所有贷款基准利率历史记录
 * @returns 贷款基准利率历史记录
 */
export function getLoanRateHistory(): LoanRate[] {
    return [...getLoanRates()]
}

/**
 * 计算指定日期范围内的平均LPR利率
 * @param startDate 开始日期，格式YYYY-MM-DD
 * @param endDate 结束日期，格式YYYY-MM-DD
 * @param term 期限，可选值：'oneYear'或'fiveYear'
 * @returns 平均LPR利率
 */
export function calculateAverageLPR(startDate: string, endDate: string, term: 'oneYear' | 'fiveYear' = 'oneYear'): number {
    const start = new Date(startDate)
    const end = new Date(endDate)

    // 筛选日期范围内的LPR记录
    const filteredRates = getLPRRates().filter(item => {
        const itemDate = new Date(item.date)
        return itemDate >= start && itemDate <= end
    })

    // 如果没有找到记录，返回0
    if (filteredRates.length === 0) {
        return 0
    }

    // 计算平均值
    const sum = filteredRates.reduce((acc, item) => acc + item[term], 0)
    return sum / filteredRates.length
}

/**
 * 获取最新的LPR利率
 * @returns 最新的LPR利率数据
 */
export function getLatestLPR(): LPRRate {
    return getLPRRates()[0]!
}

/**
 * 获取最新的存款基准利率
 * @returns 最新的存款基准利率数据
 */
export function getLatestDepositRate(): DepositRate {
    return getDepositRates()[0]!
}

/**
 * 获取最新的贷款基准利率
 * @returns 最新的贷款基准利率数据
 */
export function getLatestLoanRate(): LoanRate {
    return getLoanRates()[0]!
}
