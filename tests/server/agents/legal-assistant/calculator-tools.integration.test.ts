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

import {
    getToolInstancesService,
    getAllToolNamesService,
} from '~~/server/services/agent-platform/tools/index'

describe('calculator-tools integration（agent-platform 注册表）', () => {
    beforeEach(() => {
        interruptMock.mockReset()
        writeMemoryMock.mockClear()
        findLastCalcMock.mockClear()
        findLastCalcMock.mockResolvedValue(null)
    })

    it('toolModules 注册表含 calculate_compensation', () => {
        expect(getAllToolNamesService()).toContain('calculate_compensation')
    })

    it('路径 A: 经注册表拿到 tool 实例直接调用', async () => {
        const [tool] = getToolInstancesService(
            ['calculate_compensation'],
            { userId: 1, caseId: 100, sessionId: 's1' },
        )
        const r = await tool!.invoke({ type: 'workInjury', salary: 12000, disabilityLevel: 8 })
        expect(interruptMock).not.toHaveBeenCalled()
        expect(JSON.parse(r as string).totalCompensation).toBeGreaterThan(0)
    })

    it('路径 B: 缺字段触发 interrupt → resume 用户填值', async () => {
        interruptMock.mockReturnValue({ salary: 12000, disabilityLevel: 8 })
        const [tool] = getToolInstancesService(
            ['calculate_compensation'],
            { userId: 1, caseId: 100, sessionId: 's1' },
        )
        const r = await tool!.invoke({ type: 'workInjury' })
        expect(interruptMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'calculator_input' }))
        expect(JSON.parse(r as string).totalCompensation).toBeGreaterThan(0)
    })

    it('路径 C: resume = null → cancelled', async () => {
        interruptMock.mockReturnValue(null)
        const [tool] = getToolInstancesService(
            ['calculate_compensation'],
            { userId: 1, caseId: 100, sessionId: 's1' },
        )
        const r = await tool!.invoke({ type: 'workInjury' })
        expect(JSON.parse(r as string).cancelled).toBe(true)
    })
})
