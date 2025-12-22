/**
 * 赔偿金计算服务
 */

import type {
    WorkInjuryCompensationResult,
    TrafficAccidentCompensationResult,
    DeathCompensationResult
} from '#shared/types/tools'

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
