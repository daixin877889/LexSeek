/**
 * 社保追缴计算服务
 */

import type {
    SocialInsuranceRates,
    SocialInsuranceBackpayResult
} from '#shared/types/tools'

// 默认缴费比例
const defaultRates: Required<SocialInsuranceRates> = {
    pension: { employee: 0.08, employer: 0.16 },
    medical: { employee: 0.02, employer: 0.08 },
    unemployment: { employee: 0.005, employer: 0.015 },
    injury: { employee: 0, employer: 0.005 },
    maternity: { employee: 0, employer: 0.01 },
    housing: { employee: 0.07, employer: 0.07 }
}

/**
 * 计算社保追缴金额
 * @param monthlySalary 月工资
 * @param months 追缴月数
 * @param rates 缴费比例
 * @param includeEmployerPart 是否包含单位缴纳部分
 * @returns 社保追缴计算结果
 */
export function calculateSocialInsuranceBackpay(
    monthlySalary: number,
    months: number,
    rates: SocialInsuranceRates = {},
    includeEmployerPart: boolean = true
): SocialInsuranceBackpayResult {
    // 合并用户提供的比例和默认比例
    const mergedRates: Required<SocialInsuranceRates> = {
        pension: rates.pension || defaultRates.pension,
        medical: rates.medical || defaultRates.medical,
        unemployment: rates.unemployment || defaultRates.unemployment,
        injury: rates.injury || defaultRates.injury,
        maternity: rates.maternity || defaultRates.maternity,
        housing: rates.housing || defaultRates.housing
    }

    // 计算各项保险的个人缴纳部分
    const employeePension = monthlySalary * mergedRates.pension.employee * months
    const employeeMedical = monthlySalary * mergedRates.medical.employee * months
    const employeeUnemployment = monthlySalary * mergedRates.unemployment.employee * months
    const employeeInjury = monthlySalary * mergedRates.injury.employee * months
    const employeeMaternity = monthlySalary * mergedRates.maternity.employee * months
    const employeeHousing = monthlySalary * mergedRates.housing.employee * months

    // 计算各项保险的单位缴纳部分
    const employerPension = monthlySalary * mergedRates.pension.employer * months
    const employerMedical = monthlySalary * mergedRates.medical.employer * months
    const employerUnemployment = monthlySalary * mergedRates.unemployment.employer * months
    const employerInjury = monthlySalary * mergedRates.injury.employer * months
    const employerMaternity = monthlySalary * mergedRates.maternity.employer * months
    const employerHousing = monthlySalary * mergedRates.housing.employer * months

    // 计算个人缴纳总额
    const totalEmployeePart =
        employeePension +
        employeeMedical +
        employeeUnemployment +
        employeeInjury +
        employeeMaternity +
        employeeHousing

    // 计算单位缴纳总额
    const totalEmployerPart =
        employerPension +
        employerMedical +
        employerUnemployment +
        employerInjury +
        employerMaternity +
        employerHousing

    // 计算追缴总额
    const totalBackpay = includeEmployerPart ?
        totalEmployeePart + totalEmployerPart :
        totalEmployeePart

    // 生成详细信息
    const details: string[] = [
        `月工资：${monthlySalary}元`,
        `追缴月数：${months}个月`,
        '',
        '个人缴纳部分：',
        `- 养老保险：${monthlySalary}元 × ${(mergedRates.pension.employee * 100).toFixed(1)}% × ${months}个月 = ${employeePension.toFixed(2)}元`,
        `- 医疗保险：${monthlySalary}元 × ${(mergedRates.medical.employee * 100).toFixed(1)}% × ${months}个月 = ${employeeMedical.toFixed(2)}元`,
        `- 失业保险：${monthlySalary}元 × ${(mergedRates.unemployment.employee * 100).toFixed(1)}% × ${months}个月 = ${employeeUnemployment.toFixed(2)}元`,
        `- 工伤保险：${monthlySalary}元 × ${(mergedRates.injury.employee * 100).toFixed(1)}% × ${months}个月 = ${employeeInjury.toFixed(2)}元`,
        `- 生育保险：${monthlySalary}元 × ${(mergedRates.maternity.employee * 100).toFixed(1)}% × ${months}个月 = ${employeeMaternity.toFixed(2)}元`,
        `- 住房公积金：${monthlySalary}元 × ${(mergedRates.housing.employee * 100).toFixed(1)}% × ${months}个月 = ${employeeHousing.toFixed(2)}元`,
        `个人缴纳总额：${totalEmployeePart.toFixed(2)}元`
    ]

    if (includeEmployerPart) {
        details.push(
            '',
            '单位缴纳部分：',
            `- 养老保险：${monthlySalary}元 × ${(mergedRates.pension.employer * 100).toFixed(1)}% × ${months}个月 = ${employerPension.toFixed(2)}元`,
            `- 医疗保险：${monthlySalary}元 × ${(mergedRates.medical.employer * 100).toFixed(1)}% × ${months}个月 = ${employerMedical.toFixed(2)}元`,
            `- 失业保险：${monthlySalary}元 × ${(mergedRates.unemployment.employer * 100).toFixed(1)}% × ${months}个月 = ${employerUnemployment.toFixed(2)}元`,
            `- 工伤保险：${monthlySalary}元 × ${(mergedRates.injury.employer * 100).toFixed(1)}% × ${months}个月 = ${employerInjury.toFixed(2)}元`,
            `- 生育保险：${monthlySalary}元 × ${(mergedRates.maternity.employer * 100).toFixed(1)}% × ${months}个月 = ${employerMaternity.toFixed(2)}元`,
            `- 住房公积金：${monthlySalary}元 × ${(mergedRates.housing.employer * 100).toFixed(1)}% × ${months}个月 = ${employerHousing.toFixed(2)}元`,
            `单位缴纳总额：${totalEmployerPart.toFixed(2)}元`
        )
    }

    details.push('', `追缴总额：${totalBackpay.toFixed(2)}元`)

    return {
        employeePart: {
            pension: employeePension,
            medical: employeeMedical,
            unemployment: employeeUnemployment,
            injury: employeeInjury,
            maternity: employeeMaternity,
            housing: employeeHousing,
            total: totalEmployeePart
        },
        employerPart: {
            pension: employerPension,
            medical: employerMedical,
            unemployment: employerUnemployment,
            injury: employerInjury,
            maternity: employerMaternity,
            housing: employerHousing,
            total: totalEmployerPart
        },
        totalBackpay,
        details
    }
}
