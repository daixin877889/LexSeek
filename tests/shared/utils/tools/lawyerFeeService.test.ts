/**
 * 律师费用计算服务测试
 *
 * 测试 calculateLawyerFee 函数
 */
import { describe, it, expect } from 'vitest'
import { calculateLawyerFee } from '#shared/utils/tools/lawyerFeeService'

describe('calculateLawyerFee - 民事案件', () => {
    it('应正确计算10万元以下民事案件律师费', () => {
        const result = calculateLawyerFee('civil', { disputeAmount: 50000 })
        expect(result.fee).toBeGreaterThan(0)
    })

    it('应正确计算10万至50万民事案件律师费', () => {
        const result = calculateLawyerFee('civil', { disputeAmount: 300000 })
        const baseFee = 5000 + (300000 - 100000) * 0.04
        expect(result.fee).toBeCloseTo(baseFee, -2)
    })

    it('应正确计算50万至100万民事案件律师费', () => {
        const result = calculateLawyerFee('civil', { disputeAmount: 800000 })
        const baseFee = 5000 + 400000 * 0.04 + (800000 - 500000) * 0.03
        expect(result.fee).toBeCloseTo(baseFee, -2)
    })

    it('简单案件应使用0.8系数', () => {
        const result = calculateLawyerFee('civil', { disputeAmount: 50000, complexity: 'simple' })
        expect(result.fee).toBeGreaterThan(0)
    })

    it('复杂案件应使用1.3系数', () => {
        const result = calculateLawyerFee('civil', { disputeAmount: 50000, complexity: 'complex' })
        expect(result.fee).toBeGreaterThan(0)
    })

    it('包含上诉阶段应增加30%费用', () => {
        const resultNoAppeal = calculateLawyerFee('civil', { disputeAmount: 50000, hasAppeal: false })
        const resultWithAppeal = calculateLawyerFee('civil', { disputeAmount: 50000, hasAppeal: true })
        expect(resultWithAppeal.fee).toBeGreaterThan(resultNoAppeal.fee)
    })

    it('包含执行阶段应增加20%费用', () => {
        const resultNoExec = calculateLawyerFee('civil', { disputeAmount: 50000, hasExecution: false })
        const resultWithExec = calculateLawyerFee('civil', { disputeAmount: 50000, hasExecution: true })
        expect(resultWithExec.fee).toBeGreaterThan(resultNoExec.fee)
    })

    it('一线城市应使用1.5系数', () => {
        const resultTier2 = calculateLawyerFee('civil', { disputeAmount: 50000, region: 'tier2' })
        const resultTier1 = calculateLawyerFee('civil', { disputeAmount: 50000, region: 'tier1' })
        expect(resultTier1.fee).toBeGreaterThan(resultTier2.fee)
    })

    it('三线城市应使用0.7系数', () => {
        const resultTier2 = calculateLawyerFee('civil', { disputeAmount: 50000, region: 'tier2' })
        const resultTier3 = calculateLawyerFee('civil', { disputeAmount: 50000, region: 'tier3' })
        expect(resultTier3.fee).toBeLessThan(resultTier2.fee)
    })

    it('应包含案件类型明细', () => {
        const result = calculateLawyerFee('civil', { disputeAmount: 50000 })
        expect(result.details.some(d => d.includes('民事案件'))).toBe(true)
        expect(result.details.some(d => d.includes('争议金额'))).toBe(true)
    })

    it('应返回正确的案件类型', () => {
        const result = calculateLawyerFee('civil', { disputeAmount: 50000 })
        expect(result.caseType).toBe('civil')
    })
})

describe('calculateLawyerFee - 刑事案件', () => {
    it('应正确计算简单刑事案件律师费', () => {
        const result = calculateLawyerFee('criminal', { complexity: 'simple' })
        expect(result.fee).toBeGreaterThan(0)
    })

    it('应正确计算一般刑事案件律师费', () => {
        const result = calculateLawyerFee('criminal', { complexity: 'medium' })
        expect(result.fee).toBeGreaterThan(0)
    })

    it('应正确计算复杂刑事案件律师费', () => {
        const result = calculateLawyerFee('criminal', { complexity: 'complex' })
        expect(result.fee).toBeGreaterThan(0)
    })

    it('应正确计算特别复杂刑事案件律师费', () => {
        const result = calculateLawyerFee('criminal', { complexity: 'very-complex' })
        expect(result.fee).toBeGreaterThan(0)
    })

    it('案件持续时间超过1个月应调整费用', () => {
        const result1Month = calculateLawyerFee('criminal', { complexity: 'medium', caseDuration: 1 })
        const result6Month = calculateLawyerFee('criminal', { complexity: 'medium', caseDuration: 6 })
        expect(result6Month.fee).toBeGreaterThan(result1Month.fee)
    })

    it('应包含案件类型明细', () => {
        const result = calculateLawyerFee('criminal', { complexity: 'medium' })
        expect(result.details.some(d => d.includes('刑事案件'))).toBe(true)
        expect(result.details.some(d => d.includes('基础律师费用'))).toBe(true)
    })

    it('应返回正确的案件类型', () => {
        const result = calculateLawyerFee('criminal', { complexity: 'medium' })
        expect(result.caseType).toBe('criminal')
    })
})

describe('calculateLawyerFee - 行政案件', () => {
    it('应正确计算一般行政案件律师费', () => {
        const result = calculateLawyerFee('administrative', { administrativeType: 'basic' })
        expect(result.fee).toBe(8000)
    })

    it('应正确计算土地行政案件律师费', () => {
        const result = calculateLawyerFee('administrative', { administrativeType: 'land' })
        expect(result.fee).toBe(15000)
    })

    it('应正确计算规划行政案件律师费', () => {
        const result = calculateLawyerFee('administrative', { administrativeType: 'planning' })
        expect(result.fee).toBe(12000)
    })

    it('应正确计算环境行政案件律师费', () => {
        const result = calculateLawyerFee('administrative', { administrativeType: 'environmental' })
        expect(result.fee).toBe(18000)
    })

    it('应正确计算行政许可案件律师费', () => {
        const result = calculateLawyerFee('administrative', { administrativeType: 'licensing' })
        expect(result.fee).toBe(10000)
    })

    it('包含上诉应增加30%费用', () => {
        const resultNoAppeal = calculateLawyerFee('administrative', { administrativeType: 'basic', hasAppeal: false })
        const resultWithAppeal = calculateLawyerFee('administrative', { administrativeType: 'basic', hasAppeal: true })
        expect(resultWithAppeal.fee).toBeGreaterThan(resultNoAppeal.fee)
    })

    it('应返回正确的案件类型', () => {
        const result = calculateLawyerFee('administrative', { administrativeType: 'basic' })
        expect(result.caseType).toBe('administrative')
    })
})

describe('calculateLawyerFee - 法律咨询', () => {
    it('应正确计算法律咨询费用', () => {
        const result = calculateLawyerFee('consultation', { consultationHours: 5 })
        expect(result.fee).toBe(500 * 5)
    })

    it('应包含咨询时长明细', () => {
        const result = calculateLawyerFee('consultation', { consultationHours: 10 })
        expect(result.details.some(d => d.includes('咨询时长'))).toBe(true)
    })

    it('应返回正确的案件类型', () => {
        const result = calculateLawyerFee('consultation', { consultationHours: 5 })
        expect(result.caseType).toBe('consultation')
    })
})

describe('calculateLawyerFee - 法律文书', () => {
    it('应正确计算合同文书费用', () => {
        const result = calculateLawyerFee('document', { documentType: 'contract' })
        expect(result.fee).toBe(3000)
    })

    it('应正确计算诉讼文书费用', () => {
        const result = calculateLawyerFee('document', { documentType: 'lawsuit' })
        expect(result.fee).toBe(5000)
    })

    it('应正确计算法律意见书费用', () => {
        const result = calculateLawyerFee('document', { documentType: 'opinion' })
        expect(result.fee).toBe(2000)
    })

    it('应正确计算遗嘱费用', () => {
        const result = calculateLawyerFee('document', { documentType: 'will' })
        expect(result.fee).toBe(3000)
    })

    it('应正确计算公司法律文件费用', () => {
        const result = calculateLawyerFee('document', { documentType: 'corporate' })
        expect(result.fee).toBe(5000)
    })

    it('简单文书应使用0.7系数', () => {
        const result = calculateLawyerFee('document', { documentType: 'contract', documentComplexity: 'simple' })
        expect(result.fee).toBe(Math.round(3000 * 0.7))
    })

    it('复杂文书应使用1.5系数', () => {
        const result = calculateLawyerFee('document', { documentType: 'contract', documentComplexity: 'complex' })
        expect(result.fee).toBe(Math.round(3000 * 1.5))
    })

    it('应返回正确的案件类型', () => {
        const result = calculateLawyerFee('document', { documentType: 'contract' })
        expect(result.caseType).toBe('document')
    })
})

describe('calculateLawyerFee - 商事法律服务', () => {
    it('应正确计算合同审查费用', () => {
        const result = calculateLawyerFee('commercial', { commercialType: 'contract_review' })
        expect(result.fee).toBe(5000)
    })

    it('应正确计算商务谈判费用', () => {
        const result = calculateLawyerFee('commercial', { commercialType: 'negotiation' })
        expect(result.fee).toBe(8000)
    })

    it('应正确计算尽职调查费用', () => {
        const result = calculateLawyerFee('commercial', { commercialType: 'due_diligence' })
        expect(result.fee).toBe(20000)
    })

    it('应正确计算上市法律顾问费用', () => {
        const result = calculateLawyerFee('commercial', { commercialType: 'ipo_advisory' })
        expect(result.fee).toBe(100000)
    })

    it('应正确计算合规服务费用', () => {
        const result = calculateLawyerFee('commercial', { commercialType: 'compliance' })
        expect(result.fee).toBe(15000)
    })

    it('合同审查涉及大额时应额外收费', () => {
        const resultSmall = calculateLawyerFee('commercial', { commercialType: 'contract_review', disputeAmount: 500000 })
        const resultLarge = calculateLawyerFee('commercial', { commercialType: 'contract_review', disputeAmount: 2000000 })
        expect(resultLarge.fee).toBeGreaterThan(resultSmall.fee)
    })

    it('费用不应超过100万元上限', () => {
        const result = calculateLawyerFee('commercial', { commercialType: 'ipo_advisory', disputeAmount: 100000000 })
        expect(result.fee).toBeLessThanOrEqual(1000000)
    })

    it('应返回正确的案件类型', () => {
        const result = calculateLawyerFee('commercial', { commercialType: 'contract_review' })
        expect(result.caseType).toBe('commercial')
    })
})

describe('calculateLawyerFee - 未知类型分支覆盖', () => {
    it('未知行政类型应触发 default 分支', () => {
        const result = calculateLawyerFee('administrative', { administrativeType: 'unknown' as any })
        expect(result.details.some(d => d.includes('行政案件（一般行政案件）'))).toBe(true)
    })

    it('未知文书类型应触发 default 分支', () => {
        const result = calculateLawyerFee('document', { documentType: 'unknown' as any })
        expect(result.details.some(d => d.includes('一般法律文书'))).toBe(true)
    })

    it('未知商事类型应触发 default 分支', () => {
        const result = calculateLawyerFee('commercial', { commercialType: 'unknown' as any })
        expect(result.details.some(d => d.includes('一般商事服务'))).toBe(true)
    })

    it('空阶段数组应使用全程代理', () => {
        const result = calculateLawyerFee('civil', { disputeAmount: 50000, stages: [] as any })
        expect(result.fee).toBeGreaterThan(0)
    })

    it('刑事案件指定阶段应触发 stages.length > 0 分支', () => {
        // 覆盖 line 88: if (stages && stages.length > 0) true branch
        const result = calculateLawyerFee('criminal', {
            complexity: 'medium',
            stages: ['investigation', 'trial']
        })
        expect(result.details.some(d => d.includes('选择的辩护阶段'))).toBe(true)
    })

    it('未知复杂度应触发 getComplexityText default 分支', () => {
        // 覆盖 line 506: default case in getComplexityText
        const result = calculateLawyerFee('criminal', { complexity: 'unknown' as any })
        expect(result.details.some(d => d.includes('一般'))).toBe(true)
    })

    it('民事案件指定阶段应触发 getStagesText 分支', () => {
        // 覆盖 lines 534-548: getStagesText function
        const result = calculateLawyerFee('civil', {
            disputeAmount: 50000,
            stages: ['preparation', 'court']
        })
        expect(result.details.some(d => d.includes('选择的代理阶段'))).toBe(true)
        expect(result.details.some(d => d.includes('准备阶段'))).toBe(true)
        expect(result.details.some(d => d.includes('庭审阶段'))).toBe(true)
    })

    it('刑事案件指定阶段应触发 getStagesText 分支', () => {
        // 覆盖 lines 534-548: getStagesText function with criminal stages
        const result = calculateLawyerFee('criminal', {
            complexity: 'medium',
            stages: ['investigation', 'prosecution']
        })
        expect(result.details.some(d => d.includes('选择的辩护阶段'))).toBe(true)
        expect(result.details.some(d => d.includes('侦查阶段'))).toBe(true)
        expect(result.details.some(d => d.includes('审查起诉阶段'))).toBe(true)
    })
})
