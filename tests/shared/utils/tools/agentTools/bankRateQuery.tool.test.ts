import { describe, it, expect } from 'vitest'
import { bankRateQueryTool } from '#shared/utils/tools/agentTools/bankRateQuery.tool'

describe('bankRateQueryTool', () => {
    it('toolDefinition.name 应为 query_bank_rate', () => {
        expect(bankRateQueryTool.toolDefinition.name).toBe('query_bank_rate')
    })

    it('toolDefinition.description 应包含中文关键字', () => {
        expect(bankRateQueryTool.toolDefinition.description).toContain('利率')
        expect(bankRateQueryTool.toolDefinition.description).toContain('LPR')
    })

    it('toolDefinition.schema 应存在', () => {
        expect(bankRateQueryTool.toolDefinition.schema).toBeDefined()
    })

    it('createTool 应正常创建工具实例', () => {
        const instance = bankRateQueryTool.createTool({ userId: 1, sessionId: 'test' })
        expect(instance).toBeDefined()
    })

    it('查询全部最新利率应返回结果', async () => {
        const instance = bankRateQueryTool.createTool({ userId: 1, sessionId: 'test' })
        const result = await instance.invoke({ queryType: 'all' })
        const parsed = JSON.parse(result as string)
        expect(parsed).toHaveProperty('lpr')
        expect(parsed).toHaveProperty('depositRate')
        expect(parsed).toHaveProperty('loanRate')
    })

    it('查询 LPR 利率应返回数据', async () => {
        const instance = bankRateQueryTool.createTool({ userId: 1, sessionId: 'test' })
        const result = await instance.invoke({ queryType: 'lpr' })
        const parsed = JSON.parse(result as string)
        expect(parsed).not.toBeNull()
    })
})
