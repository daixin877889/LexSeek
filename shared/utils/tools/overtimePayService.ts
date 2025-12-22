/**
 * 加班费和调休时间计算服务
 */

import type { OvertimePayResult, CompensatoryTimeResult } from '@/types/tools'

/**
 * 计算加班费
 * @param baseSalary 月基本工资
 * @param workdayOvertimeHours 工作日加班时间（小时）
 * @param weekendOvertimeHours 休息日加班时间（小时）
 * @param holidayOvertimeHours 法定节假日加班时间（小时）
 * @param workdaysPerMonth 月工作日天数，默认21.75天
 * @param hoursPerDay 每天工作时间，默认8小时
 * @returns 包含计算结果的对象
 */
export function calculateOvertimePay(
    baseSalary: number,
    workdayOvertimeHours: number,
    weekendOvertimeHours: number,
    holidayOvertimeHours: number,
    workdaysPerMonth: number = 21.75,
    hoursPerDay: number = 8
): OvertimePayResult {
    // 计算小时工资
    const hourlyRate = baseSalary / (workdaysPerMonth * hoursPerDay)
    const hourlyRateFormatted = hourlyRate.toFixed(2)

    // 计算各类加班费
    const workdayOvertimePay = hourlyRate * 1.5 * workdayOvertimeHours
    const weekendOvertimePay = hourlyRate * 2 * weekendOvertimeHours
    const holidayOvertimePay = hourlyRate * 3 * holidayOvertimeHours

    // 计算总加班费
    const totalOvertimePay = workdayOvertimePay + weekendOvertimePay + holidayOvertimePay

    // 生成计算明细
    const details: string[] = []
    details.push(`小时工资：${baseSalary} ÷ (${workdaysPerMonth} × ${hoursPerDay}) = ${hourlyRateFormatted} 元/小时`)

    if (workdayOvertimeHours > 0) {
        details.push(`工作日加班费：${hourlyRateFormatted} × 1.5 × ${workdayOvertimeHours} = ${workdayOvertimePay.toFixed(2)} 元`)
    }

    if (weekendOvertimeHours > 0) {
        details.push(`休息日加班费：${hourlyRateFormatted} × 2 × ${weekendOvertimeHours} = ${weekendOvertimePay.toFixed(2)} 元`)
    }

    if (holidayOvertimeHours > 0) {
        details.push(`法定节假日加班费：${hourlyRateFormatted} × 3 × ${holidayOvertimeHours} = ${holidayOvertimePay.toFixed(2)} 元`)
    }

    details.push(`总加班费：${workdayOvertimePay.toFixed(2)} + ${weekendOvertimePay.toFixed(2)} + ${holidayOvertimePay.toFixed(2)} = ${totalOvertimePay.toFixed(2)} 元`)

    return {
        hourlyRate: hourlyRateFormatted,
        workdayOvertimePay: workdayOvertimePay.toFixed(2),
        weekendOvertimePay: weekendOvertimePay.toFixed(2),
        holidayOvertimePay: holidayOvertimePay.toFixed(2),
        totalOvertimePay: totalOvertimePay.toFixed(2),
        details
    }
}

/**
 * 计算调休时间
 * @param workdayOvertimeHours 工作日加班时间（小时）
 * @param weekendOvertimeHours 休息日加班时间（小时）
 * @param holidayOvertimeHours 法定节假日加班时间（小时）
 * @param hoursPerDay 每天工作时间，默认8小时
 * @returns 包含计算结果的对象
 */
export function calculateCompensatoryTime(
    workdayOvertimeHours: number,
    weekendOvertimeHours: number,
    holidayOvertimeHours: number,
    hoursPerDay: number = 8
): CompensatoryTimeResult {
    // 工作日加班按1:1计算
    const workdayCompensatoryHours = workdayOvertimeHours

    // 休息日加班按1:1计算
    const weekendCompensatoryHours = weekendOvertimeHours

    // 法定节假日加班按1:3计算
    const holidayCompensatoryHours = holidayOvertimeHours * 3

    // 计算总调休时间
    const totalCompensatoryHours = workdayCompensatoryHours + weekendCompensatoryHours + holidayCompensatoryHours

    // 计算总调休天数
    const totalCompensatoryDays = (totalCompensatoryHours / hoursPerDay).toFixed(1)

    // 生成计算明细
    const details: string[] = []

    if (workdayOvertimeHours > 0) {
        details.push(`工作日加班调休：${workdayOvertimeHours} × 1 = ${workdayCompensatoryHours} 小时`)
    }

    if (weekendOvertimeHours > 0) {
        details.push(`休息日加班调休：${weekendOvertimeHours} × 1 = ${weekendCompensatoryHours} 小时`)
    }

    if (holidayOvertimeHours > 0) {
        details.push(`法定节假日加班调休：${holidayOvertimeHours} × 3 = ${holidayCompensatoryHours} 小时`)
    }

    details.push(`总调休时间：${workdayCompensatoryHours} + ${weekendCompensatoryHours} + ${holidayCompensatoryHours} = ${totalCompensatoryHours} 小时`)
    details.push(`总调休天数：${totalCompensatoryHours} ÷ ${hoursPerDay} = ${totalCompensatoryDays} 天`)

    return {
        workdayCompensatoryHours,
        weekendCompensatoryHours,
        holidayCompensatoryHours,
        totalCompensatoryHours,
        totalCompensatoryDays,
        details
    }
}
