/**
 * 迟延履行利息计算服务
 */

import type { DelayInterestResult, InterestDetail } from '#shared/types/tools'
import { daysBetween, formatDate } from './utils/date'
import { logger } from '#shared/utils/logger'
import { getInterestRates } from './interestService'

/**
 * 计算迟延履行利息
 * @param amount 本金
 * @param startDate 开始日期
 * @param endDate 结束日期
 * @param rate 利率 (%)，仅用于自定义利率模式，其他模式从内置数据获取
 * @returns 迟延履行利息计算结果
 */
export function calculateDelayInterest(
    amount: number | string,
    startDate: string,
    endDate: string,
    rate?: number | string
): DelayInterestResult {
    logger.debug('迟延履行利息计算开始', { amount, startDate, endDate, rate })

    const principal = parseFloat(String(amount))
    const start = new Date(startDate)
    const end = new Date(endDate)

    // 计算总天数差
    const days = daysBetween(startDate, endDate)

    // 利率转换政策分界点: 2019年8月20日
    const policyChangeDate = new Date('2019-08-20')

    // 默认使用365天作为年计息天数
    const yearDays = 365

    // 准备结果
    let totalInterest = 0
    let details: string[] = []
    let interestDetails: InterestDetail[] = []

    // 检查开始日期和结束日期跨越不同利率段的情况
    if (start < policyChangeDate && end > policyChangeDate) {
        // 1. 跨越政策变更日期的情况 - 需分为两大段计算
        logger.debug('跨越政策变更日期的计算')

        // 前段计算 - 使用央行基准利率的1.5倍(2019年8月20日前)
        const periodsBefore = calculateBeforePolicyPeriods(principal, startDate, '2019-08-20', yearDays)
        totalInterest += periodsBefore.totalInterest
        details = details.concat(periodsBefore.details)
        interestDetails = interestDetails.concat(periodsBefore.interestDetails)

        // 后段计算 - 使用LPR的4倍(2019年8月20日后)
        const periodsAfter = calculateAfterPolicyPeriods(principal, '2019-08-20', endDate, yearDays)
        totalInterest += periodsAfter.totalInterest
        details = details.concat(periodsAfter.details)
        interestDetails = interestDetails.concat(periodsAfter.interestDetails)

        // 添加跨段说明
        details.unshift(`本金：${principal}元`)
        details.unshift(`迟延履行期间：${startDate} 至 ${endDate}，共${days}天`)
        details.unshift(`跨越2019年8月20日法律变更时点，需分段计算`)

    } else if (start >= policyChangeDate) {
        // 2. 完全在2019年8月20日后的情况 - 使用LPR的4倍
        logger.debug('完全在政策变更日期后的计算')

        const periodsAfter = calculateAfterPolicyPeriods(principal, startDate, endDate, yearDays)
        totalInterest = periodsAfter.totalInterest
        details = periodsAfter.details
        interestDetails = periodsAfter.interestDetails

        // 添加基本说明
        details.unshift(`本金：${principal}元`)
        details.unshift(`迟延履行期间：${startDate} 至 ${endDate}，共${days}天`)
        details.unshift(`适用2019年8月20日后标准：一年期贷款市场报价利率(LPR)的四倍`)

    } else {
        // 3. 完全在2019年8月20日前的情况 - 使用央行基准利率的1.5倍
        logger.debug('完全在政策变更日期前的计算')

        const periodsBefore = calculateBeforePolicyPeriods(principal, startDate, endDate, yearDays)
        totalInterest = periodsBefore.totalInterest
        details = periodsBefore.details
        interestDetails = periodsBefore.interestDetails

        // 添加基本说明
        details.unshift(`本金：${principal}元`)
        details.unshift(`迟延履行期间：${startDate} 至 ${endDate}，共${days}天`)
        details.unshift(`适用2019年8月20日前标准：中国人民银行同期同类贷款基准利率的1.5倍`)
    }

    // 四舍五入总利息，保留两位小数
    const roundedInterest = Math.round(totalInterest * 100) / 100

    logger.debug('迟延履行利息计算结果', {
        totalInterest: roundedInterest,
        totalDetails: interestDetails.length,
        firstDetail: interestDetails[0],
        lastDetail: interestDetails[interestDetails.length - 1]
    })

    return {
        amount: principal,
        startDate,
        endDate,
        days,
        totalInterest: roundedInterest,
        total: principal + roundedInterest,
        details,
        interestDetails
    }
}


interface PeriodCalculationResult {
    totalInterest: number
    details: string[]
    interestDetails: InterestDetail[]
}

/**
 * 计算2019年8月20日前的迟延履行利息（基准利率的1.5倍）
 * @param principal 本金
 * @param startDate 开始日期
 * @param endDate 结束日期
 * @param yearDays 年计息天数
 * @returns 计算结果
 */
function calculateBeforePolicyPeriods(
    principal: number,
    startDate: string,
    endDate: string,
    yearDays: number
): PeriodCalculationResult {
    const start = new Date(startDate)
    const end = new Date(endDate)

    logger.debug('计算2019年8月20日前的迟延履行利息', { principal, startDate, endDate })

    // 获取所有六个月至一年的基准利率并按日期排序
    const allRates = [...getInterestRates(1, 2)].sort((a, b) => new Date(a.sTime).getTime() - new Date(b.sTime).getTime())

    const interestDetails: InterestDetail[] = []
    const details: string[] = []
    let totalInterest = 0

    // 如果没有基准利率数据，使用默认值4.35%
    if (allRates.length === 0) {
        logger.error('没有找到基准利率数据，使用默认值4.35%')
        const days = daysBetween(startDate, endDate)
        const baseRate = 4.35
        const delayRate = baseRate * 1.5
        const interest = principal * delayRate / 100 / yearDays * days
        const roundedInterest = Math.round(interest * 100) / 100

        details.push(`基准利率：${baseRate}%，迟延履行利率：${delayRate.toFixed(2)}%`)
        details.push(`计算公式：${principal} × ${delayRate.toFixed(2)}% ÷ 100 ÷ ${yearDays} × ${days} = ${roundedInterest.toFixed(2)}元`)

        interestDetails.push({
            startDate: startDate,
            endDate: endDate,
            days: days,
            rate: baseRate,
            adjustedRate: delayRate,
            interest: roundedInterest
        })

        return { totalInterest: roundedInterest, details, interestDetails }
    }

    // 找出开始日期适用的利率索引
    let currentRateIndex = 0
    while (currentRateIndex < allRates.length - 1) {
        const nextRate = allRates[currentRateIndex + 1]
        if (nextRate && new Date(nextRate.sTime) <= start) {
            currentRateIndex++
        } else {
            break
        }
    }

    // 遍历每个利率段
    let segmentStart = new Date(startDate)
    while (segmentStart < end) {
        let segmentEnd: Date
        const currentRateData = allRates[currentRateIndex]
        if (!currentRateData) break
        const currentRate = currentRateData.rate

        // 确定当前段的结束日期
        const nextRateData = allRates[currentRateIndex + 1]
        if (currentRateIndex < allRates.length - 1 && nextRateData &&
            new Date(nextRateData.sTime) < end) {
            segmentEnd = new Date(nextRateData.sTime)
            currentRateIndex++
        } else {
            segmentEnd = new Date(endDate)
        }

        // 迟延履行利率为基准利率的1.5倍
        const delayRate = currentRate * 1.5

        // 计算该段的天数和利息
        const segmentDays = daysBetween(formatDate(segmentStart), formatDate(segmentEnd))
        const segmentInterest = principal * delayRate / 100 / yearDays * segmentDays
        const roundedSegmentInterest = Math.round(segmentInterest * 100) / 100

        // 记录计算明细
        interestDetails.push({
            startDate: formatDate(segmentStart),
            endDate: formatDate(segmentEnd),
            days: segmentDays,
            rate: currentRate,
            adjustedRate: delayRate,
            interest: roundedSegmentInterest
        })

        // 汇总利息
        totalInterest += roundedSegmentInterest

        // 更新下一段的开始日期
        segmentStart = segmentEnd
    }

    // 添加明细说明
    details.push(`- 基准利率标准：中国人民银行同期同类贷款基准利率(六个月至一年)的1.5倍`)
    interestDetails.forEach(detail => {
        details.push(`   ${detail.startDate} 至 ${detail.endDate}，${detail.days}天，基准利率${detail.rate}%，迟延履行利率${detail.adjustedRate!.toFixed(2)}%，利息${detail.interest.toFixed(2)}元`)
    })

    return { totalInterest, details, interestDetails }
}

/**
 * 计算2019年8月20日后的迟延履行利息（LPR的4倍）
 * @param principal 本金
 * @param startDate 开始日期
 * @param endDate 结束日期
 * @param yearDays 年计息天数
 * @returns 计算结果
 */
function calculateAfterPolicyPeriods(
    principal: number,
    startDate: string,
    endDate: string,
    yearDays: number
): PeriodCalculationResult {
    const start = new Date(startDate)
    const end = new Date(endDate)

    logger.debug('计算2019年8月20日后的迟延履行利息', { principal, startDate, endDate })

    // 获取所有一年期LPR并按日期排序
    const allRates = [...getInterestRates(2, 1)].sort((a, b) => new Date(a.sTime).getTime() - new Date(b.sTime).getTime())

    const interestDetails: InterestDetail[] = []
    const details: string[] = []
    let totalInterest = 0

    // 如果没有LPR数据，使用默认值3.85%
    if (allRates.length === 0) {
        logger.error('没有找到LPR数据，使用默认值3.85%')
        const days = daysBetween(startDate, endDate)
        const lprRate = 3.85
        const delayRate = lprRate * 4
        const interest = principal * delayRate / 100 / yearDays * days
        const roundedInterest = Math.round(interest * 100) / 100

        details.push(`LPR利率：${lprRate}%，迟延履行利率：${delayRate.toFixed(2)}%`)
        details.push(`计算公式：${principal} × ${delayRate.toFixed(2)}% ÷ 100 ÷ ${yearDays} × ${days} = ${roundedInterest.toFixed(2)}元`)

        interestDetails.push({
            startDate: startDate,
            endDate: endDate,
            days: days,
            rate: lprRate,
            adjustedRate: delayRate,
            interest: roundedInterest
        })

        return { totalInterest: roundedInterest, details, interestDetails }
    }

    // 找出开始日期适用的利率索引
    let currentRateIndex = 0
    while (currentRateIndex < allRates.length - 1) {
        const nextRate = allRates[currentRateIndex + 1]
        if (nextRate && new Date(nextRate.sTime) <= start) {
            currentRateIndex++
        } else {
            break
        }
    }

    // 遍历每个利率段
    let segmentStart = new Date(startDate)
    while (segmentStart < end) {
        let segmentEnd: Date
        const currentRateData = allRates[currentRateIndex]
        if (!currentRateData) break
        const currentRate = currentRateData.rate

        // 确定当前段的结束日期
        const nextRateData = allRates[currentRateIndex + 1]
        if (currentRateIndex < allRates.length - 1 && nextRateData &&
            new Date(nextRateData.sTime) < end) {
            segmentEnd = new Date(nextRateData.sTime)
            currentRateIndex++
        } else {
            segmentEnd = new Date(endDate)
        }

        // 迟延履行利率为LPR的4倍
        const delayRate = currentRate * 4

        // 计算该段的天数和利息
        const segmentDays = daysBetween(formatDate(segmentStart), formatDate(segmentEnd))
        const segmentInterest = principal * delayRate / 100 / yearDays * segmentDays
        const roundedSegmentInterest = Math.round(segmentInterest * 100) / 100

        // 记录计算明细
        interestDetails.push({
            startDate: formatDate(segmentStart),
            endDate: formatDate(segmentEnd),
            days: segmentDays,
            rate: currentRate,
            adjustedRate: delayRate,
            interest: roundedSegmentInterest
        })

        // 汇总利息
        totalInterest += roundedSegmentInterest

        // 更新下一段的开始日期
        segmentStart = segmentEnd
    }

    // 添加明细说明
    details.push(`- LPR标准：全国银行间同业拆借中心公布的一年期贷款市场报价利率(LPR)的四倍`)
    interestDetails.forEach(detail => {
        details.push(`   ${detail.startDate} 至 ${detail.endDate}，${detail.days}天，LPR利率${detail.rate}%，迟延履行利率${detail.adjustedRate!.toFixed(2)}%，利息${detail.interest.toFixed(2)}元`)
    })

    return { totalInterest, details, interestDetails }
}
