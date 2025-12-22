/**
 * 诉讼费用计算服务
 * 根据《诉讼费用交纳办法》(2006年国务院令第481号)计算各类诉讼费用
 */

import type {
    FeeTypeLevel1,
    CaseFeeType,
    ApplicationFeeType,
    CourtFeeOptions,
    CourtFeeResult,
    MaritimeType
} from '#shared/types/tools'

/**
 * 计算诉讼费用
 * @param feeTypeLevel1 费用一级类型：caseFee(受理费)或applicationFee(申请费)
 * @param feeTypeLevel2 费用二级类型
 * @param amount 金额（元）
 * @param options 其他选项
 * @returns 计算结果
 */
export function calculateCourtFee(
    feeTypeLevel1: FeeTypeLevel1,
    feeTypeLevel2: CaseFeeType | ApplicationFeeType,
    amount: number = 0,
    options: CourtFeeOptions = {}
): CourtFeeResult {
    if (feeTypeLevel1 === 'caseFee') {
        return calculateCaseFee(feeTypeLevel2 as CaseFeeType, amount, options)
    } else {
        return calculateApplicationFee(feeTypeLevel2 as ApplicationFeeType, amount, options)
    }
}

/**
 * 计算受理费
 */
function calculateCaseFee(feeType: CaseFeeType, amount: number = 0, options: CourtFeeOptions = {}): CourtFeeResult {
    let fee = 0
    const details: string[] = []

    switch (feeType) {
        case 'property': // 财产案件
            fee = calculatePropertyCaseFee(amount)
            details.push(`财产案件受理费计算依据：案件标的额为${amount}元`)
            details.push(getPropertyCaseFeeDetail(amount))
            break

        case 'nonProperty': // 非财产案件
            if (options.nonPropertyType === 'divorce') { // 离婚案件
                if (options.hasProperty) { // 涉及财产分割
                    const divorceFee = 300 // 基本离婚费用
                    const propertyFee = calculatePropertyCaseFee(amount) // 财产部分
                    fee = divorceFee + propertyFee
                    details.push(`离婚案件受理费：300元 (不涉及财产分割部分)`)
                    details.push(`离婚案件涉及财产分割部分受理费计算依据：财产分割金额为${amount}元`)
                    details.push(getPropertyCaseFeeDetail(amount))
                    details.push(`离婚案件受理费合计：${fee}元 (300元 + ${propertyFee}元)`)
                } else { // 不涉及财产分割
                    fee = 300
                    details.push(`离婚案件受理费(不涉及财产分割)：300元`)
                }
            } else if (options.nonPropertyType === 'personality') { // 人格权案件
                if (options.hasDamages) { // 涉及损害赔偿
                    const baseFee = 300 // 基本人格权案件费用
                    const damageFee = calculatePropertyCaseFee(amount) // 损害赔偿部分
                    fee = baseFee + damageFee
                    details.push(`人格权案件受理费：300元 (不涉及损害赔偿部分)`)
                    details.push(`人格权案件涉及损害赔偿部分受理费计算依据：损害赔偿金额为${amount}元`)
                    details.push(getPropertyCaseFeeDetail(amount))
                    details.push(`人格权案件受理费合计：${fee}元 (300元 + ${damageFee}元)`)
                } else { // 不涉及损害赔偿
                    fee = 300
                    details.push(`人格权案件受理费(不涉及损害赔偿)：300元`)
                }
            } else { // 其他非财产案件
                fee = 100
                details.push(`其他非财产案件受理费：100元`)
            }
            break

        case 'intellectualProperty': // 知识产权民事案件
            if (options.hasDisputeAmount) { // 有争议金额
                fee = calculatePropertyCaseFee(amount)
                details.push(`知识产权民事案件受理费(有争议金额)计算依据：争议金额为${amount}元`)
                details.push(getPropertyCaseFeeDetail(amount))
            } else { // 无争议金额
                fee = 800
                details.push(`知识产权民事案件受理费(无争议金额)：800元`)
            }
            break

        case 'labor': // 劳动争议案件
            fee = 10
            details.push(`劳动争议案件受理费：10元 (固定收费)`)
            break

        case 'administrative': // 行政案件
            if (options.administrativeType === 'special') { // 商标、专利、海事行政案件
                fee = 100
                details.push(`商标、专利、海事行政案件受理费：100元`)
            } else { // 其他行政案件
                fee = 50
                details.push(`其他行政案件受理费：50元`)
            }
            break

        case 'jurisdiction': // 管辖权异议
            fee = 100
            details.push(`当事人提出案件管辖权异议收费：100元`)
            break

        default:
            fee = 0
            details.push(`未指定有效的受理费类型`)
    }

    return {
        totalFee: fee,
        details: details
    }
}

/**
 * 计算申请费
 */
function calculateApplicationFee(feeType: ApplicationFeeType, amount: number = 0, options: CourtFeeOptions = {}): CourtFeeResult {
    let fee = 0
    const details: string[] = []

    switch (feeType) {
        case 'execution': // 申请执行
            if (options.hasExecutionAmount) { // 有执行金额或价额
                fee = calculateExecutionFee(amount)
                details.push(`申请执行费(有执行金额)计算依据：执行金额为${amount}元`)
                details.push(getExecutionFeeDetail(amount))
            } else { // 没有执行金额或价额
                fee = 50
                details.push(`申请执行费(没有执行金额或价额)：50元`)
            }
            break

        case 'preservation': // 申请保全
            if (options.hasPreservationProperty) { // 涉及财产
                fee = Math.max(30, amount * 0.005)
                fee = Math.min(fee, 5000) // 最高不超过5000元
                details.push(`申请保全费(涉及财产)计算公式：保全金额${amount}元 × 0.5%, 最低30元，最高5000元`)
                details.push(`申请保全费：${fee}元`)
            } else { // 不涉及财产
                fee = 30
                details.push(`申请保全费(不涉及财产)：30元`)
            }
            break

        case 'paymentOrder': // 申请支付令
            fee = Math.round(amount * 0.01)
            fee = Math.min(fee, 300) // 最高不超过300元
            details.push(`申请支付令费用计算公式：${amount}元 × 1%, 最高300元`)
            details.push(`申请支付令费用：${fee}元`)
            break

        case 'publicNotice': // 申请公示催告
            fee = 100
            details.push(`申请公示催告费用：100元`)
            break

        case 'arbitration': // 申请撤销仲裁裁决或认定仲裁协议效力
            fee = 400
            details.push(`申请撤销仲裁裁决或认定仲裁协议效力费用：400元`)
            break

        case 'bankruptcy': // 申请破产
            fee = Math.min(Math.max(500, amount * 0.005), 300000)
            details.push(`申请破产费用计算公式：${amount}元 × 0.5%，最低500元，最高300000元`)
            details.push(`申请破产费用：${fee}元`)
            break

        case 'maritime': // 海事案件
            fee = calculateMaritimeFee(options.maritimeType, amount)
            details.push(`海事案件申请费：${fee}元`)
            break

        default:
            fee = 0
            details.push(`未指定有效的申请费类型`)
    }

    return {
        totalFee: fee,
        details: details
    }
}

/**
 * 计算财产案件受理费
 */
function calculatePropertyCaseFee(amount: number): number {
    if (amount <= 0) return 0
    let fee = 0

    if (amount <= 10000) {
        fee = 50
    } else if (amount <= 100000) {
        fee = 50 + (amount - 10000) * 0.025
    } else if (amount <= 200000) {
        fee = 50 + (100000 - 10000) * 0.025 + (amount - 100000) * 0.02
    } else if (amount <= 500000) {
        fee = 50 + (100000 - 10000) * 0.025 + (200000 - 100000) * 0.02 + (amount - 200000) * 0.015
    } else if (amount <= 1000000) {
        fee = 50 + (100000 - 10000) * 0.025 + (200000 - 100000) * 0.02 + (500000 - 200000) * 0.015 + (amount - 500000) * 0.01
    } else if (amount <= 2000000) {
        fee = 50 + (100000 - 10000) * 0.025 + (200000 - 100000) * 0.02 + (500000 - 200000) * 0.015 + (1000000 - 500000) * 0.01 + (amount - 1000000) * 0.009
    } else if (amount <= 5000000) {
        fee = 50 + (100000 - 10000) * 0.025 + (200000 - 100000) * 0.02 + (500000 - 200000) * 0.015 + (1000000 - 500000) * 0.01 + (2000000 - 1000000) * 0.009 + (amount - 2000000) * 0.008
    } else if (amount <= 10000000) {
        fee = 50 + (100000 - 10000) * 0.025 + (200000 - 100000) * 0.02 + (500000 - 200000) * 0.015 + (1000000 - 500000) * 0.01 + (2000000 - 1000000) * 0.009 + (5000000 - 2000000) * 0.008 + (amount - 5000000) * 0.007
    } else if (amount <= 20000000) {
        fee = 50 + (100000 - 10000) * 0.025 + (200000 - 100000) * 0.02 + (500000 - 200000) * 0.015 + (1000000 - 500000) * 0.01 + (2000000 - 1000000) * 0.009 + (5000000 - 2000000) * 0.008 + (10000000 - 5000000) * 0.007 + (amount - 10000000) * 0.006
    } else {
        fee = 50 + (100000 - 10000) * 0.025 + (200000 - 100000) * 0.02 + (500000 - 200000) * 0.015 + (1000000 - 500000) * 0.01 + (2000000 - 1000000) * 0.009 + (5000000 - 2000000) * 0.008 + (10000000 - 5000000) * 0.007 + (20000000 - 10000000) * 0.006 + (amount - 20000000) * 0.005
    }

    return Math.round(fee)
}

/**
 * 生成财产案件受理费的计算细节
 */
function getPropertyCaseFeeDetail(amount: number): string {
    if (amount <= 10000) {
        return `计算公式：不超过1万元的，每件交纳50元`
    }

    let details = '计算公式：'

    if (amount > 10000) {
        if (amount <= 100000) {
            details += `50元 + (${amount} - 10000) × 2.5%`
        } else {
            details += `50元 + (100000 - 10000) × 2.5%`

            if (amount <= 200000) {
                details += ` + (${amount} - 100000) × 2%`
            } else {
                details += ` + (200000 - 100000) × 2%`

                if (amount <= 500000) {
                    details += ` + (${amount} - 200000) × 1.5%`
                } else {
                    details += ` + (500000 - 200000) × 1.5%`

                    if (amount <= 1000000) {
                        details += ` + (${amount} - 500000) × 1%`
                    } else {
                        details += ` + (1000000 - 500000) × 1%`

                        if (amount <= 2000000) {
                            details += ` + (${amount} - 1000000) × 0.9%`
                        } else {
                            details += ` + (2000000 - 1000000) × 0.9%`

                            if (amount <= 5000000) {
                                details += ` + (${amount} - 2000000) × 0.8%`
                            } else {
                                details += ` + (5000000 - 2000000) × 0.8%`

                                if (amount <= 10000000) {
                                    details += ` + (${amount} - 5000000) × 0.7%`
                                } else {
                                    details += ` + (10000000 - 5000000) × 0.7%`

                                    if (amount <= 20000000) {
                                        details += ` + (${amount} - 10000000) × 0.6%`
                                    } else {
                                        details += ` + (20000000 - 10000000) × 0.6%`
                                        details += ` + (${amount} - 20000000) × 0.5%`
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    return details
}

/**
 * 计算申请执行费
 */
function calculateExecutionFee(amount: number): number {
    if (amount <= 0) return 0
    let fee = 0

    if (amount <= 10000) {
        fee = 50
    } else if (amount <= 500000) {
        fee = 50 + (amount - 10000) * 0.01
    } else if (amount <= 5000000) {
        fee = 50 + (500000 - 10000) * 0.01 + (amount - 500000) * 0.005
    } else if (amount <= 10000000) {
        fee = 50 + (500000 - 10000) * 0.01 + (5000000 - 500000) * 0.005 + (amount - 5000000) * 0.001
    } else {
        fee = 50 + (500000 - 10000) * 0.01 + (5000000 - 500000) * 0.005 + (10000000 - 5000000) * 0.001 + (amount - 10000000) * 0.0005
    }

    return Math.round(fee)
}

/**
 * 生成申请执行费的计算细节
 */
function getExecutionFeeDetail(amount: number): string {
    if (amount <= 10000) {
        return `计算公式：不超过1万元的，每件交纳50元`
    }

    let details = '计算公式：'

    if (amount > 10000) {
        if (amount <= 500000) {
            details += `50元 + (${amount} - 10000) × 1%`
        } else {
            details += `50元 + (500000 - 10000) × 1%`

            if (amount <= 5000000) {
                details += ` + (${amount} - 500000) × 0.5%`
            } else {
                details += ` + (5000000 - 500000) × 0.5%`

                if (amount <= 10000000) {
                    details += ` + (${amount} - 5000000) × 0.1%`
                } else {
                    details += ` + (10000000 - 5000000) × 0.1%`
                    details += ` + (${amount} - 10000000) × 0.05%`
                }
            }
        }
    }

    return details
}

/**
 * 计算海事案件申请费
 */
function calculateMaritimeFee(maritimeType: MaritimeType | undefined, amount: number = 0): number {
    switch (maritimeType) {
        case 'fund': // 申请设立海事赔偿责任限制基金
            return Math.round(amount * 0.001)
        case 'order': // 申请海事强制令
            return 1000
        case 'notice': // 申请船舶优先权催告
            return 1000
        case 'register': // 申请海事债权登记
            return 100
        case 'average': // 申请共同海损理算
            return 1000
        default:
            return 0
    }
}
