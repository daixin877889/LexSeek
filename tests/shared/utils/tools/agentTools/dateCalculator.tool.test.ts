import { describe, it, expect } from 'vitest'
import { dateCalculatorTool } from '#shared/utils/tools/agentTools/dateCalculator.tool'

describe('dateCalculatorTool', () => {
    it('toolDefinition.name 应为 calculate_date', () => {
        expect(dateCalculatorTool.toolDefinition.name).toBe('calculate_date')
    })

    it('toolDefinition.description 应包含中文关键字', () => {
        expect(dateCalculatorTool.toolDefinition.description).toContain('日期')
        expect(dateCalculatorTool.toolDefinition.description).toContain('诉讼时效')
    })

    it('toolDefinition.schema 应存在', () => {
        expect(dateCalculatorTool.toolDefinition.schema).toBeDefined()
    })

    it('createTool 应正常创建工具实例', () => {
        const instance = dateCalculatorTool.createTool({ userId: 1, sessionId: 'test' })
        expect(instance).toBeDefined()
    })

    it('addDays 模式应正确计算日期', async () => {
        const instance = dateCalculatorTool.createTool({ userId: 1, sessionId: 'test' })
        const result = await instance.invoke({
            mode: 'addDays',
            startDate: '2024-01-01',
            days: 30,
            excludeHolidays: true,
            limitationType: 'general',
        })
        const parsed = JSON.parse(result as string)
        expect(parsed).toHaveProperty('resultDate')
        expect(parsed.resultDate).toBe('2024-01-31')
    })

    it('limitation 模式应正确计算诉讼时效', async () => {
        const instance = dateCalculatorTool.createTool({ userId: 1, sessionId: 'test' })
        const result = await instance.invoke({
            mode: 'limitation',
            startDate: '2024-01-01',
            limitationType: 'general',
            excludeHolidays: true,
        })
        const parsed = JSON.parse(result as string)
        expect(parsed).toHaveProperty('resultDate')
        expect(parsed.years).toBe(3)
    })
})
