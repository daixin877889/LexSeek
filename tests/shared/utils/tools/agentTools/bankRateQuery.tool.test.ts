import { describe, it, expect } from 'vitest'
import { toolDefinition, createTool } from '#shared/utils/tools/agentTools/bankRateQuery.tool'

describe('bankRateQuery - 纯查询工具（无 interrupt / 无写记忆）', () => {
    it('toolDefinition.name 应为 query_bank_rate', () => {
        expect(toolDefinition.name).toBe('query_bank_rate')
    })

    it('createTool 注册表反向调用 + 查询全部最新利率返回结果', async () => {
        const instance = createTool({ userId: 1, sessionId: 'test' })
        const result = await instance.invoke({ queryType: 'all' })
        const parsed = JSON.parse(result as string)
        expect(parsed).toHaveProperty('lpr')
        expect(parsed).toHaveProperty('depositRate')
        expect(parsed).toHaveProperty('loanRate')
    })

    it('查询 LPR 利率应返回数据', async () => {
        const instance = createTool({ userId: 1, sessionId: 'test' })
        const result = await instance.invoke({ queryType: 'lpr' })
        const parsed = JSON.parse(result as string)
        expect(parsed).not.toBeNull()
    })

    it('查询存款基准利率应返回数据', async () => {
        const instance = createTool({ userId: 1, sessionId: 'test' })
        const result = await instance.invoke({ queryType: 'deposit' })
        const parsed = JSON.parse(result as string)
        expect(parsed).not.toBeNull()
    })

    it('查询贷款基准利率应返回数据', async () => {
        const instance = createTool({ userId: 1, sessionId: 'test' })
        const result = await instance.invoke({ queryType: 'loan' })
        const parsed = JSON.parse(result as string)
        expect(parsed).not.toBeNull()
    })
})
