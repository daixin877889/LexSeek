import { describe, it, expect } from 'vitest'
import { lawyerFeeCalculatorTool } from '#shared/utils/tools/agentTools/lawyerFeeCalculator.tool'

describe('lawyerFeeCalculatorTool', () => {
    it('toolDefinition.name 应为 calculate_lawyer_fee', () => {
        expect(lawyerFeeCalculatorTool.toolDefinition.name).toBe('calculate_lawyer_fee')
    })

    it('toolDefinition.description 应包含中文关键字', () => {
        expect(lawyerFeeCalculatorTool.toolDefinition.description).toContain('律师费')
    })

    it('toolDefinition.schema 应存在', () => {
        expect(lawyerFeeCalculatorTool.toolDefinition.schema).toBeDefined()
    })

    it('createTool 应正常创建工具实例', () => {
        const instance = lawyerFeeCalculatorTool.createTool({ userId: 1, sessionId: 'test' })
        expect(instance).toBeDefined()
    })

    it('民事案件律师费计算应返回正确结果', async () => {
        const instance = lawyerFeeCalculatorTool.createTool({ userId: 1, sessionId: 'test' })
        const result = await instance.invoke({
            caseType: 'civil',
            disputeAmount: 500000,
            complexity: 'medium',
            region: 'tier2',
            hasAppeal: false,
            hasExecution: false,
            consultationHours: 0,
            caseDuration: 6,
        })
        const parsed = JSON.parse(result as string)
        expect(parsed).toHaveProperty('fee')
        expect(parsed.fee).toBeGreaterThan(0)
    })
})
