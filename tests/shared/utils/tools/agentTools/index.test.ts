import { describe, it, expect } from 'vitest'
import { allCalculatorTools } from '#shared/utils/tools/agentTools/index'

describe('allCalculatorTools', () => {
    it('应包含 10 个工具', () => {
        expect(allCalculatorTools.length).toBe(10)
    })

    it('每个工具应有 toolDefinition 和 createTool', () => {
        for (const t of allCalculatorTools) {
            expect(t.toolDefinition).toBeDefined()
            expect(t.toolDefinition.name).toBeTruthy()
            expect(t.toolDefinition.description).toBeTruthy()
            expect(t.toolDefinition.schema).toBeDefined()
            expect(typeof t.createTool).toBe('function')
        }
    })

    it('工具名称应全部不重复', () => {
        const names = allCalculatorTools.map((t) => t.toolDefinition.name)
        const unique = new Set(names)
        expect(unique.size).toBe(names.length)
    })
})
