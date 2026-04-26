/**
 * runAnalyzeLoop · playbook snapshot 透传测试
 *
 * **Feature: contract-review-playbook (M7)**
 * **Validates: Task 2.3 - playbookSnapshot 透传给每次 analyzeSingleClause**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock 必须在 import 之前声明；使用 vi.hoisted 解决闭包引用问题
const { analyzeSingleClauseMock } = vi.hoisted(() => ({
    analyzeSingleClauseMock: vi.fn(),
}))

vi.mock('~~/server/agents/contract/analyzeSingleClause', () => ({
    analyzeSingleClause: analyzeSingleClauseMock,
}))

// mock emitter（避免依赖 SSE）
vi.mock('~~/server/services/workflow/nodes/contractReviewStageEmitter', () => ({
    emitContractReviewEvent: vi.fn().mockResolvedValue(undefined),
}))

import { runAnalyzeLoop } from '~~/server/services/workflow/agents/contractReviewMainAgent'
import type { PlaybookSnapshot } from '#shared/types/contract'

describe('runAnalyzeLoop · playbook snapshot', () => {
    beforeEach(() => {
        analyzeSingleClauseMock.mockReset()
    })

    it('playbookSnapshot 透传给每次 analyzeSingleClause 调用', async () => {
        const snapshot: PlaybookSnapshot = {
            contractType: '劳动合同',
            snapshotAt: '2026-04-22T00:00:00Z',
            points: [
                { code: 'probation', title: '试用期', defaultLevel: 'high', stancePreference: 'strict', checkContent: 'c' },
            ],
        }
        analyzeSingleClauseMock.mockImplementation(async (ctx: any) => {
            if (ctx.clause.index === 1) {
                return {
                    id: 'r1', clauseIndex: 1, clauseText: ctx.clause.text,
                    level: 'high', category: 't', problem: 'p',
                    analysis: 'a', risk: 'r', suggestion: 's',
                    matchedPointCode: ctx.playbookSnapshot?.points[0]?.code,
                }
            }
            return null
        })

        const result = await runAnalyzeLoop({
            segments: [
                { index: 1, number: '1', text: 'x' },
                { index: 2, number: '2', text: 'y' },
            ],
            stance: 'partyB',
            partyA: 'A', partyB: 'B', contractType: '劳动合同',
            playbookSnapshot: snapshot,
            emitterCtx: { runId: 'run1', sessionId: 'sess1' },
        })

        expect(result.risks).toHaveLength(1)
        expect(result.risks[0]!.matchedPointCode).toBe('probation')
        // 两次 analyzeSingleClause 调用都收到 snapshot
        expect(analyzeSingleClauseMock).toHaveBeenCalledTimes(2)
        expect(analyzeSingleClauseMock.mock.calls[0]![0]).toMatchObject({ playbookSnapshot: snapshot })
        expect(analyzeSingleClauseMock.mock.calls[1]![0]).toMatchObject({ playbookSnapshot: snapshot })
    })

    it('playbookSnapshot 不传时下游收到 undefined', async () => {
        analyzeSingleClauseMock.mockResolvedValue(null)
        await runAnalyzeLoop({
            segments: [{ index: 1, number: '1', text: 'x' }],
            stance: 'neutral',
            partyA: null, partyB: null, contractType: '其他',
            emitterCtx: { runId: '', sessionId: 'sess2' },
        })
        expect(analyzeSingleClauseMock.mock.calls[0]![0].playbookSnapshot).toBeUndefined()
    })
})
