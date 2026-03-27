/**
 * 离婚财产分割计算服务测试
 *
 * 测试 calculateDivorceProperty, calculateMaritalProperty 函数
 */
import { describe, it, expect } from 'vitest'
import { calculateDivorceProperty, calculateMaritalProperty } from '#shared/utils/tools/divorcePropertyService'

describe('calculateDivorceProperty', () => {
    it('应正确计算总资产', () => {
        const result = calculateDivorceProperty({ house: 1000000, car: 200000, savings: 500000 })
        expect(result.totalAssets).toBe(1700000)
    })

    it('应正确计算总债务', () => {
        const result = calculateDivorceProperty({}, { mortgage: 500000, carLoan: 100000 })
        expect(result.totalDebts).toBe(600000)
    })

    it('应正确计算净资产', () => {
        const result = calculateDivorceProperty({ savings: 1000000 }, { mortgage: 400000 })
        expect(result.netAssets).toBe(600000)
    })

    it('应正确计算丈夫和妻子的分配比例', () => {
        const result = calculateDivorceProperty({ savings: 1000000 }, {}, { husbandRatio: 0.6, wifeRatio: 0.4 })
        expect(result.husbandNetAssets).toBe(600000)
        expect(result.wifeNetAssets).toBe(400000)
    })

    it('默认分配比例应为50:50', () => {
        const result = calculateDivorceProperty({ savings: 1000000 })
        expect(result.husbandNetAssets).toBe(500000)
        expect(result.wifeNetAssets).toBe(500000)
    })

    it('有子女时应计算抚养费', () => {
        const result = calculateDivorceProperty({ savings: 1000000 }, {}, { hasChildren: true, childCustody: 'wife' })
        expect(result.childSupportAmount).toBeGreaterThan(0)
        expect(result.childSupportPayer).toBe('丈夫')
        expect(result.childSupportReceiver).toBe('妻子')
    })

    it('子女归丈夫时应由妻子支付抚养费', () => {
        const result = calculateDivorceProperty({ savings: 1000000 }, {}, { hasChildren: true, childCustody: 'husband' })
        expect(result.childSupportPayer).toBe('妻子')
        expect(result.childSupportReceiver).toBe('丈夫')
    })

    it('共同抚养时不应收取抚养费', () => {
        const result = calculateDivorceProperty({ savings: 1000000 }, {}, { hasChildren: true, childCustody: 'shared' })
        expect(result.childSupportAmount).toBe(0)
    })

    it('无资产和债务应返回零', () => {
        const result = calculateDivorceProperty()
        expect(result.totalAssets).toBe(0)
        expect(result.totalDebts).toBe(0)
        expect(result.netAssets).toBe(0)
    })

    it('净资产为负时丈夫和妻子分配应正确', () => {
        const result = calculateDivorceProperty({ savings: 100000 }, { mortgage: 200000 })
        expect(result.netAssets).toBe(-100000)
        expect(result.husbandNetAssets).toBe(-50000)
        expect(result.wifeNetAssets).toBe(-50000)
    })

    it('应包含详细计算明细', () => {
        const result = calculateDivorceProperty({ house: 1000000, car: 200000 }, { mortgage: 300000 })
        expect(result.details.length).toBeGreaterThan(0)
        expect(result.details.some(d => d.includes('房产'))).toBe(true)
        expect(result.details.some(d => d.includes('车辆'))).toBe(true)
        expect(result.details.some(d => d.includes('房贷'))).toBe(true)
    })

    it('明细应包含共同财产清单', () => {
        const result = calculateDivorceProperty({ house: 1000000 })
        expect(result.details.some(d => d.includes('共同财产清单'))).toBe(true)
    })

    it('明细应包含共同债务清单', () => {
        const result = calculateDivorceProperty({}, { mortgage: 500000 })
        expect(result.details.some(d => d.includes('共同债务清单'))).toBe(true)
    })

    it('明细应包含财产分割结果', () => {
        const result = calculateDivorceProperty({ savings: 1000000 })
        expect(result.details.some(d => d.includes('财产分割结果'))).toBe(true)
    })
})

describe('calculateMaritalProperty', () => {
    it('应正确计算丈夫婚前财产总额', () => {
        const result = calculateMaritalProperty({ house: 500000, car: 100000 }, {}, {})
        expect(result.husbandPreMaritalAssets).toBe(600000)
    })

    it('应正确计算妻子婚前财产总额', () => {
        const result = calculateMaritalProperty({}, { savings: 300000, investments: 200000 }, {})
        expect(result.wifePreMaritalAssets).toBe(500000)
    })

    it('应正确计算婚后共同财产总额', () => {
        const result = calculateMaritalProperty({}, {}, { house: 2000000, savings: 500000 })
        expect(result.jointTotalAssets).toBe(2500000)
    })

    it('应正确计算婚后共同财产增值', () => {
        const result = calculateMaritalProperty({ pre: 100000 }, {}, { joint: 500000 })
        expect(result.jointIncrease).toBe(500000 - 100000)
    })

    it('应包含详细计算明细', () => {
        const result = calculateMaritalProperty({ house: 500000 }, { car: 200000 }, { savings: 1000000 })
        expect(result.details.length).toBeGreaterThan(0)
        expect(result.details.some(d => d.includes('丈夫婚前财产'))).toBe(true)
        expect(result.details.some(d => d.includes('妻子婚前财产'))).toBe(true)
        expect(result.details.some(d => d.includes('婚后共同财产'))).toBe(true)
    })

    it('空参数应返回零值', () => {
        const result = calculateMaritalProperty()
        expect(result.husbandPreMaritalAssets).toBe(0)
        expect(result.wifePreMaritalAssets).toBe(0)
        expect(result.jointTotalAssets).toBe(0)
        expect(result.jointIncrease).toBe(0)
    })

    it('明细应包含丈夫婚前财产清单', () => {
        const result = calculateMaritalProperty({ house: 500000 })
        expect(result.details.some(d => d.includes('丈夫婚前财产：'))).toBe(true)
    })

    it('明细应包含妻子婚前财产清单', () => {
        const result = calculateMaritalProperty({}, { car: 200000 })
        expect(result.details.some(d => d.includes('妻子婚前财产：'))).toBe(true)
    })

    it('明细应包含婚后共同财产清单', () => {
        const result = calculateMaritalProperty({}, {}, { savings: 1000000 })
        expect(result.details.some(d => d.includes('婚后共同财产：'))).toBe(true)
    })

    it('明细应包含财产总额', () => {
        const result = calculateMaritalProperty({ house: 500000 })
        expect(result.details.some(d => d.includes('总额'))).toBe(true)
    })

    it('应处理资产值为 undefined 的情况（覆盖 value || 0 分支）', () => {
        // 覆盖 lines 145, 159: value || 0 当 value 为 undefined
        const result = calculateMaritalProperty({ house: undefined as any }, {}, {})
        expect(result.husbandPreMaritalAssets).toBe(0)
    })

    it('应处理资产值为 null 的情况（覆盖 value || 0 分支）', () => {
        // 覆盖 lines 145, 159: value || 0 当 value 为 null
        const result = calculateMaritalProperty({ house: null as any }, {}, {})
        expect(result.husbandPreMaritalAssets).toBe(0)
    })

    it('应处理资产值为 0 的情况（覆盖 value || 0 分支）', () => {
        // 覆盖 lines 145, 159: value || 0 当 value 为 0
        const result = calculateMaritalProperty({ house: 0 }, {}, {})
        expect(result.husbandPreMaritalAssets).toBe(0)
    })

    it('应处理妻子资产值为 undefined 的情况（覆盖 line 148 分支）', () => {
        const result = calculateMaritalProperty({}, { car: undefined as any }, {})
        expect(result.wifePreMaritalAssets).toBe(0)
    })

    it('应处理共同资产值为 undefined 的情况（覆盖 line 151 分支）', () => {
        const result = calculateMaritalProperty({}, {}, { savings: undefined as any })
        expect(result.jointTotalAssets).toBe(0)
    })

    it('应处理妻子资产值为 null 的情况（覆盖 line 163 分支）', () => {
        const result = calculateMaritalProperty({}, { car: null as any }, {})
        expect(result.details.some(d => d.includes('妻子婚前财产'))).toBe(true)
    })

    it('应处理共同资产值为 null 的情况（覆盖 line 167 分支）', () => {
        const result = calculateMaritalProperty({}, {}, { savings: null as any })
        expect(result.details.some(d => d.includes('婚后共同财产'))).toBe(true)
    })
})
