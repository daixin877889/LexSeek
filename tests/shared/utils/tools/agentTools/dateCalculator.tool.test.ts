import { describe, it, expect, vi, beforeEach } from 'vitest'

const { interruptMock, writeMemoryMock, findLastCalcMock, calcDateAfterDaysMock, calcWorkingDaysMock, calcLimitationMock } =
    vi.hoisted(() => ({
        interruptMock: vi.fn(),
        writeMemoryMock: vi.fn().mockResolvedValue({ id: 'fake' }),
        findLastCalcMock: vi.fn().mockResolvedValue(null),
        calcDateAfterDaysMock: vi.fn(),
        calcWorkingDaysMock: vi.fn(),
        calcLimitationMock: vi.fn(),
    }))

vi.mock('@langchain/langgraph', () => ({ interrupt: interruptMock }))
vi.mock('~~/server/services/memory/memory.service', () => ({
    writeMemoryService: writeMemoryMock,
    findLastCalculationByCase: findLastCalcMock,
}))
vi.mock('#shared/utils/tools/dateCalculatorService', () => ({
    calculateDateAfterDays: calcDateAfterDaysMock,
    calculateDateAfterMonths: vi.fn().mockReturnValue({ resultDate: '2024-04-01', details: '加减3个月' }),
    calculateDateAfterYears: vi.fn().mockReturnValue({ resultDate: '2027-01-01', details: '加减3年' }),
    calculateWorkingDays: calcWorkingDaysMock,
    calculateLegalDeadline: vi.fn().mockReturnValue({ resultDate: '2024-02-01', details: '法定期限' }),
    calculateLimitationPeriod: calcLimitationMock,
}))

import { createTool } from '#shared/utils/tools/agentTools/dateCalculator.tool'

describe('dateCalculator - 路径 A/B/C + 分支覆盖', () => {
    beforeEach(() => {
        interruptMock.mockReset()
        writeMemoryMock.mockClear().mockResolvedValue({ id: 'fake' })
        findLastCalcMock.mockClear().mockResolvedValue(null)
        calcDateAfterDaysMock.mockReset().mockReturnValue({ resultDate: '2024-01-31', details: '加减30天' })
        calcWorkingDaysMock.mockReset().mockReturnValue({ workingDays: 21, details: '21个工作日' })
        calcLimitationMock.mockReset().mockReturnValue({ resultDate: '2027-01-01', years: 3, details: '3年诉讼时效' })
    })

    it('路径 A: addDays 信息充足直算 + 写记忆', async () => {
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await toolInstance.invoke({ mode: 'addDays', startDate: '2024-01-01', days: 30 })
        expect(interruptMock).not.toHaveBeenCalled()
        const parsed = JSON.parse(r as string)
        expect(parsed.resultDate).toBeDefined()
        expect(writeMemoryMock).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'calculation',
                subjectKey: 'calculation:calculate_date',
                extraMetadata: expect.objectContaining({
                    calculation: expect.objectContaining({ tool: 'calculate_date' }),
                }),
            }),
        )
    })

    it('路径 A: workingDays 信息充足直算', async () => {
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await toolInstance.invoke({ mode: 'workingDays', startDate: '2024-01-01', endDate: '2024-01-31' })
        expect(interruptMock).not.toHaveBeenCalled()
        const parsed = JSON.parse(r as string)
        expect(parsed.workingDays).toBeDefined()
    })

    it('路径 B: addDays 缺 startDate → interrupt', async () => {
        interruptMock.mockReturnValue({ startDate: '2024-01-01', days: 30 })
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        await toolInstance.invoke({ mode: 'addDays', days: 30 })
        expect(interruptMock).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'calculator_input',
                toolName: 'calculate_date',
                missing: expect.arrayContaining(['startDate']),
            }),
        )
    })

    it('路径 B: workingDays 缺 endDate → interrupt', async () => {
        interruptMock.mockReturnValue({ endDate: '2024-01-31' })
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        await toolInstance.invoke({ mode: 'workingDays', startDate: '2024-01-01' })
        expect(interruptMock).toHaveBeenCalledWith(
            expect.objectContaining({
                missing: expect.arrayContaining(['endDate']),
            }),
        )
    })

    it('路径 C: resume = null → 返回 cancelled', async () => {
        interruptMock.mockReturnValue(null)
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await toolInstance.invoke({ mode: 'addDays' })
        const parsed = JSON.parse(r as string)
        expect(parsed.cancelled).toBe(true)
        expect(writeMemoryMock).not.toHaveBeenCalled()
    })

    it('ctx.caseId 为空时跳过 L2 查询 + 跳过写入', async () => {
        const toolInstance = createTool({ userId: 1, sessionId: 's1' })
        await toolInstance.invoke({ mode: 'addDays', startDate: '2024-01-01', days: 30 })
        expect(findLastCalcMock).not.toHaveBeenCalled()
        expect(writeMemoryMock).not.toHaveBeenCalled()
    })
})
