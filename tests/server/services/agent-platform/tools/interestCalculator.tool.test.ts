import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted: 防止 vi.resetModules 后 mock 引用失效
const { interruptMock, writeMemoryMock, findLastCalcMock, calcLPRMock, calcPBOCMock, calcSimpleMock } =
    vi.hoisted(() => ({
        interruptMock: vi.fn(),
        writeMemoryMock: vi.fn().mockResolvedValue({ id: 'fake' }),
        findLastCalcMock: vi.fn().mockResolvedValue(null),
        calcLPRMock: vi.fn(),
        calcPBOCMock: vi.fn(),
        calcSimpleMock: vi.fn(),
    }))

vi.mock('@langchain/langgraph', () => ({ interrupt: interruptMock }))
vi.mock('~~/server/services/memory/memory.service', () => ({
    writeMemoryService: writeMemoryMock,
    findLastCalculationByCase: findLastCalcMock,
}))
vi.mock('#shared/utils/tools/interestService', () => ({
    calculateLPRInterest: calcLPRMock,
    calculatePBOCInterest: calcPBOCMock,
    calculateSimpleInterest: calcSimpleMock,
}))

import { createTool } from '~~/server/services/agent-platform/tools/interestCalculator.tool'

describe('interestCalculator - 路径 A/B/C + 边界', () => {
    const defaultResult = {
        amount: 100000,
        totalInterest: 4350,
        total: 104350,
        details: ['本金：100000元', '利息：4350元'],
    }

    beforeEach(() => {
        interruptMock.mockReset()
        writeMemoryMock.mockClear().mockResolvedValue({ id: 'fake' })
        findLastCalcMock.mockClear().mockResolvedValue(null)
        calcLPRMock.mockReset().mockReturnValue(defaultResult)
        calcPBOCMock.mockReset().mockReturnValue(defaultResult)
        calcSimpleMock.mockReset().mockReturnValue(defaultResult)
    })

    it('路径 A: simple 模式信息充足直算 + 写记忆', async () => {
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await toolInstance.invoke({
            mode: 'simple',
            amount: 100000,
            startDate: '2023-01-01',
            endDate: '2024-01-01',
            annualRate: 4.35,
        })
        expect(interruptMock).not.toHaveBeenCalled()
        const parsed = JSON.parse(r as string)
        expect(parsed.totalInterest).toBeGreaterThan(0)
        expect(writeMemoryMock).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'calculation',
                subjectKey: 'calculation:calculate_interest',
                extraMetadata: expect.objectContaining({
                    calculation: expect.objectContaining({ tool: 'calculate_interest' }),
                }),
            }),
        )
    })

    it('路径 A: lpr 模式信息充足直算', async () => {
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await toolInstance.invoke({
            mode: 'lpr',
            amount: 50000,
            startDate: '2023-01-01',
            endDate: '2024-01-01',
            lprPeriod: 1,
            yearDays: '365',
        })
        expect(interruptMock).not.toHaveBeenCalled()
        expect(calcLPRMock).toHaveBeenCalled()
        const parsed = JSON.parse(r as string)
        expect(parsed.totalInterest).toBeDefined()
    })

    it('路径 B: 缺 amount/startDate/endDate → interrupt → resume 后计算', async () => {
        interruptMock.mockReturnValue({ amount: 100000, startDate: '2023-01-01', endDate: '2024-01-01' })
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await toolInstance.invoke({ mode: 'lpr' })
        expect(interruptMock).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'calculator_input',
                toolName: 'calculate_interest',
                missing: expect.arrayContaining(['amount', 'startDate', 'endDate']),
            }),
        )
        const parsed = JSON.parse(r as string)
        expect(parsed.totalInterest).toBeDefined()
    })

    it('路径 B: simple 缺 annualRate → interrupt', async () => {
        interruptMock.mockReturnValue({ annualRate: 5.0 })
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        await toolInstance.invoke({ mode: 'simple', amount: 100000, startDate: '2023-01-01', endDate: '2024-01-01' })
        expect(interruptMock).toHaveBeenCalledWith(
            expect.objectContaining({
                missing: expect.arrayContaining(['annualRate']),
            }),
        )
    })

    it('路径 B: lpr 未传 yearDays 必触发 interrupt，prefilled 预选 365', async () => {
        interruptMock.mockReturnValue({ yearDays: '365' })
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        await toolInstance.invoke({
            mode: 'lpr',
            amount: 50000,
            startDate: '2023-01-01',
            endDate: '2024-01-01',
            lprPeriod: 1,
        })
        expect(interruptMock).toHaveBeenCalledWith(
            expect.objectContaining({
                missing: expect.arrayContaining(['yearDays']),
                prefilled: expect.objectContaining({ yearDays: '365' }),
            }),
        )
    })

    it('路径 B: 用户明示 yearDays=360 时 prefilled 不被 365 覆盖', async () => {
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        await toolInstance.invoke({
            mode: 'lpr',
            amount: 50000,
            startDate: '2023-01-01',
            endDate: '2024-01-01',
            lprPeriod: 1,
            yearDays: '360',
        })
        // 用户已明示 → yearDays 不进 missing，根本不应触发 interrupt
        expect(interruptMock).not.toHaveBeenCalled()
        expect(calcLPRMock).toHaveBeenCalledWith(
            expect.anything(), expect.anything(), expect.anything(), expect.anything(),
            expect.anything(), expect.anything(), '360',
        )
    })

    it('路径 C: resume = null → 返回 cancelled', async () => {
        interruptMock.mockReturnValue(null)
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await toolInstance.invoke({ mode: 'lpr' })
        const parsed = JSON.parse(r as string)
        expect(parsed.cancelled).toBe(true)
        expect(writeMemoryMock).not.toHaveBeenCalled()
    })

    it('ctx.caseId 为空时跳过 L2 查询 + 跳过写入', async () => {
        const toolInstance = createTool({ userId: 1, sessionId: 's1' })
        await toolInstance.invoke({ mode: 'simple', amount: 100000, startDate: '2023-01-01', endDate: '2024-01-01', annualRate: 4 })
        expect(findLastCalcMock).not.toHaveBeenCalled()
        expect(writeMemoryMock).not.toHaveBeenCalled()
    })
})
