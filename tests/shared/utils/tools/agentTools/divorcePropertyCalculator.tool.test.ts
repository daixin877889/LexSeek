import { describe, it, expect } from 'vitest'
import { divorcePropertyCalculatorTool } from '#shared/utils/tools/agentTools/divorcePropertyCalculator.tool'

describe('divorcePropertyCalculatorTool', () => {
    it('toolDefinition.name 应为 calculate_divorce_property', () => {
        expect(divorcePropertyCalculatorTool.toolDefinition.name).toBe('calculate_divorce_property')
    })

    it('toolDefinition.description 应包含中文关键字', () => {
        expect(divorcePropertyCalculatorTool.toolDefinition.description).toContain('离婚')
        expect(divorcePropertyCalculatorTool.toolDefinition.description).toContain('财产')
    })

    it('toolDefinition.schema 应存在', () => {
        expect(divorcePropertyCalculatorTool.toolDefinition.schema).toBeDefined()
    })

    it('createTool 应正常创建工具实例', () => {
        const instance = divorcePropertyCalculatorTool.createTool({ userId: 1, sessionId: 'test' })
        expect(instance).toBeDefined()
    })

    it('工具执行应返回离婚财产分割结果', async () => {
        const instance = divorcePropertyCalculatorTool.createTool({ userId: 1, sessionId: 'test' })
        const result = await instance.invoke({
            house: 1000000,
            car: 100000,
            savings: 200000,
            investments: 0,
            otherAssets: 0,
            mortgage: 500000,
            carLoan: 0,
            creditCard: 0,
            otherDebts: 0,
            husbandRatio: 0.5,
            wifeRatio: 0.5,
            hasChildren: false,
            childCustody: 'shared',
        })
        const parsed = JSON.parse(result as string)
        expect(parsed).toHaveProperty('netAssets')
        expect(parsed.netAssets).toBe(800000)
    })
})
