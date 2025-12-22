/**
 * 律师费用计算服务
 * 根据《律师服务收费管理办法》及地方律师协会指导标准计算律师费用
 */

import type {
    LawyerCaseType,
    ComplexityType,
    LawyerAdministrativeType,
    DocumentType,
    CommercialType,
    CivilStage,
    CriminalStage,
    RegionType,
    LawyerFeeOptions,
    LawyerFeeResult
} from '#shared/types/tools'

/**
 * 计算律师费用
 * @param caseType 案件类型
 * @param options 计算选项
 * @returns 律师费用计算结果
 */
export function calculateLawyerFee(caseType: LawyerCaseType, options: LawyerFeeOptions = {}): LawyerFeeResult {
    let fee = 0
    const details: string[] = []

    // 提取选项
    const {
        disputeAmount = 0,
        complexity = 'medium',
        administrativeType = 'basic',
        consultationHours = 0,
        region = 'tier2',
        hasAppeal = false,
        hasExecution = false,
        stages = [],
        caseDuration = 1
    } = options

    // 地区系数
    const regionCoefficient = getRegionCoefficient(region)

    switch (caseType) {
        case 'civil':
            // 民事案件
            fee = calculateCivilLawyerFee(disputeAmount, complexity, regionCoefficient, hasAppeal, hasExecution, stages as CivilStage[])
            details.push(`案件类型：民事案件`)
            details.push(`争议金额：${disputeAmount}元`)
            details.push(`案件复杂程度：${getComplexityText(complexity)}`)
            details.push(`地区：${getRegionText(region)}`)
            details.push(`律师费用计算方式：${getCivilFeeDescription(disputeAmount)}`)
            details.push(`地区系数：${regionCoefficient}`)

            if (hasAppeal) {
                details.push(`包含上诉阶段（费用增加30%）`)
            }

            if (hasExecution) {
                details.push(`包含执行阶段（费用增加20%）`)
            }

            // 如果选择了特定阶段
            if (stages && stages.length > 0) {
                details.push(`选择的代理阶段：${getStagesText(stages)}`)
            }
            break

        case 'criminal':
            // 刑事案件
            fee = calculateCriminalLawyerFee(complexity, regionCoefficient, stages as CriminalStage[], caseDuration)
            details.push(`案件类型：刑事案件`)
            details.push(`案件复杂程度：${getComplexityText(complexity)}`)
            details.push(`地区：${getRegionText(region)}`)

            // 基础费用说明
            const baseCriminalFee = getCriminalBaseFee(complexity)
            details.push(`基础律师费用：${baseCriminalFee}元`)

            // 持续时间调整
            if (caseDuration > 1) {
                details.push(`案件持续时间：${caseDuration}个月（长期案件，费用调整）`)
            }

            // 阶段性选择
            if (stages && stages.length > 0) {
                details.push(`选择的辩护阶段：${getStagesText(stages)}`)
            }

            details.push(`考虑地区系数 ${regionCoefficient} 后最终费用：${fee}元`)
            break

        case 'administrative':
            // 行政案件
            fee = calculateAdministrativeLawyerFee(administrativeType, regionCoefficient, hasAppeal)
            details.push(`案件类型：行政案件（${getAdministrativeTypeText(administrativeType)}）`)
            details.push(`地区：${getRegionText(region)}`)

            const baseAdminFee = getAdministrativeBaseFee(administrativeType)
            details.push(`基础律师费用：${baseAdminFee}元`)

            if (hasAppeal) {
                details.push(`包含上诉阶段（费用增加30%）`)
            }

            details.push(`考虑地区系数 ${regionCoefficient} 后最终费用：${fee}元`)
            break

        case 'consultation':
            // 法律咨询
            fee = calculateConsultationFee(consultationHours, regionCoefficient)
            details.push(`服务类型：法律咨询`)
            details.push(`咨询时长：${consultationHours}小时`)
            details.push(`地区：${getRegionText(region)}`)

            const hourlyRate = getConsultationHourlyRate(regionCoefficient)
            details.push(`咨询费率：${hourlyRate}元/小时`)
            details.push(`总费用：${hourlyRate}元/小时 × ${consultationHours}小时 = ${fee}元`)
            break

        case 'document':
            // 法律文书
            fee = calculateDocumentFee(options.documentType, regionCoefficient, options.documentComplexity)
            details.push(`服务类型：法律文书`)
            details.push(`文书类型：${getDocumentTypeText(options.documentType)}`)
            details.push(`复杂程度：${getComplexityText(options.documentComplexity || 'medium')}`)
            details.push(`地区：${getRegionText(region)}`)
            details.push(`律师费用：${fee}元`)
            break

        case 'commercial':
            // 商事法律服务
            fee = calculateCommercialFee(options.commercialType, disputeAmount, regionCoefficient)
            details.push(`服务类型：商事法律服务`)
            details.push(`服务内容：${getCommercialTypeText(options.commercialType)}`)
            if (disputeAmount > 0) {
                details.push(`涉及金额：${disputeAmount}元`)
            }
            details.push(`地区：${getRegionText(region)}`)
            details.push(`律师费用：${fee}元`)
            break
    }

    return {
        caseType,
        fee,
        details
    }
}

/**
 * 计算民事案件律师费用
 */
function calculateCivilLawyerFee(
    amount: number,
    complexity: ComplexityType,
    regionCoefficient: number,
    hasAppeal: boolean = false,
    hasExecution: boolean = false,
    stages: CivilStage[] = []
): number {
    let baseFee = 0

    // 基础收费阶梯
    if (amount <= 100000) {
        baseFee = 5000
    } else if (amount <= 500000) {
        baseFee = 5000 + (amount - 100000) * 0.04
    } else if (amount <= 1000000) {
        baseFee = 5000 + 400000 * 0.04 + (amount - 500000) * 0.03
    } else if (amount <= 5000000) {
        baseFee = 5000 + 400000 * 0.04 + 500000 * 0.03 + (amount - 1000000) * 0.02
    } else if (amount <= 10000000) {
        baseFee = 5000 + 400000 * 0.04 + 500000 * 0.03 + 4000000 * 0.02 + (amount - 5000000) * 0.01
    } else {
        baseFee = 5000 + 400000 * 0.04 + 500000 * 0.03 + 4000000 * 0.02 + 5000000 * 0.01 + (amount - 10000000) * 0.005
    }

    // 复杂度调整
    let complexityFactor = 1.0
    switch (complexity) {
        case 'simple':
            complexityFactor = 0.8
            break
        case 'medium':
            complexityFactor = 1.0
            break
        case 'complex':
            complexityFactor = 1.3
            break
        case 'very-complex':
            complexityFactor = 1.5
            break
    }

    baseFee = baseFee * complexityFactor

    // 阶段性调整
    if (stages && stages.length > 0) {
        let stagesFactor = 0
        stages.forEach(stage => {
            switch (stage) {
                case 'preparation':
                    stagesFactor += 0.2
                    break
                case 'evidence':
                    stagesFactor += 0.2
                    break
                case 'court':
                    stagesFactor += 0.4
                    break
                case 'settlement':
                    stagesFactor += 0.2
                    break
            }
        })
        baseFee = baseFee * Math.min(stagesFactor, 1.0)
    }

    // 上诉和执行调整
    if (hasAppeal) {
        baseFee = baseFee * 1.3
    }

    if (hasExecution) {
        baseFee = baseFee * 1.2
    }

    // 地区系数调整
    return Math.round(baseFee * regionCoefficient)
}

/**
 * 获取民事案件律师费用计算描述
 */
function getCivilFeeDescription(amount: number): string {
    if (amount <= 100000) {
        return '5000元'
    } else if (amount <= 500000) {
        return '5000元 + (争议金额 - 100000元) × 4%'
    } else if (amount <= 1000000) {
        return '5000元 + 400000元 × 4% + (争议金额 - 500000元) × 3%'
    } else if (amount <= 5000000) {
        return '5000元 + 400000元 × 4% + 500000元 × 3% + (争议金额 - 1000000元) × 2%'
    } else if (amount <= 10000000) {
        return '5000元 + 400000元 × 4% + 500000元 × 3% + 4000000元 × 2% + (争议金额 - 5000000元) × 1%'
    } else {
        return '5000元 + 400000元 × 4% + 500000元 × 3% + 4000000元 × 2% + 5000000元 × 1% + (争议金额 - 10000000元) × 0.5%'
    }
}

/**
 * 计算刑事案件律师费用
 */
function calculateCriminalLawyerFee(
    complexity: ComplexityType,
    regionCoefficient: number,
    stages: CriminalStage[] = [],
    caseDuration: number = 1
): number {
    let baseFee = getCriminalBaseFee(complexity)

    // 阶段性调整
    if (stages && stages.length > 0) {
        let stagesFactor = 0
        stages.forEach(stage => {
            switch (stage) {
                case 'investigation':
                    stagesFactor += 0.3
                    break
                case 'prosecution':
                    stagesFactor += 0.3
                    break
                case 'trial':
                    stagesFactor += 0.4
                    break
            }
        })
        baseFee = baseFee * Math.min(stagesFactor, 1.0)
    }

    // 持续时间调整
    if (caseDuration > 1) {
        const durationFactor = 1 + Math.min(caseDuration - 1, 10) * 0.1
        baseFee = baseFee * durationFactor
    }

    return Math.round(baseFee * regionCoefficient)
}

/**
 * 获取刑事案件基础律师费用
 */
function getCriminalBaseFee(complexity: ComplexityType): number {
    switch (complexity) {
        case 'simple':
            return 10000
        case 'medium':
            return 20000
        case 'complex':
            return 50000
        case 'very-complex':
            return 100000
        default:
            return 20000
    }
}

/**
 * 计算行政案件律师费用
 */
function calculateAdministrativeLawyerFee(
    type: LawyerAdministrativeType,
    regionCoefficient: number,
    hasAppeal: boolean = false
): number {
    let baseFee = getAdministrativeBaseFee(type)

    if (hasAppeal) {
        baseFee = baseFee * 1.3
    }

    return Math.round(baseFee * regionCoefficient)
}

/**
 * 获取行政案件基础律师费用
 */
function getAdministrativeBaseFee(type: LawyerAdministrativeType): number {
    switch (type) {
        case 'basic':
            return 8000
        case 'land':
            return 15000
        case 'planning':
            return 12000
        case 'environmental':
            return 18000
        case 'licensing':
            return 10000
        default:
            return 8000
    }
}

/**
 * 计算法律咨询费用
 */
function calculateConsultationFee(hours: number, regionCoefficient: number): number {
    const hourlyRate = getConsultationHourlyRate(regionCoefficient)
    return Math.round(hourlyRate * hours)
}

/**
 * 获取法律咨询小时费率
 */
function getConsultationHourlyRate(regionCoefficient: number): number {
    const baseRate = 500
    return Math.round(baseRate * regionCoefficient)
}

/**
 * 计算法律文书费用
 */
function calculateDocumentFee(
    documentType: DocumentType | undefined = 'contract',
    regionCoefficient: number,
    complexity: ComplexityType | undefined = 'medium'
): number {
    let baseFee = 0

    switch (documentType) {
        case 'contract':
            baseFee = 3000
            break
        case 'lawsuit':
            baseFee = 5000
            break
        case 'opinion':
            baseFee = 2000
            break
        case 'will':
            baseFee = 3000
            break
        case 'corporate':
            baseFee = 5000
            break
        default:
            baseFee = 3000
    }

    // 复杂度调整
    let complexityFactor = 1.0
    switch (complexity) {
        case 'simple':
            complexityFactor = 0.7
            break
        case 'medium':
            complexityFactor = 1.0
            break
        case 'complex':
            complexityFactor = 1.5
            break
    }

    return Math.round(baseFee * complexityFactor * regionCoefficient)
}

/**
 * 计算商事法律服务费用
 */
function calculateCommercialFee(
    commercialType: CommercialType | undefined = 'contract_review',
    amount: number = 0,
    regionCoefficient: number
): number {
    let baseFee = 0

    switch (commercialType) {
        case 'contract_review':
            baseFee = 5000
            if (amount > 1000000) {
                baseFee += amount * 0.003
            }
            break
        case 'negotiation':
            baseFee = 8000
            if (amount > 1000000) {
                baseFee += amount * 0.005
            }
            break
        case 'due_diligence':
            baseFee = 20000
            if (amount > 10000000) {
                baseFee += amount * 0.001
            }
            break
        case 'ipo_advisory':
            baseFee = 100000
            if (amount > 0) {
                baseFee += amount * 0.0005
            }
            break
        case 'compliance':
            baseFee = 15000
            break
        default:
            baseFee = 8000
    }

    // 金额上限
    if (baseFee > 1000000) {
        baseFee = 1000000
    }

    return Math.round(baseFee * regionCoefficient)
}

/**
 * 获取地区系数
 */
function getRegionCoefficient(region: RegionType): number {
    switch (region) {
        case 'tier1':
            return 1.5
        case 'tier2':
            return 1.0
        case 'tier3':
            return 0.7
        default:
            return 1.0
    }
}

/**
 * 获取地区文本
 */
function getRegionText(region: RegionType): string {
    switch (region) {
        case 'tier1':
            return '一线城市（北上广深）'
        case 'tier2':
            return '二线城市'
        case 'tier3':
            return '三线及以下城市'
        default:
            return '二线城市'
    }
}

/**
 * 获取案件复杂程度文本
 */
function getComplexityText(complexity: ComplexityType): string {
    switch (complexity) {
        case 'simple':
            return '简单'
        case 'medium':
            return '一般'
        case 'complex':
            return '复杂'
        case 'very-complex':
            return '特别复杂'
        default:
            return '一般'
    }
}

/**
 * 获取行政案件类型文本
 */
function getAdministrativeTypeText(type: LawyerAdministrativeType): string {
    switch (type) {
        case 'basic':
            return '一般行政案件'
        case 'land':
            return '土地行政案件'
        case 'planning':
            return '规划行政案件'
        case 'environmental':
            return '环境行政案件'
        case 'licensing':
            return '行政许可案件'
        default:
            return '一般行政案件'
    }
}

/**
 * 获取代理阶段文本
 */
function getStagesText(stages: (CivilStage | CriminalStage)[]): string {
    if (!stages || stages.length === 0) {
        return '全程代理'
    }

    const stageTexts: Record<string, string> = {
        'preparation': '准备阶段',
        'evidence': '举证阶段',
        'court': '庭审阶段',
        'settlement': '调解阶段',
        'investigation': '侦查阶段',
        'prosecution': '审查起诉阶段',
        'trial': '审判阶段'
    }

    return stages.map(stage => stageTexts[stage] || stage).join('、')
}

/**
 * 获取法律文书类型文本
 */
function getDocumentTypeText(documentType: DocumentType | undefined): string {
    switch (documentType) {
        case 'contract':
            return '合同文书'
        case 'lawsuit':
            return '诉讼文书'
        case 'opinion':
            return '法律意见书'
        case 'will':
            return '遗嘱'
        case 'corporate':
            return '公司法律文件'
        default:
            return '一般法律文书'
    }
}

/**
 * 获取商事服务类型文本
 */
function getCommercialTypeText(type: CommercialType | undefined): string {
    switch (type) {
        case 'contract_review':
            return '合同审查'
        case 'negotiation':
            return '商务谈判'
        case 'due_diligence':
            return '尽职调查'
        case 'ipo_advisory':
            return '上市法律顾问'
        case 'compliance':
            return '合规服务'
        default:
            return '一般商事服务'
    }
}
