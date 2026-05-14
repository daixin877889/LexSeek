import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted: 项目惯用模式，防止 vi.resetModules 后 mock 引用失效
const { interruptMock, writeMemoryMock, findLastCalcMock, calcWorkInjuryMock, calcTrafficMock, calcDeathMock } =
    vi.hoisted(() => ({
        interruptMock: vi.fn(),
        writeMemoryMock: vi.fn().mockResolvedValue({ id: 'fake' }),
        findLastCalcMock: vi.fn().mockResolvedValue(null),
        // 计算服务 mock（路径 A/B/C 需要返回真实结构，test 7 模拟抛错）
        calcWorkInjuryMock: vi.fn(),
        calcTrafficMock: vi.fn(),
        calcDeathMock: vi.fn(),
    }))

vi.mock('@langchain/langgraph', () => ({ interrupt: interruptMock }))
vi.mock('~~/server/services/memory/memory.service', () => ({
    writeMemoryService: writeMemoryMock,
    findLastCalculationByCase: findLastCalcMock,
}))
vi.mock('#shared/utils/tools/compensationService', () => ({
    calculateWorkInjuryCompensation: calcWorkInjuryMock,
    calculateTrafficAccidentCompensation: calcTrafficMock,
    calculateDeathCompensation: calcDeathMock,
}))

import { createTool } from '#shared/utils/tools/agentTools/compensationCalculator.tool'

describe('compensationCalculator - 路径 A/B/C + 边界', () => {
    // 工伤计算的默认返回值（12000 月薪 × 8级 → 11个月 = 132000）
    const defaultWorkInjuryResult = {
        disabilityCompensation: 132000,
        medicalExpenses: 0,
        nursingExpenses: 0,
        nutritionExpenses: 0,
        totalCompensation: 132000,
        details: ['月工资：12000元', '伤残等级：8级', '总赔偿金：132000元'],
    }

    beforeEach(() => {
        interruptMock.mockReset()
        writeMemoryMock.mockClear().mockResolvedValue({ id: 'fake' })
        findLastCalcMock.mockClear().mockResolvedValue(null)
        calcWorkInjuryMock.mockReset().mockReturnValue(defaultWorkInjuryResult)
        calcTrafficMock.mockReset().mockReturnValue({ totalCompensation: 50000, details: [] })
        calcDeathMock.mockReset().mockReturnValue({ totalCompensation: 200000, details: [] })
    })

    it('路径 A: 信息充足直算 + 写记忆', async () => {
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await toolInstance.invoke({ type: 'workInjury', salary: 12000, disabilityLevel: 8 })
        expect(interruptMock).not.toHaveBeenCalled()
        const parsed = JSON.parse(r as string)
        expect(parsed.totalCompensation).toBeGreaterThan(0)
        expect(writeMemoryMock).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'calculation',
                subjectKey: 'calculation:calculate_compensation',
                extraMetadata: expect.objectContaining({
                    calculation: expect.objectContaining({ tool: 'calculate_compensation' }),
                }),
            }),
        )
    })

    it('路径 B: 缺字段 → interrupt → resume 后计算', async () => {
        interruptMock.mockReturnValue({ salary: 12000, disabilityLevel: 8 })
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await toolInstance.invoke({ type: 'workInjury' })
        expect(interruptMock).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'calculator_input',
                toolName: 'calculate_compensation',
                missing: expect.arrayContaining(['salary', 'disabilityLevel']),
            }),
        )
        const parsed = JSON.parse(r as string)
        expect(parsed.totalCompensation).toBeGreaterThan(0)
    })

    it('路径 C: resume = null → 返回 cancelled', async () => {
        interruptMock.mockReturnValue(null)
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await toolInstance.invoke({ type: 'workInjury' })
        const parsed = JSON.parse(r as string)
        expect(parsed.cancelled).toBe(true)
        expect(writeMemoryMock).not.toHaveBeenCalled()
    })

    it('ctx.caseId 为空时跳过 L2 查询 + 跳过写入', async () => {
        const toolInstance = createTool({ userId: 1, sessionId: 's1' }) // 无 caseId
        await toolInstance.invoke({ type: 'workInjury', salary: 12000, disabilityLevel: 8 })
        expect(findLastCalcMock).not.toHaveBeenCalled()
        expect(writeMemoryMock).not.toHaveBeenCalled()
    })

    it('resume payload 非法（非 object 非 null）抛错', async () => {
        interruptMock.mockReturnValue('invalid_string')
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        await expect(toolInstance.invoke({ type: 'workInjury' })).rejects.toThrow(/resume payload 非法/)
    })

    it('边界 - zod 失败：LLM 不传 type', async () => {
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        await expect(toolInstance.invoke({} as any)).rejects.toThrow()
    })

    it('边界 - service 抛错时工具返回 error JSON 不阻塞', async () => {
        calcWorkInjuryMock.mockImplementationOnce(() => {
            throw new Error('calculation service error')
        })
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await toolInstance.invoke({ type: 'workInjury', salary: 12000, disabilityLevel: 8 })
        const parsed = JSON.parse(r as string)
        expect(parsed.error).toBeDefined()
        expect(writeMemoryMock).not.toHaveBeenCalled()
    })

    it('边界 - 写记忆失败不阻塞结果', async () => {
        writeMemoryMock.mockRejectedValueOnce(new Error('DB down'))
        const toolInstance = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await toolInstance.invoke({ type: 'workInjury', salary: 12000, disabilityLevel: 8 })
        const parsed = JSON.parse(r as string)
        expect(parsed.totalCompensation).toBeGreaterThan(0) // 结果仍返回
    })
})
