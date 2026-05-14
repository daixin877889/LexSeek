import { describe, it, expect, vi, beforeEach } from 'vitest'

const { interruptMock, writeMemoryMock, findLastCalcMock } = vi.hoisted(() => ({
    interruptMock: vi.fn(),
    writeMemoryMock: vi.fn().mockResolvedValue({ id: 'fake' }),
    findLastCalcMock: vi.fn().mockResolvedValue(null),
}))

vi.mock('@langchain/langgraph', () => ({ interrupt: interruptMock }))
vi.mock('~~/server/services/memory/memory.service', () => ({
    writeMemoryService: writeMemoryMock,
    findLastCalculationByCase: findLastCalcMock,
}))

import { createTool } from '#shared/utils/tools/agentTools/divorcePropertyCalculator.tool'

describe('divorcePropertyCalculator - 3 路径 + caseId 空', () => {
    beforeEach(() => {
        interruptMock.mockReset()
        writeMemoryMock.mockClear()
        findLastCalcMock.mockClear()
        findLastCalcMock.mockResolvedValue(null)
    })

    it('路径 A: 有资产数据直算 + 写记忆', async () => {
        const tool = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await tool.invoke({ house: 1000000, savings: 200000, mortgage: 500000 })
        expect(interruptMock).not.toHaveBeenCalled()
        const parsed = JSON.parse(r as string)
        expect(parsed.netAssets).toBeDefined()
        expect(writeMemoryMock).toHaveBeenCalledWith(expect.objectContaining({
            kind: 'calculation',
            subjectKey: 'calculation:calculate_divorce_property',
        }))
    })

    it('路径 B: 无资产数据 → interrupt → resume 后计算', async () => {
        interruptMock.mockReturnValue({ house: 1000000, savings: 200000 })
        const tool = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        // 所有资产/负债均为 0（默认值），触发 interrupt
        const r = await tool.invoke({ house: 0, car: 0, savings: 0, investments: 0, otherAssets: 0,
                                       mortgage: 0, carLoan: 0, creditCard: 0, otherDebts: 0 } as any)
        expect(interruptMock).toHaveBeenCalledWith(expect.objectContaining({
            type: 'calculator_input',
            toolName: 'calculate_divorce_property',
            missing: expect.arrayContaining(['house']),
        }))
        const parsed = JSON.parse(r as string)
        expect(parsed.netAssets).toBeDefined()
    })

    it('路径 C: resume = null → 返回 cancelled', async () => {
        interruptMock.mockReturnValue(null)
        const tool = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await tool.invoke({ house: 0, car: 0, savings: 0, investments: 0, otherAssets: 0,
                                       mortgage: 0, carLoan: 0, creditCard: 0, otherDebts: 0 } as any)
        expect(JSON.parse(r as string).cancelled).toBe(true)
        expect(writeMemoryMock).not.toHaveBeenCalled()
    })

    it('ctx.caseId 为空时跳过 L2 查询 + 跳过写入', async () => {
        const tool = createTool({ userId: 1, sessionId: 's1' })
        await tool.invoke({ house: 1000000, savings: 200000 })
        expect(findLastCalcMock).not.toHaveBeenCalled()
        expect(writeMemoryMock).not.toHaveBeenCalled()
    })
})
