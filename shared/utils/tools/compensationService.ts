/**
 * 赔偿金计算服务
 */

import type {
    WorkInjuryCompensationResult,
    TrafficAccidentCompensationResult,
    DeathCompensationResult,
    SeveranceCompensationResult,
    SeveranceSubType,
} from '#shared/types/tools'

/**
 * 计算经济补偿金（N、N+1）/ 经济赔偿金（2N）
 *
 * 适用：劳动合同解除场景。
 * - subType=compensation：经济补偿金 N（每满 1 年补 1 月工资，不满 6 月按 0.5 年，满 6 月不满 1 年按 1 年；上限 12 年）
 *   - 第四十条情形（isArticle40=true）：N + lastMonthWage（即 N+1）
 * - subType=damages：经济赔偿金 2N（不满 1 年按 1 年；上限 12 年）
 * - 月工资超社平 3 倍：effective = min(wage, socialAverageWage * 3)
 *
 * @param subType 'compensation'（N/N+1）或 'damages'（2N）
 * @param monthlyWage 离职前 12 个月平均工资（元）
 * @param startDate 入职日期 YYYY-MM-DD
 * @param endDate 离职日期 YYYY-MM-DD
 * @param isWageExceed 月工资是否超社平 3 倍
 * @param socialAverageWage 当地社会平均工资（isWageExceed=true 时必填）
 * @param isArticle40 是否第四十条情形（仅 subType=compensation 时有效）
 * @param lastMonthWage 离职前最后一个月工资（isArticle40=true 时必填）
 */
export function calculateSeveranceCompensation(
    subType: SeveranceSubType,
    monthlyWage: number,
    startDate: string,
    endDate: string,
    isWageExceed: boolean = false,
    socialAverageWage: number = 0,
    isArticle40: boolean = false,
    lastMonthWage: number = 0,
): SeveranceCompensationResult {
    const start = new Date(startDate)
    const end = new Date(endDate)
    if (end < start) {
        throw new Error('离职日期不能早于入职日期')
    }

    // 计算工作时长（年/月/日）
    let years = end.getFullYear() - start.getFullYear()
    let months = end.getMonth() - start.getMonth()
    let days = end.getDate() - start.getDate()
    if (days < 0) {
        months--
        const lastDayOfPrevMonth = new Date(end.getFullYear(), end.getMonth(), 0).getDate()
        days += lastDayOfPrevMonth
    }
    if (months < 0) {
        years--
        months += 12
    }

    // 计算补偿年限（按 subType 区分规则；上限 12 年）
    const totalMonthCount = years * 12 + months + (days > 0 ? 1 : 0)
    let calculatedYears: number
    if (subType === 'compensation') {
        // 经济补偿金：每满一年补一月，不满 6 月按 0.5 年，满 6 月不满 1 年按 1 年
        if (totalMonthCount % 12 === 0) {
            calculatedYears = totalMonthCount / 12
        } else if (totalMonthCount % 12 < 6) {
            calculatedYears = Math.floor(totalMonthCount / 12) + 0.5
        } else {
            calculatedYears = Math.ceil(totalMonthCount / 12)
        }
    } else {
        // 经济赔偿金：不满一年按一年
        calculatedYears = Math.ceil(totalMonthCount / 12)
    }
    calculatedYears = Math.min(calculatedYears, 12)

    // 实际月工资（超社平 3 倍则封顶）
    let effectiveMonthlyWage: number
    let isAboveLimit = false
    if (isWageExceed && socialAverageWage > 0) {
        const maxWage = socialAverageWage * 3
        isAboveLimit = monthlyWage > maxWage
        effectiveMonthlyWage = Math.min(monthlyWage, maxWage)
    } else {
        effectiveMonthlyWage = monthlyWage
    }

    // 基础金额 = 实际月工资 × 计算年限
    const baseAmount = effectiveMonthlyWage * calculatedYears

    // 最终金额
    let article40Extra = 0
    let totalCompensation: number
    if (subType === 'compensation') {
        if (isArticle40 && lastMonthWage > 0) {
            article40Extra = lastMonthWage
            totalCompensation = baseAmount + lastMonthWage
        } else {
            totalCompensation = baseAmount
        }
    } else {
        totalCompensation = baseAmount * 2
    }

    totalCompensation = Number(totalCompensation.toFixed(2))

    const details: string[] = [
        `${subType === 'compensation' ? '经济补偿金' : '经济赔偿金'}计算：`,
        `- 工作时长：${years} 年 ${months} 个月 ${days} 天`,
        `- 计算年限：${calculatedYears} 年（上限 12 年）`,
        `- 月工资（${isWageExceed ? '超社平 3 倍封顶后' : '原始'}）：${effectiveMonthlyWage.toFixed(2)} 元`,
    ]
    if (isAboveLimit) {
        details.push(`- 已封顶（社平工资 ${socialAverageWage} × 3 = ${(socialAverageWage * 3).toFixed(2)} 元）`)
    }
    details.push(`- 基础金额：${effectiveMonthlyWage.toFixed(2)} × ${calculatedYears} = ${baseAmount.toFixed(2)} 元`)
    if (subType === 'compensation' && isArticle40 && lastMonthWage > 0) {
        details.push(`- 第四十条额外补偿（N+1）：${lastMonthWage.toFixed(2)} 元`)
    } else if (subType === 'damages') {
        details.push(`- 赔偿金系数：2 倍`)
    }
    details.push(`- 最终金额：${totalCompensation.toFixed(2)} 元`)

    return {
        subType,
        totalYears: years,
        totalMonths: months,
        totalDays: days,
        calculatedYears,
        effectiveMonthlyWage,
        isAboveLimit,
        baseAmount,
        article40Extra,
        totalCompensation,
        details,
    }
}

// 伤残赔偿系数
const disabilityCoefficients: Record<number, number> = {
    1: 27, // 一级伤残
    2: 25, // 二级伤残
    3: 23, // 三级伤残
    4: 21, // 四级伤残
    5: 18, // 五级伤残
    6: 16, // 六级伤残
    7: 13, // 七级伤残
    8: 11, // 八级伤残
    9: 9,  // 九级伤残
    10: 7  // 十级伤残
}

/**
 * 计算工伤赔偿金
 * @param salary 月工资
 * @param disabilityLevel 伤残等级（1-10）
 * @param medicalExpenses 医疗费用
 * @param nursingExpenses 护理费用
 * @param nutritionExpenses 营养费用
 * @returns 工伤赔偿金计算结果
 */
export function calculateWorkInjuryCompensation(
    salary: number,
    disabilityLevel: number,
    medicalExpenses: number = 0,
    nursingExpenses: number = 0,
    nutritionExpenses: number = 0
): WorkInjuryCompensationResult {
    // 获取伤残赔偿系数
    const coefficient = disabilityCoefficients[disabilityLevel] || 0

    // 计算伤残赔偿金
    const disabilityCompensation = salary * coefficient

    // 计算总赔偿金
    const totalCompensation = disabilityCompensation + medicalExpenses + nursingExpenses + nutritionExpenses

    return {
        disabilityCompensation,
        medicalExpenses,
        nursingExpenses,
        nutritionExpenses,
        totalCompensation,
        details: [
            `月工资：${salary}元`,
            `伤残等级：${disabilityLevel}级`,
            `伤残赔偿金：${salary}元/月 × ${coefficient}个月 = ${disabilityCompensation}元`,
            `医疗费用：${medicalExpenses}元`,
            `护理费用：${nursingExpenses}元`,
            `营养费用：${nutritionExpenses}元`,
            `总赔偿金：${disabilityCompensation}元 + ${medicalExpenses}元 + ${nursingExpenses}元 + ${nutritionExpenses}元 = ${totalCompensation}元`
        ]
    }
}

/**
 * 计算交通事故赔偿金
 * @param medicalExpenses 医疗费用
 * @param disabilityCompensation 残疾赔偿金
 * @param nursingExpenses 护理费用
 * @param lostIncome 误工费
 * @param nutritionExpenses 营养费用
 * @param transportationExpenses 交通费用
 * @param accommodationExpenses 住宿费用
 * @param propertyLoss 财产损失
 * @returns 交通事故赔偿金计算结果
 */
export function calculateTrafficAccidentCompensation(
    medicalExpenses: number = 0,
    disabilityCompensation: number = 0,
    nursingExpenses: number = 0,
    lostIncome: number = 0,
    nutritionExpenses: number = 0,
    transportationExpenses: number = 0,
    accommodationExpenses: number = 0,
    propertyLoss: number = 0
): TrafficAccidentCompensationResult {
    // 计算总赔偿金
    const totalCompensation =
        medicalExpenses +
        disabilityCompensation +
        nursingExpenses +
        lostIncome +
        nutritionExpenses +
        transportationExpenses +
        accommodationExpenses +
        propertyLoss

    return {
        medicalExpenses,
        disabilityCompensation,
        nursingExpenses,
        lostIncome,
        nutritionExpenses,
        transportationExpenses,
        accommodationExpenses,
        propertyLoss,
        totalCompensation,
        details: [
            `医疗费用：${medicalExpenses}元`,
            `残疾赔偿金：${disabilityCompensation}元`,
            `护理费用：${nursingExpenses}元`,
            `误工费：${lostIncome}元`,
            `营养费用：${nutritionExpenses}元`,
            `交通费用：${transportationExpenses}元`,
            `住宿费用：${accommodationExpenses}元`,
            `财产损失：${propertyLoss}元`,
            `总赔偿金：${totalCompensation}元`
        ]
    }
}

/**
 * 计算死亡赔偿金
 * @param annualIncome 年收入
 * @param years 赔偿年限
 * @param funeralExpenses 丧葬费
 * @param dependentCompensation 被抚养人生活费
 * @param emotionalDamages 精神损害抚慰金
 * @returns 死亡赔偿金计算结果
 */
export function calculateDeathCompensation(
    annualIncome: number,
    years: number = 20,
    funeralExpenses: number = 0,
    dependentCompensation: number = 0,
    emotionalDamages: number = 0
): DeathCompensationResult {
    // 计算死亡赔偿金
    const deathCompensation = annualIncome * years

    // 计算总赔偿金
    const totalCompensation = deathCompensation + funeralExpenses + dependentCompensation + emotionalDamages

    return {
        deathCompensation,
        funeralExpenses,
        dependentCompensation,
        emotionalDamages,
        totalCompensation,
        details: [
            `年收入：${annualIncome}元`,
            `赔偿年限：${years}年`,
            `死亡赔偿金：${annualIncome}元/年 × ${years}年 = ${deathCompensation}元`,
            `丧葬费：${funeralExpenses}元`,
            `被抚养人生活费：${dependentCompensation}元`,
            `精神损害抚慰金：${emotionalDamages}元`,
            `总赔偿金：${deathCompensation}元 + ${funeralExpenses}元 + ${dependentCompensation}元 + ${emotionalDamages}元 = ${totalCompensation}元`
        ]
    }
}
