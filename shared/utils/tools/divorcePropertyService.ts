/**
 * 离婚财产分割计算服务
 */

import type {
    DivorceAssets,
    DivorceDebts,
    DivorceOptions,
    DivorcePropertyResult,
    MaritalPropertyResult
} from '@/types/tools'

/**
 * 计算离婚财产分割
 * @param assets 共同财产
 * @param debts 共同债务
 * @param options 分割选项
 * @returns 财产分割计算结果
 */
export function calculateDivorceProperty(
    assets: DivorceAssets = {},
    debts: DivorceDebts = {},
    options: DivorceOptions = {}
): DivorcePropertyResult {
    // 提取资产
    const house = assets.house || 0
    const car = assets.car || 0
    const savings = assets.savings || 0
    const investments = assets.investments || 0
    const otherAssets = assets.other || 0

    // 提取债务
    const mortgage = debts.mortgage || 0
    const carLoan = debts.carLoan || 0
    const creditCard = debts.creditCard || 0
    const otherDebts = debts.other || 0

    // 提取选项
    const husbandRatio = options.husbandRatio || 0.5
    const wifeRatio = options.wifeRatio || 0.5
    const hasChildren = options.hasChildren || false
    const childCustody = options.childCustody || 'shared'

    // 计算总资产
    const totalAssets = house + car + savings + investments + otherAssets

    // 计算总债务
    const totalDebts = mortgage + carLoan + creditCard + otherDebts

    // 计算净资产
    const netAssets = totalAssets - totalDebts

    // 计算丈夫和妻子分得的净资产
    const husbandNetAssets = netAssets * husbandRatio
    const wifeNetAssets = netAssets * wifeRatio

    // 计算子女抚养费（简化计算，实际应根据具体情况确定）
    let childSupportAmount = 0
    let childSupportPayer = ''
    let childSupportReceiver = ''

    if (hasChildren) {
        // 假设子女抚养费为净资产的10%
        childSupportAmount = netAssets * 0.1

        if (childCustody === 'husband') {
            childSupportPayer = '妻子'
            childSupportReceiver = '丈夫'
        } else if (childCustody === 'wife') {
            childSupportPayer = '丈夫'
            childSupportReceiver = '妻子'
        } else {
            // 共同抚养的情况，抚养费可能会根据收入比例分担
            childSupportAmount = 0
        }
    }

    // 生成详细信息
    const details: string[] = [
        '共同财产清单：',
        `- 房产：${house}元`,
        `- 车辆：${car}元`,
        `- 存款：${savings}元`,
        `- 投资理财：${investments}元`,
        `- 其他财产：${otherAssets}元`,
        `共同财产总价值：${totalAssets}元`,
        '',
        '共同债务清单：',
        `- 房贷余额：${mortgage}元`,
        `- 车贷余额：${carLoan}元`,
        `- 信用卡债务：${creditCard}元`,
        `- 其他债务：${otherDebts}元`,
        `共同债务总额：${totalDebts}元`,
        '',
        `净资产：${netAssets}元`,
        '',
        '财产分割结果：',
        `- 丈夫分得比例：${(husbandRatio * 100).toFixed(0)}%，金额：${husbandNetAssets}元`,
        `- 妻子分得比例：${(wifeRatio * 100).toFixed(0)}%，金额：${wifeNetAssets}元`
    ]

    // 添加子女抚养信息
    if (hasChildren) {
        if (childCustody === 'husband') {
            details.push('', '子女抚养安排：', '- 子女由丈夫抚养')
        } else if (childCustody === 'wife') {
            details.push('', '子女抚养安排：', '- 子女由妻子抚养')
        } else {
            details.push('', '子女抚养安排：', '- 子女由双方共同抚养')
        }

        if (childSupportAmount > 0) {
            details.push(`- 子女抚养费：${childSupportAmount}元（由${childSupportPayer}支付给${childSupportReceiver}）`)
        }
    }

    return {
        totalAssets,
        totalDebts,
        netAssets,
        husbandNetAssets,
        wifeNetAssets,
        childSupportAmount,
        childSupportPayer,
        childSupportReceiver,
        details
    }
}

/**
 * 计算夫妻共同财产
 * @param husbandAssets 丈夫婚前财产
 * @param wifeAssets 妻子婚前财产
 * @param jointAssets 婚后共同财产
 * @param options 计算选项
 * @returns 夫妻共同财产计算结果
 */
export function calculateMaritalProperty(
    husbandAssets: Record<string, number> = {},
    wifeAssets: Record<string, number> = {},
    jointAssets: Record<string, number> = {},
    _options: Record<string, unknown> = {}
): MaritalPropertyResult {
    // 提取丈夫婚前财产
    const husbandPreMaritalAssets = Object.values(husbandAssets).reduce((sum, value) => sum + (value || 0), 0)

    // 提取妻子婚前财产
    const wifePreMaritalAssets = Object.values(wifeAssets).reduce((sum, value) => sum + (value || 0), 0)

    // 提取婚后共同财产
    const jointTotalAssets = Object.values(jointAssets).reduce((sum, value) => sum + (value || 0), 0)

    // 计算婚后共同财产增值（简化计算）
    const jointIncrease = jointTotalAssets - husbandPreMaritalAssets - wifePreMaritalAssets

    // 生成详细信息
    const details: string[] = [
        '丈夫婚前财产：',
        ...Object.entries(husbandAssets).map(([key, value]) => `- ${key}：${value || 0}元`),
        `丈夫婚前财产总额：${husbandPreMaritalAssets}元`,
        '',
        '妻子婚前财产：',
        ...Object.entries(wifeAssets).map(([key, value]) => `- ${key}：${value || 0}元`),
        `妻子婚前财产总额：${wifePreMaritalAssets}元`,
        '',
        '婚后共同财产：',
        ...Object.entries(jointAssets).map(([key, value]) => `- ${key}：${value || 0}元`),
        `婚后共同财产总额：${jointTotalAssets}元`,
        '',
        `婚后共同财产增值：${jointIncrease}元`
    ]

    return {
        husbandPreMaritalAssets,
        wifePreMaritalAssets,
        jointTotalAssets,
        jointIncrease,
        details
    }
}
