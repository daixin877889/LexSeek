import { describe, it, expect, vi, beforeEach } from 'vitest'

const { interruptMock, writeMemoryMock, findLastCalcMock, calcLawyerFeeMock } =
    vi.hoisted(() => ({
        interruptMock: vi.fn(),
        writeMemoryMock: vi.fn().mockResolvedValue({ id: 'fake' }),
        findLastCalcMock: vi.fn().mockResolvedValue(null),
        calcLawyerFeeMock: vi.fn(),
    }))

vi.mock('@langchain/langgraph', () => ({ interrupt: interruptMock }))
vi.mock('~~/server/services/memory/memory.service', () => ({
    writeMemoryService: writeMemoryMock,
    findLastCalculationByCase: findLastCalcMock,
}))
vi.mock('#shared/utils/tools/lawyerFeeService', () => ({
    calculateLawyerFee: calcLawyerFeeMock,
}))

import { createTool } from '~~/server/services/agent-platform/tools/lawyerFeeCalculator.tool'

describe('lawyerFeeCalculator - 路径 A/B/C + 分支覆盖', () => {
    const defaultResult = {
        fee: 20000,
        caseType: 'civil',
        details: ['律师费：20000元'],
    }

    beforeEach(() => {
        interruptMock.mockReset()
        writeMemoryMock.mockClear().mockResolvedValue({ id: 'fake' })
        findLastCalcMock.mockClear().mockResolvedValue(null)
        calcLawyerFeeMock.mockReset().mockReturnValue(defaultResult)
    })

    it('路径 A: civil 信息充足直算 + 写记忆', async () => {
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await toolInstance.invoke({ caseType: 'civil', disputeAmount: 500000 })
        expect(interruptMock).not.toHaveBeenCalled()
        const parsed = JSON.parse(r as string)
        expect(parsed.fee).toBeGreaterThan(0)
        expect(writeMemoryMock).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'calculation',
                subjectKey: 'calculation:calculate_lawyer_fee',
                extraMetadata: expect.objectContaining({
                    calculation: expect.objectContaining({ tool: 'calculate_lawyer_fee' }),
                }),
            }),
        )
    })

    it('路径 A: consultation 提供 consultationHours 直算', async () => {
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await toolInstance.invoke({ caseType: 'consultation', consultationHours: 3 })
        expect(interruptMock).not.toHaveBeenCalled()
        expect(calcLawyerFeeMock).toHaveBeenCalled()
        const parsed = JSON.parse(r as string)
        expect(parsed.fee).toBeDefined()
    })

    it('路径 B: civil 缺 disputeAmount → interrupt', async () => {
        interruptMock.mockReturnValue({ disputeAmount: 500000 })
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        await toolInstance.invoke({ caseType: 'civil' })
        expect(interruptMock).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'calculator_input',
                toolName: 'calculate_lawyer_fee',
                missing: expect.arrayContaining(['disputeAmount']),
            }),
        )
    })

    it('路径 B: criminal 缺 caseDuration → interrupt', async () => {
        interruptMock.mockReturnValue({ caseDuration: 6 })
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        await toolInstance.invoke({ caseType: 'criminal' })
        expect(interruptMock).toHaveBeenCalledWith(
            expect.objectContaining({
                missing: expect.arrayContaining(['caseDuration']),
            }),
        )
    })

    it('路径 C: resume = null → 返回 cancelled', async () => {
        interruptMock.mockReturnValue(null)
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await toolInstance.invoke({ caseType: 'civil' })
        const parsed = JSON.parse(r as string)
        expect(parsed.cancelled).toBe(true)
        expect(writeMemoryMock).not.toHaveBeenCalled()
    })

    it('ctx.caseId 为空时跳过 L2 查询 + 跳过写入', async () => {
        const toolInstance = createTool({ userId: 1, sessionId: 's1' })
        await toolInstance.invoke({ caseType: 'civil', disputeAmount: 100000 })
        expect(findLastCalcMock).not.toHaveBeenCalled()
        expect(writeMemoryMock).not.toHaveBeenCalled()
    })
})
