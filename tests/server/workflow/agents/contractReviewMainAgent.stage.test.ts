import { describe, it, expect, vi, beforeEach } from 'vitest'
import { emitContractReviewEvent } from '~~/server/services/workflow/nodes/contractReviewStageEmitter'

vi.mock('~~/server/services/agent/agentEventBridge', () => ({
    publishCustomEvent: vi.fn().mockResolvedValue(undefined),
}))

describe('contractReviewStageEmitter', () => {
    beforeEach(() => vi.clearAllMocks())

    it('emit stage:detect,running 正确包装为 AgentCustomEvent', async () => {
        const { publishCustomEvent } = await import('~~/server/services/agent/agentEventBridge')
        await emitContractReviewEvent(
            { runId: 'run-1', sessionId: 'sess-1' },
            { type: 'stage', stage: 'detect', status: 'running' },
        )
        expect(publishCustomEvent).toHaveBeenCalledWith({
            type: 'custom_event',
            runId: 'run-1',
            sessionId: 'sess-1',
            name: 'contract_review',
            data: { type: 'stage', stage: 'detect', status: 'running' },
        })
    })

    it('publishCustomEvent 抛错时不向上传播', async () => {
        const { publishCustomEvent } = await import('~~/server/services/agent/agentEventBridge')
        ;(publishCustomEvent as any).mockRejectedValueOnce(new Error('redis down'))
        await expect(emitContractReviewEvent(
            { runId: 'run-2', sessionId: 'sess-2' },
            { type: 'progress', current: 1, total: 10 },
        )).resolves.toBeUndefined()
    })
})
