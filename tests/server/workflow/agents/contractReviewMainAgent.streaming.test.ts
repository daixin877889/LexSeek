/**
 * contractReviewMainAgent runAnalyzeLoop 单元测试
 *
 * 测试按条款循环逐条分析 + risk/progress 事件增量推送的行为。
 * 直接测 runAnalyzeLoop export，不涉及 agent.stream，避免整合层 mock 复杂度。
 *
 * **Feature: m6-1-contract-review Task 2.2**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock 整个 stageEmitter 模块
vi.mock('~~/server/services/workflow/nodes/contractReviewStageEmitter', () => ({
    emitContractReviewEvent: vi.fn().mockResolvedValue(undefined),
}))

// Mock analyzeSingleClause
vi.mock('~~/server/services/assistant/contract/analyzeSingleClause', () => ({
    analyzeSingleClause: vi.fn(),
}))

import { runAnalyzeLoop } from '~~/server/services/workflow/agents/contractReviewMainAgent'
import { emitContractReviewEvent } from '~~/server/services/workflow/nodes/contractReviewStageEmitter'
import { analyzeSingleClause } from '~~/server/services/assistant/contract/analyzeSingleClause'
import type { ClauseSegment, Risk } from '#shared/types/contract'

const emitterCtx = { runId: 'run-1', sessionId: 'sess-1' }

const mockSegments: ClauseSegment[] = [
    { index: 1, number: '1', text: '总则……' },
    { index: 2, number: '2', text: '付款条款……' },
    { index: 3, number: '3', text: '违约责任……' },
]

const riskHigh: Risk = {
    id: 'r2',
    clauseIndex: 2,
    clauseText: '付款条款……',
    level: 'high',
    category: '付款',
    problem: '付款期限不合理',
    analysis: '详细分析',
    risk: '风险点',
    suggestion: '建议',
}

const riskMedium: Risk = {
    id: 'r3',
    clauseIndex: 3,
    clauseText: '违约责任……',
    level: 'medium',
    category: '违约',
    problem: '违约金过低',
    analysis: '详细分析',
    risk: '风险点',
    suggestion: '建议',
}

describe('runAnalyzeLoop', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('按 clauseSegments 循环调用 analyzeSingleClause，每条发 progress + 命中风险发 risk', async () => {
        ;(analyzeSingleClause as any)
            .mockResolvedValueOnce(null)          // 第 1 条无风险
            .mockResolvedValueOnce(riskHigh)       // 第 2 条高风险
            .mockResolvedValueOnce(riskMedium)     // 第 3 条中风险

        const result = await runAnalyzeLoop({
            segments: mockSegments,
            stance: 'partyA',
            partyA: '甲方公司',
            partyB: '乙方公司',
            contractType: '服务合同',
            emitterCtx,
        })

        // 返回正确的 risks
        expect(result.risks).toHaveLength(2)
        expect(result.risks[0]!.id).toBe('r2')
        expect(result.risks[1]!.id).toBe('r3')
        expect(result.warnings).toHaveLength(0)

        // analyzeSingleClause 被调用 3 次
        expect(analyzeSingleClause).toHaveBeenCalledTimes(3)

        // progress 事件三次，current=1/2/3
        expect(emitContractReviewEvent).toHaveBeenCalledWith(
            emitterCtx,
            { type: 'progress', current: 1, total: 3 },
        )
        expect(emitContractReviewEvent).toHaveBeenCalledWith(
            emitterCtx,
            { type: 'progress', current: 2, total: 3 },
        )
        expect(emitContractReviewEvent).toHaveBeenCalledWith(
            emitterCtx,
            { type: 'progress', current: 3, total: 3 },
        )

        // risk 事件两次（第 1 条无风险跳过）
        expect(emitContractReviewEvent).toHaveBeenCalledWith(
            emitterCtx,
            { type: 'risk', risk: expect.objectContaining({ id: 'r2' }) },
        )
        expect(emitContractReviewEvent).toHaveBeenCalledWith(
            emitterCtx,
            { type: 'risk', risk: expect.objectContaining({ id: 'r3' }) },
        )

        // analyze:running 和 analyze:done 各发一次
        expect(emitContractReviewEvent).toHaveBeenCalledWith(
            emitterCtx,
            { type: 'stage', stage: 'analyze', status: 'running' },
        )
        expect(emitContractReviewEvent).toHaveBeenCalledWith(
            emitterCtx,
            { type: 'stage', stage: 'analyze', status: 'done', warnings: undefined },
        )
    })

    it('单条失败走 progress.error，其他条款继续，warnings 累积', async () => {
        ;(analyzeSingleClause as any)
            .mockRejectedValueOnce(new Error('zod 失败'))
            .mockResolvedValueOnce({ id: 'r2', level: 'low', clauseIndex: 2, clauseText: 'b', category: '其他', problem: 'p', analysis: 'a', risk: 'r', suggestion: 's' })

        const result = await runAnalyzeLoop({
            segments: [
                { index: 1, number: '1', text: 'a' },
                { index: 2, number: '2', text: 'b' },
            ],
            stance: 'neutral',
            partyA: null,
            partyB: null,
            contractType: null,
            emitterCtx,
        })

        // 第 1 条失败，第 2 条成功，risks 只有一条
        expect(result.risks).toHaveLength(1)
        expect(result.risks[0]!.id).toBe('r2')

        // warnings 包含第 1 条的错误信息
        expect(result.warnings).toHaveLength(1)
        expect(result.warnings[0]).toContain('zod 失败')

        // 发出了第 1 条的 progress.error
        expect(emitContractReviewEvent).toHaveBeenCalledWith(
            emitterCtx,
            expect.objectContaining({
                type: 'progress',
                current: 1,
                total: 2,
                error: expect.stringContaining('zod 失败'),
            }),
        )

        // analyze:done 携带 warnings
        expect(emitContractReviewEvent).toHaveBeenCalledWith(
            emitterCtx,
            expect.objectContaining({
                type: 'stage',
                stage: 'analyze',
                status: 'done',
                warnings: expect.arrayContaining([expect.stringContaining('zod 失败')]),
            }),
        )
    })
})
