/**
 * contractReviewStageEmitter 单元测试
 *
 * **Feature: contract-review-stage-events**
 * **Validates: emitContractReviewEvent 包装 ContractReviewEvent，
 *  优先走 ctx.platformEmit（阶段 4），否则 fallback 到 publishCustomEvent**
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SSECustomEventType } from '#shared/types/agentEvent'

// vi.mock hoisted：必须在被测模块 import 之前 mock 依赖
const { mockPublishCustomEvent } = vi.hoisted(() => ({
    mockPublishCustomEvent: vi.fn(),
}))
vi.mock('~~/server/services/agent/agentEventBridge', () => ({
    publishCustomEvent: mockPublishCustomEvent,
}))

const { mockLogger } = vi.hoisted(() => ({
    mockLogger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}))
vi.mock('#shared/utils/logger', () => ({ logger: mockLogger }))

import { emitContractReviewEvent } from '~~/server/services/workflow/nodes/contractReviewStageEmitter'

describe('emitContractReviewEvent', () => {
    beforeEach(() => {
        mockPublishCustomEvent.mockReset()
        mockPublishCustomEvent.mockResolvedValue(undefined)
        mockLogger.warn.mockClear()
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('未提供 platformEmit 时 fallback 到 publishCustomEvent，并包装为 AgentCustomEvent', async () => {
        await emitContractReviewEvent(
            { runId: 'run-1', sessionId: 'sess-1' },
            { type: 'stage', stage: 'detect', status: 'running' },
        )

        expect(mockPublishCustomEvent).toHaveBeenCalledTimes(1)
        expect(mockPublishCustomEvent).toHaveBeenCalledWith({
            type: 'custom_event',
            runId: 'run-1',
            sessionId: 'sess-1',
            name: SSECustomEventType.CONTRACT_REVIEW,
            data: { type: 'stage', stage: 'detect', status: 'running' },
        })
    })

    it('platformEmit 存在时优先走平台 emitter，不再调用 publishCustomEvent', async () => {
        const platformEmit = vi.fn().mockResolvedValue(undefined)
        await emitContractReviewEvent(
            { runId: 'run-2', sessionId: 'sess-2', platformEmit },
            { type: 'stage', stage: 'extract', status: 'completed' },
        )

        expect(platformEmit).toHaveBeenCalledTimes(1)
        expect(platformEmit).toHaveBeenCalledWith({
            name: SSECustomEventType.CONTRACT_REVIEW,
            data: { type: 'stage', stage: 'extract', status: 'completed' },
        })
        expect(mockPublishCustomEvent).not.toHaveBeenCalled()
    })

    it('platformEmit 抛错时被 catch、不向上传播且 logger.warn 被调用', async () => {
        const platformEmit = vi.fn().mockRejectedValue(new Error('platform send failed'))
        await expect(
            emitContractReviewEvent(
                { runId: 'run-3', sessionId: 'sess-3', platformEmit },
                { type: 'stage', stage: 'detect', status: 'running' },
            ),
        ).resolves.toBeUndefined()

        expect(mockLogger.warn).toHaveBeenCalledWith(
            'emitContractReviewEvent 发送失败',
            expect.objectContaining({
                sessionId: 'sess-3',
                runId: 'run-3',
                eventType: 'stage',
            }),
        )
        expect(mockPublishCustomEvent).not.toHaveBeenCalled()
    })

    it('publishCustomEvent 抛错时被 catch、logger.warn 包含 eventType', async () => {
        mockPublishCustomEvent.mockRejectedValueOnce(new Error('redis down'))

        await expect(
            emitContractReviewEvent(
                { runId: 'run-4', sessionId: 'sess-4' },
                { type: 'stage', stage: 'detect', status: 'failed' },
            ),
        ).resolves.toBeUndefined()

        expect(mockLogger.warn).toHaveBeenCalledWith(
            'emitContractReviewEvent 发送失败',
            expect.objectContaining({
                sessionId: 'sess-4',
                runId: 'run-4',
                eventType: 'stage',
            }),
        )
    })
})
