import { describe, it, expect, vi, beforeEach } from 'vitest'

const { interruptMock, writeMemoryMock, findLastCalcMock, calcCourtFeeMock } =
    vi.hoisted(() => ({
        interruptMock: vi.fn(),
        writeMemoryMock: vi.fn().mockResolvedValue({ id: 'fake' }),
        findLastCalcMock: vi.fn().mockResolvedValue(null),
        calcCourtFeeMock: vi.fn(),
    }))

vi.mock('@langchain/langgraph', () => ({ interrupt: interruptMock }))
vi.mock('~~/server/services/memory/memory.service', () => ({
    writeMemoryService: writeMemoryMock,
    findLastCalculationByCase: findLastCalcMock,
}))
vi.mock('#shared/utils/tools/courtFeeService', () => ({
    calculateCourtFee: calcCourtFeeMock,
}))

import { createTool } from '#shared/utils/tools/agentTools/courtFeeCalculator.tool'

describe('courtFeeCalculator - 路径 A/B/C + 嵌套校验', () => {
    const defaultResult = {
        totalFee: 5000,
        details: ['受理费：5000元'],
    }

    beforeEach(() => {
        interruptMock.mockReset()
        writeMemoryMock.mockClear().mockResolvedValue({ id: 'fake' })
        findLastCalcMock.mockClear().mockResolvedValue(null)
        calcCourtFeeMock.mockReset().mockReturnValue(defaultResult)
    })

    it('路径 A: caseFee+财产案件 信息充足直算 + 写记忆', async () => {
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await toolInstance.invoke({
            feeTypeLevel1: 'caseFee',
            caseFeeType: 'property',
            amount: 100000,
        })
        expect(interruptMock).not.toHaveBeenCalled()
        const parsed = JSON.parse(r as string)
        expect(parsed.totalFee).toBeGreaterThan(0)
        expect(writeMemoryMock).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'calculation',
                subjectKey: 'calculation:calculate_court_fee',
                extraMetadata: expect.objectContaining({
                    calculation: expect.objectContaining({ tool: 'calculate_court_fee' }),
                }),
            }),
        )
    })

    it('路径 A: applicationFee 信息充足直算', async () => {
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await toolInstance.invoke({
            feeTypeLevel1: 'applicationFee',
            applicationFeeType: 'execution',
            amount: 50000,
        })
        expect(interruptMock).not.toHaveBeenCalled()
        expect(calcCourtFeeMock).toHaveBeenCalled()
        const parsed = JSON.parse(r as string)
        expect(parsed.totalFee).toBeDefined()
    })

    it('路径 A: caseFee+非财产（other）无需 amount 直算', async () => {
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await toolInstance.invoke({
            feeTypeLevel1: 'caseFee',
            caseFeeType: 'nonProperty',
            nonPropertyType: 'other',
        })
        expect(interruptMock).not.toHaveBeenCalled()
        const parsed = JSON.parse(r as string)
        expect(parsed.totalFee).toBeDefined()
    })

    it('路径 B: caseFee 缺 caseFeeType → interrupt', async () => {
        interruptMock.mockReturnValue({ caseFeeType: 'property', amount: 100000 })
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        await toolInstance.invoke({ feeTypeLevel1: 'caseFee' })
        expect(interruptMock).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'calculator_input',
                toolName: 'calculate_court_fee',
                missing: expect.arrayContaining(['caseFeeType']),
            }),
        )
    })

    it('路径 B: caseFee+非财产 缺 nonPropertyType → interrupt', async () => {
        interruptMock.mockReturnValue({ nonPropertyType: 'divorce' })
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        await toolInstance.invoke({ feeTypeLevel1: 'caseFee', caseFeeType: 'nonProperty' })
        expect(interruptMock).toHaveBeenCalledWith(
            expect.objectContaining({
                missing: expect.arrayContaining(['nonPropertyType']),
            }),
        )
    })

    it('路径 B: caseFee+财产案件 缺 amount → interrupt', async () => {
        interruptMock.mockReturnValue({ amount: 100000 })
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        await toolInstance.invoke({ feeTypeLevel1: 'caseFee', caseFeeType: 'property' })
        expect(interruptMock).toHaveBeenCalledWith(
            expect.objectContaining({
                missing: expect.arrayContaining(['amount']),
            }),
        )
    })

    it('路径 C: resume = null → 返回 cancelled', async () => {
        interruptMock.mockReturnValue(null)
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await toolInstance.invoke({ feeTypeLevel1: 'caseFee' })
        const parsed = JSON.parse(r as string)
        expect(parsed.cancelled).toBe(true)
        expect(writeMemoryMock).not.toHaveBeenCalled()
    })

    it('ctx.caseId 为空时跳过 L2 查询 + 跳过写入', async () => {
        const toolInstance = createTool({ userId: 1, sessionId: 's1' })
        await toolInstance.invoke({ feeTypeLevel1: 'caseFee', caseFeeType: 'property', amount: 100000 })
        expect(findLastCalcMock).not.toHaveBeenCalled()
        expect(writeMemoryMock).not.toHaveBeenCalled()
    })
})
