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

import { createTool } from '#shared/utils/tools/agentTools/overtimePayCalculator.tool'

describe('overtimePayCalculator - 3 路径 + caseId 空', () => {
    beforeEach(() => {
        interruptMock.mockReset()
        writeMemoryMock.mockClear()
        findLastCalcMock.mockClear()
        findLastCalcMock.mockResolvedValue(null)
    })

    it('路径 A: 信息充足直算 + 写记忆', async () => {
        const tool = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await tool.invoke({ baseSalary: 10000, workdayOvertimeHours: 10 })
        expect(interruptMock).not.toHaveBeenCalled()
        const parsed = JSON.parse(r as string)
        expect(Number(parsed.totalOvertimePay)).toBeGreaterThan(0)
        expect(writeMemoryMock).toHaveBeenCalledWith(expect.objectContaining({
            kind: 'calculation',
            subjectKey: 'calculation:calculate_overtime_pay',
        }))
    })

    it('路径 B: 缺 baseSalary → interrupt → resume 后计算', async () => {
        interruptMock.mockReturnValue({ baseSalary: 10000, workdayOvertimeHours: 10 })
        const tool = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await tool.invoke({} as any)
        expect(interruptMock).toHaveBeenCalledWith(expect.objectContaining({
            type: 'calculator_input',
            toolName: 'calculate_overtime_pay',
            missing: expect.arrayContaining(['baseSalary']),
        }))
        expect(Number(JSON.parse(r as string).totalOvertimePay)).toBeGreaterThan(0)
    })

    it('路径 C: resume = null → 返回 cancelled', async () => {
        interruptMock.mockReturnValue(null)
        const tool = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await tool.invoke({} as any)
        expect(JSON.parse(r as string).cancelled).toBe(true)
        expect(writeMemoryMock).not.toHaveBeenCalled()
    })

    it('ctx.caseId 为空时跳过 L2 查询 + 跳过写入', async () => {
        const tool = createTool({ userId: 1, sessionId: 's1' })
        await tool.invoke({ baseSalary: 10000, workdayOvertimeHours: 10 })
        expect(findLastCalcMock).not.toHaveBeenCalled()
        expect(writeMemoryMock).not.toHaveBeenCalled()
    })
})
