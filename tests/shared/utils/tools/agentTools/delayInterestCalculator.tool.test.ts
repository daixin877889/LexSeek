import { describe, it, expect } from 'vitest'
import { delayInterestCalculatorTool } from '#shared/utils/tools/agentTools/delayInterestCalculator.tool'

describe('delayInterestCalculatorTool', () => {
    it('toolDefinition.name 应为 calculate_delay_interest', () => {
        expect(delayInterestCalculatorTool.toolDefinition.name).toBe('calculate_delay_interest')
    })

    it('toolDefinition.description 应包含中文关键字', () => {
        expect(delayInterestCalculatorTool.toolDefinition.description).toContain('迟延')
        expect(delayInterestCalculatorTool.toolDefinition.description).toContain('利息')
    })

    it('toolDefinition.schema 应存在', () => {
        expect(delayInterestCalculatorTool.toolDefinition.schema).toBeDefined()
    })

    it('createTool 应正常创建工具实例', () => {
        const instance = delayInterestCalculatorTool.createTool({ userId: 1, sessionId: 'test' })
        expect(instance).toBeDefined()
    })

    it('工具执行应返回迟延利息计算结果', async () => {
        const instance = delayInterestCalculatorTool.createTool({ userId: 1, sessionId: 'test' })
        const result = await instance.invoke({
            amount: 100000,
            startDate: '2023-01-01',
            endDate: '2024-01-01',
        })
        const parsed = JSON.parse(result as string)
        expect(parsed).toHaveProperty('totalInterest')
        expect(parsed.totalInterest).toBeGreaterThan(0)
    })
})
