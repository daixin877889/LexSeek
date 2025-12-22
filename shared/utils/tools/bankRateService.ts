/**
 * 银行利率查询服务
 */

import type { LPRRate, DepositRate, LoanRate } from '@/types/tools'

// 银行利率数据
const bankRates: {
    lpr: LPRRate[]
    benchmark: DepositRate[]
    loan: LoanRate[]
} = {
    // LPR利率
    lpr: [
        { date: '2025-07-21', oneYear: 3.00, fiveYear: 3.50 },
        { date: '2025-06-20', oneYear: 3.00, fiveYear: 3.50 },
        { date: '2025-05-20', oneYear: 3.00, fiveYear: 3.50 },
        { date: '2025-04-20', oneYear: 3.10, fiveYear: 3.60 },
        { date: '2025-03-20', oneYear: 3.10, fiveYear: 3.60 },
        { date: '2025-02-20', oneYear: 3.10, fiveYear: 3.60 },
        { date: '2025-01-20', oneYear: 3.10, fiveYear: 3.60 },
        { date: '2024-12-20', oneYear: 3.10, fiveYear: 3.60 },
        { date: '2024-11-20', oneYear: 3.10, fiveYear: 3.60 },
        { date: '2024-10-21', oneYear: 3.10, fiveYear: 3.60 },
        { date: '2024-09-20', oneYear: 3.35, fiveYear: 3.85 },
        { date: '2024-08-20', oneYear: 3.35, fiveYear: 3.85 },
        { date: '2024-07-22', oneYear: 3.35, fiveYear: 3.85 },
        { date: '2024-06-20', oneYear: 3.45, fiveYear: 3.95 },
        { date: '2024-05-20', oneYear: 3.45, fiveYear: 3.95 },
        { date: '2024-04-22', oneYear: 3.45, fiveYear: 3.95 },
        { date: '2024-03-20', oneYear: 3.45, fiveYear: 3.95 },
        { date: '2024-02-20', oneYear: 3.45, fiveYear: 3.95 },
        { date: '2024-01-22', oneYear: 3.45, fiveYear: 4.20 },
        { date: '2023-12-20', oneYear: 3.45, fiveYear: 4.20 },
        { date: '2023-11-20', oneYear: 3.45, fiveYear: 4.20 },
        { date: '2023-10-20', oneYear: 3.45, fiveYear: 4.20 },
        { date: '2023-09-20', oneYear: 3.45, fiveYear: 4.20 },
        { date: '2023-08-21', oneYear: 3.45, fiveYear: 4.20 },
        { date: '2023-07-20', oneYear: 3.55, fiveYear: 4.20 },
        { date: '2023-06-20', oneYear: 3.55, fiveYear: 4.20 },
        { date: '2023-05-22', oneYear: 3.65, fiveYear: 4.3 },
        { date: '2023-04-20', oneYear: 3.65, fiveYear: 4.3 },
        { date: '2023-03-20', oneYear: 3.65, fiveYear: 4.3 },
        { date: '2023-02-20', oneYear: 3.65, fiveYear: 4.3 },
        { date: '2023-01-20', oneYear: 3.65, fiveYear: 4.3 },
        { date: '2022-12-20', oneYear: 3.65, fiveYear: 4.3 },
        { date: '2022-11-21', oneYear: 3.65, fiveYear: 4.3 },
        { date: '2022-10-20', oneYear: 3.65, fiveYear: 4.3 },
        { date: '2022-09-20', oneYear: 3.65, fiveYear: 4.3 },
        { date: '2022-08-22', oneYear: 3.65, fiveYear: 4.3 },
        { date: '2022-07-20', oneYear: 3.70, fiveYear: 4.45 },
        { date: '2022-06-20', oneYear: 3.70, fiveYear: 4.45 },
        { date: '2022-05-20', oneYear: 3.70, fiveYear: 4.45 },
        { date: '2022-04-20', oneYear: 3.70, fiveYear: 4.60 },
        { date: '2022-03-21', oneYear: 3.70, fiveYear: 4.60 },
        { date: '2022-02-21', oneYear: 3.70, fiveYear: 4.60 },
        { date: '2022-01-20', oneYear: 3.7, fiveYear: 4.6 },
        { date: '2021-12-20', oneYear: 3.8, fiveYear: 4.65 },
        { date: '2021-11-22', oneYear: 3.85, fiveYear: 4.65 },
        { date: '2021-10-20', oneYear: 3.85, fiveYear: 4.65 },
        { date: '2021-09-22', oneYear: 3.85, fiveYear: 4.65 },
        { date: '2021-08-20', oneYear: 3.85, fiveYear: 4.65 },
        { date: '2021-07-20', oneYear: 3.85, fiveYear: 4.65 },
        { date: '2021-06-21', oneYear: 3.85, fiveYear: 4.65 },
        { date: '2021-05-20', oneYear: 3.85, fiveYear: 4.65 },
        { date: '2021-04-20', oneYear: 3.85, fiveYear: 4.65 },
        { date: '2021-03-22', oneYear: 3.85, fiveYear: 4.65 },
        { date: '2021-02-20', oneYear: 3.85, fiveYear: 4.65 },
        { date: '2021-01-20', oneYear: 3.85, fiveYear: 4.65 },
        { date: '2020-12-21', oneYear: 3.85, fiveYear: 4.65 },
        { date: '2020-11-20', oneYear: 3.85, fiveYear: 4.65 },
        { date: '2020-10-20', oneYear: 3.85, fiveYear: 4.65 },
        { date: '2020-09-21', oneYear: 3.85, fiveYear: 4.65 },
        { date: '2020-08-20', oneYear: 3.85, fiveYear: 4.65 },
        { date: '2020-07-20', oneYear: 3.85, fiveYear: 4.65 },
        { date: '2020-06-22', oneYear: 3.85, fiveYear: 4.65 },
        { date: '2020-05-20', oneYear: 3.85, fiveYear: 4.65 },
        { date: '2020-04-20', oneYear: 3.85, fiveYear: 4.65 },
        { date: '2020-03-20', oneYear: 4.05, fiveYear: 4.75 },
        { date: '2020-02-20', oneYear: 4.05, fiveYear: 4.75 },
        { date: '2020-01-20', oneYear: 4.15, fiveYear: 4.8 },
        { date: '2019-12-20', oneYear: 4.15, fiveYear: 4.8 },
        { date: '2019-11-20', oneYear: 4.15, fiveYear: 4.8 },
        { date: '2019-10-21', oneYear: 4.2, fiveYear: 4.85 },
        { date: '2019-09-20', oneYear: 4.2, fiveYear: 4.85 },
        { date: '2019-08-20', oneYear: 4.25, fiveYear: 4.85 }
    ],

    // 基准利率
    benchmark: [
        { date: '2015-10-24', demand: 0.35, threeMonths: 1.1, sixMonths: 1.3, oneYear: 1.5, twoYear: 2.1, threeYear: 2.75, fiveYear: 2.75 },
        { date: '2015-08-26', demand: 0.35, threeMonths: 1.35, sixMonths: 1.55, oneYear: 1.75, twoYear: 2.35, threeYear: 3, fiveYear: 3 },
        { date: '2015-06-28', demand: 0.35, threeMonths: 1.6, sixMonths: 1.8, oneYear: 2, twoYear: 2.6, threeYear: 3.25, fiveYear: 3.25 },
        { date: '2015-05-11', demand: 0.35, threeMonths: 1.85, sixMonths: 2.05, oneYear: 2.25, twoYear: 2.85, threeYear: 3.5, fiveYear: 3.5 },
        { date: '2015-03-01', demand: 0.35, threeMonths: 2.1, sixMonths: 2.3, oneYear: 2.5, twoYear: 3.1, threeYear: 3.75, fiveYear: 3.75 },
        { date: '2014-11-22', demand: 0.35, threeMonths: 2.35, sixMonths: 2.55, oneYear: 2.75, twoYear: 3.35, threeYear: 4, fiveYear: 4 },
        { date: '2012-07-06', demand: 0.35, threeMonths: 2.6, sixMonths: 2.8, oneYear: 3, twoYear: 3.75, threeYear: 4.25, fiveYear: 4.25 },
        { date: '2012-06-08', demand: 0.4, threeMonths: 2.85, sixMonths: 3.05, oneYear: 3.25, twoYear: 4, threeYear: 4.5, fiveYear: 4.5 },
        { date: '2011-07-07', demand: 0.5, threeMonths: 3.1, sixMonths: 3.3, oneYear: 3.5, twoYear: 4.4, threeYear: 4.9, fiveYear: 5.0 },
        { date: '2011-04-06', demand: 0.5, threeMonths: 2.85, sixMonths: 3.05, oneYear: 3.25, twoYear: 4.15, threeYear: 4.65, fiveYear: 4.75 }
    ],

    // 贷款基准利率
    loan: [
        { date: '2015-10-24', sixMonths: 4.35, oneYear: 4.35, oneToFiveYear: 4.75, fiveYear: 4.9 },
        { date: '2015-08-26', sixMonths: 4.6, oneYear: 4.6, oneToFiveYear: 5, fiveYear: 5.15 },
        { date: '2015-06-28', sixMonths: 4.85, oneYear: 4.85, oneToFiveYear: 5.25, fiveYear: 5.4 },
        { date: '2015-05-11', sixMonths: 5.1, oneYear: 5.1, oneToFiveYear: 5.5, fiveYear: 5.65 },
        { date: '2015-03-01', sixMonths: 5.35, oneYear: 5.35, oneToFiveYear: 5.75, fiveYear: 5.9 },
        { date: '2014-11-22', sixMonths: 5.6, oneYear: 5.6, oneToFiveYear: 6, fiveYear: 6.15 },
        { date: '2012-07-06', sixMonths: 5.85, oneYear: 6, oneToFiveYear: 6.15, fiveYear: 6.4 },
        { date: '2012-06-08', sixMonths: 6.1, oneYear: 6.31, oneToFiveYear: 6.4, fiveYear: 6.65 },
        { date: '2011-07-07', sixMonths: 6.56, oneYear: 6.65, oneToFiveYear: 6.9, fiveYear: 7.05 },
        { date: '2011-04-06', sixMonths: 6.31, oneYear: 6.4, oneToFiveYear: 6.65, fiveYear: 6.8 }
    ]
}

/**
 * 查询LPR利率
 * @param date 查询日期，格式YYYY-MM-DD
 * @returns LPR利率数据
 */
export function queryLPRRate(date?: string): LPRRate | null {
    // 如果没有指定日期，返回最新的LPR利率
    if (!date) {
        return bankRates.lpr[0]
    }

    // 将查询日期转换为时间戳
    const queryTimestamp = new Date(date).getTime()

    // 查找小于等于查询日期的最近一条记录
    for (let i = 0; i < bankRates.lpr.length; i++) {
        const rateTimestamp = new Date(bankRates.lpr[i].date).getTime()
        if (queryTimestamp >= rateTimestamp) {
            return bankRates.lpr[i]
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
    // 如果没有指定日期，返回最新的存款基准利率
    if (!date) {
        return bankRates.benchmark[0]
    }

    // 将查询日期转换为时间戳
    const queryTimestamp = new Date(date).getTime()

    // 查找小于等于查询日期的最近一条记录
    for (let i = 0; i < bankRates.benchmark.length; i++) {
        const rateTimestamp = new Date(bankRates.benchmark[i].date).getTime()
        if (queryTimestamp >= rateTimestamp) {
            return bankRates.benchmark[i]
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
    // 如果没有指定日期，返回最新的贷款基准利率
    if (!date) {
        return bankRates.loan[0]
    }

    // 将查询日期转换为时间戳
    const queryTimestamp = new Date(date).getTime()

    // 查找小于等于查询日期的最近一条记录
    for (let i = 0; i < bankRates.loan.length; i++) {
        const rateTimestamp = new Date(bankRates.loan[i].date).getTime()
        if (queryTimestamp >= rateTimestamp) {
            return bankRates.loan[i]
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
    return bankRates.lpr
}

/**
 * 获取所有存款基准利率历史记录
 * @returns 存款基准利率历史记录
 */
export function getDepositRateHistory(): DepositRate[] {
    return bankRates.benchmark
}

/**
 * 获取所有贷款基准利率历史记录
 * @returns 贷款基准利率历史记录
 */
export function getLoanRateHistory(): LoanRate[] {
    return bankRates.loan
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
    const filteredRates = bankRates.lpr.filter(item => {
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
    return bankRates.lpr[0]
}

/**
 * 获取最新的存款基准利率
 * @returns 最新的存款基准利率数据
 */
export function getLatestDepositRate(): DepositRate {
    return bankRates.benchmark[0]
}

/**
 * 获取最新的贷款基准利率
 * @returns 最新的贷款基准利率数据
 */
export function getLatestLoanRate(): LoanRate {
    return bankRates.loan[0]
}
