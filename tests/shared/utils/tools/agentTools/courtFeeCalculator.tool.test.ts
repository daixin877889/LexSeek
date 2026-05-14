import { describe, it, expect } from 'vitest'
import { courtFeeCalculatorTool } from '#shared/utils/tools/agentTools/courtFeeCalculator.tool'

describe('courtFeeCalculatorTool', () => {
    it('toolDefinition.name 应为 calculate_court_fee', () => {
        expect(courtFeeCalculatorTool.toolDefinition.name).toBe('calculate_court_fee')
    })

    it('toolDefinition.description 应包含中文关键字', () => {
        expect(courtFeeCalculatorTool.toolDefinition.description).toContain('诉讼费')
        expect(courtFeeCalculatorTool.toolDefinition.description).toContain('受理费')
    })

    it('toolDefinition.schema 应存在', () => {
        expect(courtFeeCalculatorTool.toolDefinition.schema).toBeDefined()
    })

    it('createTool 应正常创建工具实例', () => {
        const instance = courtFeeCalculatorTool.createTool({ userId: 1, sessionId: 'test' })
        expect(instance).toBeDefined()
    })

    it('财产案件受理费计算应返回正确结果', async () => {
        const instance = courtFeeCalculatorTool.createTool({ userId: 1, sessionId: 'test' })
        const result = await instance.invoke({
            feeTypeLevel1: 'caseFee',
            feeTypeLevel2: 'property',
            amount: 100000,
        })
        const parsed = JSON.parse(result as string)
        expect(parsed).toHaveProperty('totalFee')
        expect(parsed.totalFee).toBeGreaterThan(0)
    })
})
