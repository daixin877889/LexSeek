/**
 * 仲裁费用计算服务测试
 *
 * 测试 calculateArbitrationFee, getArbitrationFeeDescription 函数
 */
import { describe, it, expect } from 'vitest'
import { calculateArbitrationFee, getArbitrationFeeDescription } from '#shared/utils/tools/arbitrationFeeService'

describe('calculateArbitrationFee', () => {
    it('应正确计算1万元以下的仲裁费', () => {
        const result = calculateArbitrationFee(5000)
        expect(result.fee).toBe(100)
    })

    it('应正确计算1万至5万的仲裁费', () => {
        const result = calculateArbitrationFee(30000)
        const expected = Math.round(100 + (30000 - 10000) * 0.005)
        expect(result.fee).toBe(expected)
    })

    it('应正确计算5万至10万的仲裁费', () => {
        const result = calculateArbitrationFee(80000)
        const expected = Math.round(100 + 40000 * 0.005 + (80000 - 50000) * 0.004)
        expect(result.fee).toBe(expected)
    })

    it('应正确计算10万至20万的仲裁费', () => {
        const result = calculateArbitrationFee(150000)
        const expected = Math.round(100 + 40000 * 0.005 + 50000 * 0.004 + (150000 - 100000) * 0.003)
        expect(result.fee).toBe(expected)
    })

    it('应正确计算20万至50万的仲裁费', () => {
        const result = calculateArbitrationFee(400000)
        const expected = Math.round(100 + 40000 * 0.005 + 50000 * 0.004 + 100000 * 0.003 + (400000 - 200000) * 0.002)
        expect(result.fee).toBe(expected)
    })

    it('应正确计算50万至100万的仲裁费', () => {
        const result = calculateArbitrationFee(800000)
        const expected = Math.round(100 + 40000 * 0.005 + 50000 * 0.004 + 100000 * 0.003 + 300000 * 0.002 + (800000 - 500000) * 0.001)
        expect(result.fee).toBe(expected)
    })

    it('应正确计算100万以上的仲裁费', () => {
        const result = calculateArbitrationFee(2000000)
        const expected = Math.round(100 + 40000 * 0.005 + 50000 * 0.004 + 100000 * 0.003 + 300000 * 0.002 + 500000 * 0.001 + (2000000 - 1000000) * 0.0005)
        expect(result.fee).toBe(expected)
    })

    it('一线城市应应用1.2系数', () => {
        const result = calculateArbitrationFee(10000, 'tier1')
        expect(result.fee).toBe(Math.round(100 * 1.2))
    })

    it('二线城市应应用1.0系数', () => {
        const result = calculateArbitrationFee(10000, 'tier2')
        expect(result.fee).toBe(100)
    })

    it('三线城市应应用0.8系数', () => {
        const result = calculateArbitrationFee(10000, 'tier3')
        expect(result.fee).toBe(Math.round(100 * 0.8))
    })

    it('默认地区应为二线城市', () => {
        const result = calculateArbitrationFee(10000)
        expect(result.fee).toBe(100)
    })

    it('应包含争议金额', () => {
        const result = calculateArbitrationFee(50000)
        expect(result.disputeAmount).toBe(50000)
    })

    it('应包含计算明细', () => {
        const result = calculateArbitrationFee(50000)
        expect(result.details.length).toBeGreaterThan(0)
        expect(result.details.some(d => d.includes('争议金额'))).toBe(true)
        expect(result.details.some(d => d.includes('地区'))).toBe(true)
        expect(result.details.some(d => d.includes('基础仲裁费用'))).toBe(true)
        expect(result.details.some(d => d.includes('地区系数'))).toBe(true)
    })

    it('明细应包含最终仲裁费用', () => {
        const result = calculateArbitrationFee(50000)
        expect(result.details.some(d => d.includes('最终仲裁费用'))).toBe(true)
    })

    it('未知地区应触发 getRegionCoefficient 和 getRegionText 的 default 分支', () => {
        // 覆盖 lines 81, 99: default case in switch statements
        const result = calculateArbitrationFee(50000, 'unknown' as any)
        expect(result.fee).toBeGreaterThan(0)
        expect(result.details.some(d => d.includes('二线城市'))).toBe(true)
    })
})

describe('getArbitrationFeeDescription', () => {
    it('1万元以下应返回固定描述', () => {
        const desc = getArbitrationFeeDescription(5000)
        expect(desc).toBe('100元')
    })

    it('1万至5万应返回正确描述', () => {
        const desc = getArbitrationFeeDescription(30000)
        expect(desc).toContain('100元')
        expect(desc).toContain('0.5%')
    })

    it('5万至10万应返回正确描述', () => {
        const desc = getArbitrationFeeDescription(80000)
        expect(desc).toContain('0.4%')
    })

    it('10万至20万应返回正确描述', () => {
        const desc = getArbitrationFeeDescription(150000)
        expect(desc).toContain('0.3%')
    })

    it('20万至50万应返回正确描述', () => {
        const desc = getArbitrationFeeDescription(400000)
        expect(desc).toContain('0.2%')
    })

    it('50万至100万应返回正确描述', () => {
        const desc = getArbitrationFeeDescription(800000)
        expect(desc).toContain('0.1%')
    })

    it('100万以上应返回正确描述', () => {
        const desc = getArbitrationFeeDescription(2000000)
        expect(desc).toContain('0.05%')
    })
})
