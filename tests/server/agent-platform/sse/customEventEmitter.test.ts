import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createCustomEventEmitter } from '~~/server/services/agent-platform/sse/customEventEmitter'

vi.mock('~~/server/services/agent/agentEventBridge', () => ({
    publishCustomEvent: vi.fn().mockResolvedValue(undefined),
}))

describe('customEventEmitter', () => {
    beforeEach(() => vi.clearAllMocks())

    it('绑定 runId/sessionId 后只暴露 (name, data) 接口', async () => {
        const { publishCustomEvent } = await import('~~/server/services/agent/agentEventBridge')
        const emit = createCustomEventEmitter({ runId: 'run-1', sessionId: 'sess-1' })

        await emit({ name: 'contract_review', data: { type: 'stage', stage: 'detect', status: 'running' } })

        expect(publishCustomEvent).toHaveBeenCalledTimes(1)
        expect(publishCustomEvent).toHaveBeenCalledWith({
            type: 'custom_event',
            runId: 'run-1',
            sessionId: 'sess-1',
            name: 'contract_review',
            data: { type: 'stage', stage: 'detect', status: 'running' },
        })
    })

    it('runId 为 undefined 时使用 "unknown" 兜底', async () => {
        const { publishCustomEvent } = await import('~~/server/services/agent/agentEventBridge')
        const emit = createCustomEventEmitter({ runId: undefined, sessionId: 'sess-1' })
        await emit({ name: 'x', data: {} })
        expect(publishCustomEvent).toHaveBeenCalledWith(expect.objectContaining({ runId: 'unknown' }))
    })

    it('publishCustomEvent 失败时不抛错（fire-and-forget）', async () => {
        const { publishCustomEvent } = await import('~~/server/services/agent/agentEventBridge')
        ;(publishCustomEvent as any).mockRejectedValueOnce(new Error('boom'))
        const emit = createCustomEventEmitter({ runId: 'r', sessionId: 's' })
        await expect(emit({ name: 'x', data: {} })).resolves.toBeUndefined()
    })
})
