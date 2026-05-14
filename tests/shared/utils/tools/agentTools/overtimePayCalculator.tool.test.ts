import { describe, it, expect } from 'vitest'
import { overtimePayCalculatorTool } from '#shared/utils/tools/agentTools/overtimePayCalculator.tool'

describe('overtimePayCalculatorTool', () => {
    it('toolDefinition.name 应为 calculate_overtime_pay', () => {
        expect(overtimePayCalculatorTool.toolDefinition.name).toBe('calculate_overtime_pay')
    })

    it('toolDefinition.description 应包含中文关键字', () => {
        expect(overtimePayCalculatorTool.toolDefinition.description).toContain('加班费')
    })

    it('toolDefinition.schema 应存在', () => {
        expect(overtimePayCalculatorTool.toolDefinition.schema).toBeDefined()
    })

    it('createTool 应正常创建工具实例', () => {
        const instance = overtimePayCalculatorTool.createTool({ userId: 1, sessionId: 'test' })
        expect(instance).toBeDefined()
    })

    it('加班费计算应返回正确结果', async () => {
        const instance = overtimePayCalculatorTool.createTool({ userId: 1, sessionId: 'test' })
        const result = await instance.invoke({
            baseSalary: 10000,
            workdayOvertimeHours: 10,
            weekendOvertimeHours: 8,
            holidayOvertimeHours: 0,
            workdaysPerMonth: 21.75,
            hoursPerDay: 8,
        })
        const parsed = JSON.parse(result as string)
        expect(parsed).toHaveProperty('totalOvertimePay')
        expect(Number(parsed.totalOvertimePay)).toBeGreaterThan(0)
    })
})
