import { describe, it, expect } from 'vitest'
import { interestCalculatorTool } from '#shared/utils/tools/agentTools/interestCalculator.tool'

describe('interestCalculatorTool', () => {
    it('toolDefinition.name 应为 calculate_interest', () => {
        expect(interestCalculatorTool.toolDefinition.name).toBe('calculate_interest')
    })

    it('toolDefinition.description 应包含中文关键字', () => {
        expect(interestCalculatorTool.toolDefinition.description).toContain('利息')
        expect(interestCalculatorTool.toolDefinition.description).toContain('LPR')
    })

    it('toolDefinition.schema 应存在', () => {
        expect(interestCalculatorTool.toolDefinition.schema).toBeDefined()
    })

    it('createTool 应正常创建工具实例', () => {
        const instance = interestCalculatorTool.createTool({ userId: 1, sessionId: 'test' })
        expect(instance).toBeDefined()
    })

    it('simple 模式应返回利息计算结果', async () => {
        const instance = interestCalculatorTool.createTool({ userId: 1, sessionId: 'test' })
        const result = await instance.invoke({
            mode: 'simple',
            amount: 100000,
            startDate: '2023-01-01',
            endDate: '2024-01-01',
            annualRate: 4.35,
            adjustmentMethod: '无',
            adjustmentValue: 0,
            lprPeriod: 1,
            pbocPeriod: 2,
        })
        const parsed = JSON.parse(result as string)
        expect(parsed).toHaveProperty('interest')
        expect(parsed.interest).toBeGreaterThan(0)
    })
})
