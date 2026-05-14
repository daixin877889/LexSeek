import { describe, it, expect } from 'vitest'
import { compensationCalculatorTool } from '#shared/utils/tools/agentTools/compensationCalculator.tool'

describe('compensationCalculatorTool', () => {
    it('toolDefinition.name 应为 calculate_compensation', () => {
        expect(compensationCalculatorTool.toolDefinition.name).toBe('calculate_compensation')
    })

    it('toolDefinition.description 应包含中文关键字', () => {
        expect(compensationCalculatorTool.toolDefinition.description).toContain('赔偿')
        expect(compensationCalculatorTool.toolDefinition.description).toContain('工伤')
    })

    it('toolDefinition.schema 应存在', () => {
        expect(compensationCalculatorTool.toolDefinition.schema).toBeDefined()
    })

    it('createTool 应正常创建工具实例', () => {
        const instance = compensationCalculatorTool.createTool({ userId: 1, sessionId: 'test' })
        expect(instance).toBeDefined()
    })

    it('工伤赔偿计算应返回正确结果', async () => {
        const instance = compensationCalculatorTool.createTool({ userId: 1, sessionId: 'test' })
        const result = await instance.invoke({
            type: 'workInjury',
            salary: 8000,
            disabilityLevel: 8,
            medicalExpenses: 20000,
            nursingExpenses: 5000,
            nutritionExpenses: 2000,
            disabilityCompensation: 0,
            lostIncome: 0,
            transportationExpenses: 0,
            accommodationExpenses: 0,
            propertyLoss: 0,
            annualIncome: 0,
            deathCompensationYears: 20,
            funeralExpenses: 0,
            dependentCompensation: 0,
            emotionalDamages: 0,
        })
        const parsed = JSON.parse(result as string)
        expect(parsed).toHaveProperty('totalCompensation')
        expect(parsed.totalCompensation).toBeGreaterThan(0)
    })
})
