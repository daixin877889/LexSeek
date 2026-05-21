/**
 * 诉讼费用计算服务测试
 *
 * 测试 calculateCourtFee 函数
 */
import { describe, it, expect } from 'vitest'
import { calculateCourtFee } from '#shared/utils/tools/courtFeeService'

describe('calculateCourtFee - 受理费', () => {
    describe('财产案件', () => {
        it('1万元以下每件50元', () => {
            const result = calculateCourtFee('caseFee', 'property', 5000)
            expect(result.totalFee).toBe(50)
        })

        it('1-10万按比例递增', () => {
            const result = calculateCourtFee('caseFee', 'property', 50000)
            expect(result.totalFee).toBe(50 + 40000 * 0.025)
        })

        it('10-20万按比例递增', () => {
            const result = calculateCourtFee('caseFee', 'property', 150000)
            expect(result.totalFee).toBeGreaterThan(50)
            expect(result.totalFee).toBeLessThan(150000)
        })

        it('20-50万按比例递增', () => {
            const result = calculateCourtFee('caseFee', 'property', 300000)
            expect(result.totalFee).toBeGreaterThan(0)
        })

        it('50-100万按比例递增', () => {
            const result = calculateCourtFee('caseFee', 'property', 800000)
            expect(result.totalFee).toBeGreaterThan(0)
        })

        it('100-200万按比例递增', () => {
            const result = calculateCourtFee('caseFee', 'property', 1500000)
            expect(result.totalFee).toBeGreaterThan(0)
        })

        it('200-500万按比例递增', () => {
            const result = calculateCourtFee('caseFee', 'property', 3000000)
            expect(result.totalFee).toBeGreaterThan(0)
        })

        it('500-1000万按比例递增', () => {
            const result = calculateCourtFee('caseFee', 'property', 8000000)
            expect(result.totalFee).toBeGreaterThan(0)
        })

        it('1000-2000万按比例递增', () => {
            const result = calculateCourtFee('caseFee', 'property', 15000000)
            expect(result.totalFee).toBeGreaterThan(0)
        })

        it('2000万以上按比例递增', () => {
            const result = calculateCourtFee('caseFee', 'property', 50000000)
            expect(result.totalFee).toBeGreaterThan(0)
        })

        it('金额为零应返回0', () => {
            const result = calculateCourtFee('caseFee', 'property', 0)
            expect(result.totalFee).toBe(0)
        })
    })

    describe('非财产案件', () => {
        it('离婚案件不涉及财产分割应为300元', () => {
            const result = calculateCourtFee('caseFee', 'nonProperty', 0, { nonPropertyType: 'divorce' })
            expect(result.totalFee).toBe(300)
        })

        it('离婚案件涉及财产分割应包含基本费用和财产费用', () => {
            const result = calculateCourtFee('caseFee', 'nonProperty', 50000, { nonPropertyType: 'divorce', hasProperty: true })
            expect(result.totalFee).toBeGreaterThan(300)
        })

        it('人格权案件不涉及损害赔偿应为300元', () => {
            const result = calculateCourtFee('caseFee', 'nonProperty', 0, { nonPropertyType: 'personality' })
            expect(result.totalFee).toBe(300)
        })

        it('人格权案件涉及损害赔偿应包含两部分费用', () => {
            const result = calculateCourtFee('caseFee', 'nonProperty', 50000, { nonPropertyType: 'personality', hasDamages: true })
            expect(result.totalFee).toBeGreaterThan(300)
        })

        it('其他非财产案件应为100元', () => {
            const result = calculateCourtFee('caseFee', 'nonProperty', 0, { nonPropertyType: 'other' })
            expect(result.totalFee).toBe(100)
        })
    })

    describe('知识产权案件', () => {
        it('无争议金额应为800元', () => {
            const result = calculateCourtFee('caseFee', 'intellectualProperty', 0)
            expect(result.totalFee).toBe(800)
        })

        it('有争议金额应按财产案件计算', () => {
            const result = calculateCourtFee('caseFee', 'intellectualProperty', 50000, { hasDisputeAmount: true })
            expect(result.totalFee).toBeGreaterThan(800)
        })
    })

    describe('劳动争议案件', () => {
        it('应为固定10元', () => {
            const result = calculateCourtFee('caseFee', 'labor', 0)
            expect(result.totalFee).toBe(10)
        })
    })

    describe('行政案件', () => {
        it('商标、专利、海事行政案件应为100元', () => {
            const result = calculateCourtFee('caseFee', 'administrative', 0, { administrativeType: 'special' })
            expect(result.totalFee).toBe(100)
        })

        it('其他行政案件应为50元', () => {
            const result = calculateCourtFee('caseFee', 'administrative', 0, { administrativeType: 'other' })
            expect(result.totalFee).toBe(50)
        })

        it('默认类型应为50元', () => {
            const result = calculateCourtFee('caseFee', 'administrative', 0, {})
            expect(result.totalFee).toBe(50)
        })
    })

    describe('管辖权异议', () => {
        it('应为100元', () => {
            const result = calculateCourtFee('caseFee', 'jurisdiction', 0)
            expect(result.totalFee).toBe(100)
        })
    })
})

describe('calculateCourtFee - 申请费', () => {
    describe('申请执行', () => {
        it('无执行金额应为50元', () => {
            const result = calculateCourtFee('applicationFee', 'execution', 0)
            expect(result.totalFee).toBe(50)
        })

        it('有执行金额应按比例计算', () => {
            const result = calculateCourtFee('applicationFee', 'execution', 100000, { hasExecutionAmount: true })
            expect(result.totalFee).toBeGreaterThan(50)
        })

        it('1万以下每件50元', () => {
            const result = calculateCourtFee('applicationFee', 'execution', 5000, { hasExecutionAmount: true })
            expect(result.totalFee).toBe(50)
        })
    })

    describe('申请保全', () => {
        it('不涉及财产应为30元', () => {
            const result = calculateCourtFee('applicationFee', 'preservation', 0)
            expect(result.totalFee).toBe(30)
        })

        it('涉及财产应按0.5%计算且有上下限', () => {
            const result = calculateCourtFee('applicationFee', 'preservation', 100000, { hasPreservationProperty: true })
            expect(result.totalFee).toBe(500)
            expect(result.totalFee).toBeLessThanOrEqual(5000)
        })

        it('保全费不应低于30元', () => {
            const result = calculateCourtFee('applicationFee', 'preservation', 1000, { hasPreservationProperty: true })
            expect(result.totalFee).toBe(30)
        })
    })

    describe('申请支付令', () => {
        it('应按1%计算且不超300元', () => {
            const result = calculateCourtFee('applicationFee', 'paymentOrder', 10000)
            expect(result.totalFee).toBe(100)
            expect(result.totalFee).toBeLessThanOrEqual(300)
        })

        it('大额支付令应限制在300元', () => {
            const result = calculateCourtFee('applicationFee', 'paymentOrder', 100000)
            expect(result.totalFee).toBe(300)
        })
    })

    describe('申请公示催告', () => {
        it('应为100元', () => {
            const result = calculateCourtFee('applicationFee', 'publicNotice', 0)
            expect(result.totalFee).toBe(100)
        })
    })

    describe('申请撤销仲裁裁决', () => {
        it('应为400元', () => {
            const result = calculateCourtFee('applicationFee', 'arbitration', 0)
            expect(result.totalFee).toBe(400)
        })
    })

    describe('申请破产', () => {
        it('应按0.5%计算且有上下限', () => {
            const result = calculateCourtFee('applicationFee', 'bankruptcy', 1000000)
            expect(result.totalFee).toBeGreaterThanOrEqual(500)
            expect(result.totalFee).toBeLessThanOrEqual(300000)
        })

        it('不应低于500元', () => {
            const result = calculateCourtFee('applicationFee', 'bankruptcy', 10000)
            expect(result.totalFee).toBe(500)
        })

        it('不应高于30万元', () => {
            const result = calculateCourtFee('applicationFee', 'bankruptcy', 100000000)
            expect(result.totalFee).toBe(300000)
        })
    })

    describe('海事案件', () => {
        it('申请设立海事赔偿责任限制基金', () => {
            const result = calculateCourtFee('applicationFee', 'maritime', 1000000, { maritimeType: 'fund' })
            expect(result.totalFee).toBe(1000)
        })

        it('申请海事强制令', () => {
            const result = calculateCourtFee('applicationFee', 'maritime', 0, { maritimeType: 'order' })
            expect(result.totalFee).toBe(1000)
        })

        it('申请船舶优先权催告', () => {
            const result = calculateCourtFee('applicationFee', 'maritime', 0, { maritimeType: 'notice' })
            expect(result.totalFee).toBe(1000)
        })

        it('申请海事债权登记', () => {
            const result = calculateCourtFee('applicationFee', 'maritime', 0, { maritimeType: 'register' })
            expect(result.totalFee).toBe(100)
        })

        it('申请共同海损理算', () => {
            const result = calculateCourtFee('applicationFee', 'maritime', 0, { maritimeType: 'average' })
            expect(result.totalFee).toBe(1000)
        })

        it('未指定类型应返回0', () => {
            const result = calculateCourtFee('applicationFee', 'maritime', 0, {})
            expect(result.totalFee).toBe(0)
        })
    })

    describe('函数默认参数兜底', () => {
        it('calculateCourtFee 省略 amount 参数应默认为 0', () => {
            // 触发 calculateCourtFee 的 amount 默认参数（=0）
            // 也连带触发内部 calculateCaseFee 的 amount 默认参数
            const result = calculateCourtFee('caseFee', 'labor' as any)
            expect(result.totalFee).toBe(10)
        })

        it('calculateCourtFee 省略 options 参数应默认为 {}', () => {
            // 触发 calculateCourtFee 的 options 默认参数
            // 也连带触发内部 calculateApplicationFee 的 options 默认参数
            const result = calculateCourtFee('applicationFee', 'publicNotice' as any, 0)
            expect(result.totalFee).toBe(100)
        })

        it('海事案件省略 amount 应默认为 0（针对 calculateMaritimeFee）', () => {
            // 触发 calculateMaritimeFee 的 amount 默认参数（=0）
            // 通过传 maritimeType=order（不依赖 amount）触发，但实际 amount 也会被默认为 0
            const result = calculateCourtFee('applicationFee', 'maritime', undefined as any, { maritimeType: 'order' })
            expect(result.totalFee).toBe(1000)
        })
    })

    describe('受理费默认分支兜底', () => {
        it('未指定有效受理费类型应返回 0 并附说明', () => {
            // 使用 as any 触发 switch 的 default 分支（业务上不会发生但作为契约保护）
            const result = calculateCourtFee('caseFee', 'unknown_type' as any, 1000)
            expect(result.totalFee).toBe(0)
            expect(result.details.some(d => d.includes('未指定有效的受理费类型'))).toBe(true)
        })
    })

    describe('申请费默认分支兜底', () => {
        it('未指定有效申请费类型应返回 0 并附说明', () => {
            const result = calculateCourtFee('applicationFee', 'unknown_type' as any, 1000)
            expect(result.totalFee).toBe(0)
            expect(result.details.some(d => d.includes('未指定有效的申请费类型'))).toBe(true)
        })
    })

    describe('申请执行费 - 各金额档位', () => {
        it('amount <= 0 应返回 0', () => {
            const result = calculateCourtFee('applicationFee', 'execution', 0, { hasExecutionAmount: true })
            expect(result.totalFee).toBe(0)
        })

        it('amount <= 1 万：固定 50 元', () => {
            const result = calculateCourtFee('applicationFee', 'execution', 5000, { hasExecutionAmount: true })
            expect(result.totalFee).toBe(50)
            expect(result.details.some(d => d.includes('不超过1万元的，每件交纳50元'))).toBe(true)
        })

        it('1 万 - 50 万：50 元 + (amount - 10000) × 1%', () => {
            const result = calculateCourtFee('applicationFee', 'execution', 100000, { hasExecutionAmount: true })
            expect(result.totalFee).toBe(Math.round(50 + (100000 - 10000) * 0.01))
            expect(result.details.some(d => d.includes('× 1%'))).toBe(true)
        })

        it('50 万 - 500 万：累进至 0.5% 段', () => {
            const result = calculateCourtFee('applicationFee', 'execution', 1000000, { hasExecutionAmount: true })
            const expected = Math.round(50 + (500000 - 10000) * 0.01 + (1000000 - 500000) * 0.005)
            expect(result.totalFee).toBe(expected)
            expect(result.details.some(d => d.includes('× 0.5%'))).toBe(true)
        })

        it('500 万 - 1000 万：累进至 0.1% 段', () => {
            const result = calculateCourtFee('applicationFee', 'execution', 8000000, { hasExecutionAmount: true })
            const expected = Math.round(50 + (500000 - 10000) * 0.01 + (5000000 - 500000) * 0.005 + (8000000 - 5000000) * 0.001)
            expect(result.totalFee).toBe(expected)
            expect(result.details.some(d => d.includes('× 0.1%'))).toBe(true)
        })

        it('1000 万以上：累进至 0.05% 段', () => {
            const result = calculateCourtFee('applicationFee', 'execution', 20000000, { hasExecutionAmount: true })
            const expected = Math.round(50 + (500000 - 10000) * 0.01 + (5000000 - 500000) * 0.005 + (10000000 - 5000000) * 0.001 + (20000000 - 10000000) * 0.0005)
            expect(result.totalFee).toBe(expected)
            expect(result.details.some(d => d.includes('× 0.05%'))).toBe(true)
        })
    })
})
