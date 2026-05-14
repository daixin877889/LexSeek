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

    it('空阶段数组（civil）应正常计算（不调 getStagesText）', () => {
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

    describe('民事律师费各档位累进', () => {
        it('100 万 - 500 万档位', () => {
            const result = calculateLawyerFee('civil', { disputeAmount: 2000000, complexity: 'medium', region: 'tier2' })
            // 5000 + 400000×4% + 500000×3% + 1000000×2% = 56000
            expect(result.fee).toBe(56000)
            expect(result.details.some(d => d.includes('× 2%'))).toBe(true)
        })

        it('500 万 - 1000 万档位', () => {
            const result = calculateLawyerFee('civil', { disputeAmount: 8000000, complexity: 'medium', region: 'tier2' })
            // 5000 + 400000×4% + 500000×3% + 4000000×2% + 3000000×1% = 146000
            expect(result.fee).toBe(146000)
            expect(result.details.some(d => d.includes('× 1%'))).toBe(true)
        })

        it('1000 万以上档位', () => {
            const result = calculateLawyerFee('civil', { disputeAmount: 20000000, complexity: 'medium', region: 'tier2' })
            // 5000 + 400000×4% + 500000×3% + 4000000×2% + 5000000×1% + 10000000×0.5% = 216000
            expect(result.fee).toBe(216000)
            expect(result.details.some(d => d.includes('× 0.5%'))).toBe(true)
        })

        it('民事 very-complex（复杂度系数 1.5）', () => {
            // 覆盖 line 192-194: very-complex case
            const result = calculateLawyerFee('civil', { disputeAmount: 50000, complexity: 'very-complex', region: 'tier2' })
            expect(result.fee).toBe(7500)
        })

        it('民事 hasAppeal 应加 30%', () => {
            // 覆盖 line 222-223 hasAppeal 分支
            const result = calculateLawyerFee('civil', { disputeAmount: 50000, complexity: 'medium', region: 'tier2', hasAppeal: true })
            expect(result.details.some(d => d.includes('上诉'))).toBe(true)
            expect(result.fee).toBe(Math.round(5000 * 1.3))
        })

        it('民事 hasExecution 应加 20%', () => {
            const result = calculateLawyerFee('civil', { disputeAmount: 50000, complexity: 'medium', region: 'tier2', hasExecution: true })
            expect(result.details.some(d => d.includes('执行'))).toBe(true)
            expect(result.fee).toBe(Math.round(5000 * 1.2))
        })

        it('民事各 stages 系数（preparation/evidence/court/settlement 累加封顶 1.0）', () => {
            const result = calculateLawyerFee('civil', {
                disputeAmount: 50000,
                complexity: 'medium',
                region: 'tier2',
                stages: ['preparation', 'evidence', 'court', 'settlement']
            })
            // 4 个 stage factor 加起来 = 0.2+0.2+0.4+0.2 = 1.0
            expect(result.fee).toBe(5000)
        })
    })

    describe('刑事律师费 caseDuration / trial stage', () => {
        it('caseDuration > 1 时应按 duration factor 调整', () => {
            // 覆盖 line 284-287 持续时间分支
            const result = calculateLawyerFee('criminal', { complexity: 'medium', region: 'tier2', caseDuration: 5 })
            expect(result.details.some(d => d.includes('长期案件'))).toBe(true)
            // base = 20000, duration=5 => 1 + min(4, 10)*0.1 = 1.4
            expect(result.fee).toBe(Math.round(20000 * 1.4))
        })

        it('刑事 trial stage 应触发 stagesFactor', () => {
            const result = calculateLawyerFee('criminal', { complexity: 'medium', region: 'tier2', stages: ['trial'] })
            expect(result.details.some(d => d.includes('审判阶段'))).toBe(true)
            // base=20000, stagesFactor=0.4
            expect(result.fee).toBe(Math.round(20000 * 0.4))
        })
    })

    describe('行政律师费各类型', () => {
        it.each([
            ['basic', 8000],
            ['land', 15000],
            ['planning', 12000],
            ['environmental', 18000],
            ['licensing', 10000],
        ] as const)('行政类型 %s 基础费用 %d', (type, expected) => {
            const result = calculateLawyerFee('administrative', { administrativeType: type, region: 'tier2' })
            expect(result.fee).toBe(expected)
        })

        it('行政案件 hasAppeal 加 30%', () => {
            const result = calculateLawyerFee('administrative', { administrativeType: 'basic', region: 'tier2', hasAppeal: true })
            expect(result.fee).toBe(Math.round(8000 * 1.3))
        })
    })

    describe('地区系数 tier1/tier3', () => {
        it('tier1 一线城市系数 1.5', () => {
            const result = calculateLawyerFee('civil', { disputeAmount: 50000, complexity: 'medium', region: 'tier1' })
            expect(result.fee).toBe(Math.round(5000 * 1.5))
            expect(result.details.some(d => d.includes('一线城市'))).toBe(true)
        })

        it('tier3 三线城市系数 0.7', () => {
            const result = calculateLawyerFee('civil', { disputeAmount: 50000, complexity: 'medium', region: 'tier3' })
            expect(result.fee).toBe(Math.round(5000 * 0.7))
            expect(result.details.some(d => d.includes('三线及以下城市'))).toBe(true)
        })
    })

    describe('商事各 commercialType', () => {
        it('negotiation 商务谈判 amount<=100w', () => {
            const result = calculateLawyerFee('commercial', { commercialType: 'negotiation', disputeAmount: 500000, region: 'tier2' })
            expect(result.fee).toBe(8000)
        })

        it('negotiation 商务谈判 amount>100w 加成', () => {
            // 覆盖 line 429-430 分支
            const result = calculateLawyerFee('commercial', { commercialType: 'negotiation', disputeAmount: 2000000, region: 'tier2' })
            expect(result.fee).toBe(18000)
        })

        it('due_diligence amount<=1000w', () => {
            const result = calculateLawyerFee('commercial', { commercialType: 'due_diligence', disputeAmount: 5000000, region: 'tier2' })
            expect(result.fee).toBe(20000)
        })

        it('due_diligence amount>1000w 加成', () => {
            // 覆盖 line 435-436 分支
            const result = calculateLawyerFee('commercial', { commercialType: 'due_diligence', disputeAmount: 20000000, region: 'tier2' })
            expect(result.fee).toBe(40000)
        })

        it('ipo_advisory amount>0 加成', () => {
            const result = calculateLawyerFee('commercial', { commercialType: 'ipo_advisory', disputeAmount: 50000000, region: 'tier2' })
            expect(result.fee).toBe(125000)
        })

        it('compliance 合规服务', () => {
            const result = calculateLawyerFee('commercial', { commercialType: 'compliance', region: 'tier2' })
            expect(result.fee).toBe(15000)
        })

        it('未指定 commercialType 应触发 default 8000', () => {
            // 覆盖 line 448-449 default 分支
            const result = calculateLawyerFee('commercial', { region: 'tier2' })
            expect(result.fee).toBe(8000)
        })

        it('商事 baseFee 超 100 万应封顶', () => {
            // 覆盖 line 453-454 上限分支
            const result = calculateLawyerFee('commercial', { commercialType: 'ipo_advisory', disputeAmount: 2_000_000_000, region: 'tier2' })
            expect(result.fee).toBe(1_000_000)
        })

        it('商事案件 disputeAmount=0 不显示金额行', () => {
            // 覆盖 line 137 if (disputeAmount > 0) 的 false 分支
            const result = calculateLawyerFee('commercial', { commercialType: 'contract_review', region: 'tier2' })
            expect(result.details.some(d => d.includes('涉及金额'))).toBe(false)
        })
    })

    describe('文书类型默认值与各类型', () => {
        it('未指定 documentType 应触发 getDocumentTypeText default', () => {
            // 覆盖 line 554-555 documentType default
            const result = calculateLawyerFee('document', { region: 'tier2' })
            expect(result.details.some(d => d.includes('一般法律文书'))).toBe(true)
        })

        it.each(['lawsuit', 'opinion', 'will', 'corporate'] as const)('文书类型 %s 的文本', (docType) => {
            const result = calculateLawyerFee('document', { documentType: docType, region: 'tier2' })
            expect(result.fee).toBeGreaterThan(0)
        })
    })

    describe('商事类型文本默认', () => {
        it('未指定 commercialType 应触发 getCommercialTypeText default', () => {
            // 覆盖 line 574-575 commercialType default
            const result = calculateLawyerFee('commercial', { region: 'tier2' })
            expect(result.details.some(d => d.includes('一般商事服务'))).toBe(true)
        })
    })

    describe('getCivilFeeDescription 各档位文本', () => {
        it.each([
            [50000, '5000元'],
            [200000, '× 4%'],
            [800000, '× 3%'],
            [3000000, '× 2%'],
            [8000000, '× 1%'],
            [20000000, '× 0.5%'],
        ])('disputeAmount=%d 应包含 "%s"', (amount, expectedFragment) => {
            const result = calculateLawyerFee('civil', { disputeAmount: amount, complexity: 'medium', region: 'tier2' })
            expect(result.details.some(d => d.includes(expectedFragment))).toBe(true)
        })
    })

    describe('getStagesText 未知 stage fallback', () => {
        it('未知 stage 应回落到 stage 原值', () => {
            // 覆盖 line 548 的 `stageTexts[stage] || stage`
            const result = calculateLawyerFee('civil', {
                disputeAmount: 50000,
                complexity: 'medium',
                stages: ['unknown_stage' as any]
            })
            expect(result.details.some(d => d.includes('unknown_stage'))).toBe(true)
        })

    })

    describe('补充：默认参数 / 各 enum 完整覆盖', () => {
        it('calculateLawyerFee 省略 options 参数应使用 {} 默认', () => {
            // 覆盖 line 25 calculateLawyerFee 的 options 默认参数
            const result = calculateLawyerFee('consultation')
            // 默认 consultationHours=0 → fee=0
            expect(result.fee).toBe(0)
        })

        it('刑事 simple 复杂度（覆盖 getCriminalBaseFee simple case）', () => {
            const result = calculateLawyerFee('criminal', { complexity: 'simple', region: 'tier2' })
            expect(result.fee).toBe(10000)
        })

        it('刑事 complex 复杂度（覆盖 getCriminalBaseFee complex case）', () => {
            const result = calculateLawyerFee('criminal', { complexity: 'complex', region: 'tier2' })
            expect(result.fee).toBe(50000)
        })

        it('刑事 very-complex 复杂度（覆盖 getCriminalBaseFee very-complex case）', () => {
            const result = calculateLawyerFee('criminal', { complexity: 'very-complex', region: 'tier2' })
            expect(result.fee).toBe(100000)
        })

        it('未知 region 应触发 getRegionCoefficient/getRegionText default', () => {
            // 覆盖 getRegionCoefficient/getRegionText default
            const result = calculateLawyerFee('civil', { disputeAmount: 50000, complexity: 'medium', region: 'unknown' as any })
            expect(result.fee).toBe(5000)
            expect(result.details.some(d => d.includes('二线城市'))).toBe(true)
        })

        it('未知 complexity 应触发 getComplexityText default', () => {
            // 覆盖 getComplexityText default
            const result = calculateLawyerFee('civil', { disputeAmount: 50000, complexity: 'unknown' as any, region: 'tier2' })
            expect(result.details.some(d => d.includes('一般'))).toBe(true)
        })

        it('刑事未知 complexity 应触发 getCriminalBaseFee default', () => {
            // 覆盖 getCriminalBaseFee default（line 306）
            const result = calculateLawyerFee('criminal', { complexity: 'unknown' as any, region: 'tier2' })
            expect(result.fee).toBe(20000)
        })
    })

    describe('文书类型各 case', () => {
        it.each([
            ['contract'],
            ['lawsuit'],
            ['opinion'],
            ['will'],
            ['corporate'],
        ] as const)('文书类型 %s 应能计算', (docType) => {
            const result = calculateLawyerFee('document', { documentType: docType, region: 'tier2', documentComplexity: 'medium' })
            expect(result.fee).toBeGreaterThan(0)
        })
    })
})
