/**
 * 仲裁费用计算服务
 */

import type { RegionType, ArbitrationFeeResult } from '#shared/types/tools'

/**
 * 计算仲裁费用
 * @param disputeAmount 争议金额（元）
 * @param region 地区类型
 * @returns 仲裁费用计算结果
 */
export function calculateArbitrationFee(disputeAmount: number, region: RegionType = 'tier2'): ArbitrationFeeResult {
    let fee = 0
    const details: string[] = []

    // 地区系数
    const regionCoefficient = getRegionCoefficient(region)

    // 计算基础仲裁费用
    const baseFee = calculateBaseArbitrationFee(disputeAmount)

    // 应用地区系数
    fee = Math.round(baseFee * regionCoefficient)

    // 添加计算详情
    details.push(`争议金额：${disputeAmount}元`)
    details.push(`地区：${getRegionText(region)}`)
    details.push(`基础仲裁费用：${baseFee}元`)
    details.push(`地区系数：${regionCoefficient}`)
    details.push(`最终仲裁费用：${fee}元`)

    return {
        disputeAmount,
        fee,
        details
    }
}

/**
 * 计算基础仲裁费用
 * @param amount 争议金额
 * @returns 基础仲裁费用
 */
function calculateBaseArbitrationFee(amount: number): number {
    let fee = 0

    if (amount <= 10000) {
        fee = 100
    } else if (amount <= 50000) {
        fee = 100 + (amount - 10000) * 0.005
    } else if (amount <= 100000) {
        fee = 100 + 40000 * 0.005 + (amount - 50000) * 0.004
    } else if (amount <= 200000) {
        fee = 100 + 40000 * 0.005 + 50000 * 0.004 + (amount - 100000) * 0.003
    } else if (amount <= 500000) {
        fee = 100 + 40000 * 0.005 + 50000 * 0.004 + 100000 * 0.003 + (amount - 200000) * 0.002
    } else if (amount <= 1000000) {
        fee = 100 + 40000 * 0.005 + 50000 * 0.004 + 100000 * 0.003 + 300000 * 0.002 + (amount - 500000) * 0.001
    } else {
        fee = 100 + 40000 * 0.005 + 50000 * 0.004 + 100000 * 0.003 + 300000 * 0.002 + 500000 * 0.001 + (amount - 1000000) * 0.0005
    }

    return Math.round(fee)
}

/**
 * 获取地区系数
 * @param region 地区
 * @returns 地区系数
 */
function getRegionCoefficient(region: RegionType): number {
    switch (region) {
        case 'tier1':
            return 1.2
        case 'tier2':
            return 1.0
        case 'tier3':
            return 0.8
        default:
            return 1.0
    }
}

/**
 * 获取地区文本
 * @param region 地区
 * @returns 地区文本
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
 * 获取仲裁费用计算描述
 * @param amount 争议金额
 * @returns 计算描述
 */
export function getArbitrationFeeDescription(amount: number): string {
    if (amount <= 10000) {
        return '100元'
    } else if (amount <= 50000) {
        return '100元 + (争议金额 - 10000元) × 0.5%'
    } else if (amount <= 100000) {
        return '100元 + 40000元 × 0.5% + (争议金额 - 50000元) × 0.4%'
    } else if (amount <= 200000) {
        return '100元 + 40000元 × 0.5% + 50000元 × 0.4% + (争议金额 - 100000元) × 0.3%'
    } else if (amount <= 500000) {
        return '100元 + 40000元 × 0.5% + 50000元 × 0.4% + 100000元 × 0.3% + (争议金额 - 200000元) × 0.2%'
    } else if (amount <= 1000000) {
        return '100元 + 40000元 × 0.5% + 50000元 × 0.4% + 100000元 × 0.3% + 300000元 × 0.2% + (争议金额 - 500000元) × 0.1%'
    } else {
        return '100元 + 40000元 × 0.5% + 50000元 × 0.4% + 100000元 × 0.3% + 300000元 × 0.2% + 500000元 × 0.1% + (争议金额 - 1000000元) × 0.05%'
    }
}
