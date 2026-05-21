/**
 * 加班费和调休时间计算服务
 */

import type { OvertimePayResult, CompensatoryTimeResult } from '#shared/types/tools'
import { OVERTIME_RATES, COMPENSATORY_RATES } from './data/overtimeRules'

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

    // 计算各类加班费（倍率引用 data 层常量）
    const workdayOvertimePay = hourlyRate * OVERTIME_RATES.workday * workdayOvertimeHours
    const weekendOvertimePay = hourlyRate * OVERTIME_RATES.weekend * weekendOvertimeHours
    const holidayOvertimePay = hourlyRate * OVERTIME_RATES.holiday * holidayOvertimeHours

    // 计算总加班费
    const totalOvertimePay = workdayOvertimePay + weekendOvertimePay + holidayOvertimePay

    // 生成计算明细
    const details: string[] = []
    details.push(`小时工资：${baseSalary} ÷ (${workdaysPerMonth} × ${hoursPerDay}) = ${hourlyRateFormatted} 元/小时`)

    if (workdayOvertimeHours > 0) {
        details.push(`工作日加班费：${hourlyRateFormatted} × ${OVERTIME_RATES.workday} × ${workdayOvertimeHours} = ${workdayOvertimePay.toFixed(2)} 元`)
    }

    if (weekendOvertimeHours > 0) {
        details.push(`休息日加班费：${hourlyRateFormatted} × ${OVERTIME_RATES.weekend} × ${weekendOvertimeHours} = ${weekendOvertimePay.toFixed(2)} 元`)
    }

    if (holidayOvertimeHours > 0) {
        details.push(`法定节假日加班费：${hourlyRateFormatted} × ${OVERTIME_RATES.holiday} × ${holidayOvertimeHours} = ${holidayOvertimePay.toFixed(2)} 元`)
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
    // 调休时间（倍率引用 data 层常量）
    const workdayCompensatoryHours = workdayOvertimeHours * COMPENSATORY_RATES.workday
    const weekendCompensatoryHours = weekendOvertimeHours * COMPENSATORY_RATES.weekend
    const holidayCompensatoryHours = holidayOvertimeHours * COMPENSATORY_RATES.holiday

    // 计算总调休时间
    const totalCompensatoryHours = workdayCompensatoryHours + weekendCompensatoryHours + holidayCompensatoryHours

    // 计算总调休天数
    const totalCompensatoryDays = (totalCompensatoryHours / hoursPerDay).toFixed(1)

    // 生成计算明细
    const details: string[] = []

    if (workdayOvertimeHours > 0) {
        details.push(`工作日加班调休：${workdayOvertimeHours} × ${COMPENSATORY_RATES.workday} = ${workdayCompensatoryHours} 小时`)
    }

    if (weekendOvertimeHours > 0) {
        details.push(`休息日加班调休：${weekendOvertimeHours} × ${COMPENSATORY_RATES.weekend} = ${weekendCompensatoryHours} 小时`)
    }

    if (holidayOvertimeHours > 0) {
        details.push(`法定节假日加班调休：${holidayOvertimeHours} × ${COMPENSATORY_RATES.holiday} = ${holidayCompensatoryHours} 小时`)
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
