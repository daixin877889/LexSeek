import { describe, it, expect } from 'vitest'
import { socialInsuranceCalculatorTool } from '#shared/utils/tools/agentTools/socialInsuranceCalculator.tool'

describe('socialInsuranceCalculatorTool', () => {
    it('toolDefinition.name 应为 calculate_social_insurance_backpay', () => {
        expect(socialInsuranceCalculatorTool.toolDefinition.name).toBe('calculate_social_insurance_backpay')
    })

    it('toolDefinition.description 应包含中文关键字', () => {
        expect(socialInsuranceCalculatorTool.toolDefinition.description).toContain('社保')
        expect(socialInsuranceCalculatorTool.toolDefinition.description).toContain('追缴')
    })

    it('toolDefinition.schema 应存在', () => {
        expect(socialInsuranceCalculatorTool.toolDefinition.schema).toBeDefined()
    })

    it('createTool 应正常创建工具实例', () => {
        const instance = socialInsuranceCalculatorTool.createTool({ userId: 1, sessionId: 'test' })
        expect(instance).toBeDefined()
    })

    it('社保追缴计算应返回正确结果', async () => {
        const instance = socialInsuranceCalculatorTool.createTool({ userId: 1, sessionId: 'test' })
        const result = await instance.invoke({
            monthlySalary: 8000,
            months: 6,
            includeEmployerPart: true,
        })
        const parsed = JSON.parse(result as string)
        expect(parsed).toHaveProperty('totalBackpay')
        expect(parsed.totalBackpay).toBeGreaterThan(0)
    })
})
