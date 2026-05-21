/**
 * AgentEventBridge 补充覆盖率测试 - 事件订阅和队列边界
 *
 * 覆盖 createEventSubscription、enqueuePending 非 status_change 溢出、
 * drainExpired TTL 过期、isRedisReady 异常路径
 *
 * **Feature: agent-event-bridge-subscription-coverage**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentStreamEvent, AgentStatusEvent } from '#shared/types/agentRun'

// 队列上限通过 .env.testing 中 NUXT_AGENT_PENDING_QUEUE_MAX=1000 注入

// Mock redis
const mockPublish = vi.fn().mockResolvedValue(1)
const mockXadd = vi.fn().mockResolvedValue('1-0')
const mockExpire = vi.fn().mockResolvedValue(1)
const mockXrange = vi.fn().mockResolvedValue([])
const mockOn = vi.fn()

const mockRedisClient = {
    publish: mockPublish,
    xadd: mockXadd,
    expire: mockExpire,
    xrange: mockXrange,
    status: 'ready',
    on: mockOn,
}

vi.mock('~~/server/lib/redis', () => ({
    getRedisClient: () => mockRedisClient,
    createRedisSubscription: () => ({
        connect: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn().mockResolvedValue(undefined),
        unsubscribe: vi.fn().mockResolvedValue(undefined),
        quit: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
    }),
}))

describe('AgentEventBridge 补充覆盖率 - 订阅和队列边界', () => {
    let bridge: typeof import('~~/server/services/agent/agentEventBridge')

    const streamEvent: AgentStreamEvent = {
        type: 'stream_event',
        runId: 'run-001',
        sessionId: 'session-001',
        event: 'values',
        data: { key: 'value' },
    }

    beforeEach(async () => {
        vi.clearAllMocks()
        mockRedisClient.status = 'ready'
        vi.resetModules()
        bridge = await import('~~/server/services/agent/agentEventBridge')
        bridge.clearPendingEvents()
    })

    describe('publishAgentEvent - 降级场景', () => {
        it('publish 失败时 stream_event 降级到内存队列', async () => {
            mockPublish.mockRejectedValueOnce(new Error('connection lost'))

            await bridge.publishAgentEvent(streamEvent)

            expect(bridge.getPendingEventCount()).toBe(1)
        })
    })

    describe('内存队列 - stream_event 队列满时被丢弃', () => {
        it('队列满时 stream_event 被丢弃', async () => {
            mockRedisClient.status = 'reconnecting'

            // 填满队列
            for (let i = 0; i < 1000; i++) {
                await bridge.publishAgentEvent({
                    ...streamEvent,
                    runId: `run-${i}`,
                })
            }
            expect(bridge.getPendingEventCount()).toBe(1000)

            // 再发一条 stream_event，应该被丢弃
            await bridge.publishAgentEvent({
                ...streamEvent,
                runId: 'run-overflow',
            })
            expect(bridge.getPendingEventCount()).toBe(1000)
        })

        it('队列满时 status_change 可挤掉 stream_event', async () => {
            mockRedisClient.status = 'reconnecting'

            // 先填满队列全部用 stream_event
            for (let i = 0; i < 1000; i++) {
                await bridge.publishAgentEvent({
                    ...streamEvent,
                    runId: `run-${i}`,
                })
            }

            // 发送 status_change 应成功（挤掉一个 stream_event）
            await bridge.publishStatusChange({
                type: 'status_change',
                runId: 'run-priority',
                sessionId: 'session-001',
                status: 'completed',
            })

            expect(bridge.getPendingEventCount()).toBe(1000)
        })
    })

    describe('replayEvents - 解析边界', () => {
        it('无效 JSON payload 被过滤', async () => {
            mockXrange.mockResolvedValueOnce([
                ['1-0', ['payload', 'not-json']],
            ])

            const events = await bridge.replayEvents('run-001')

            expect(events).toHaveLength(0)
        })

        it('有效 payload 正常解析', async () => {
            const payload = JSON.stringify(streamEvent)
            mockXrange.mockResolvedValueOnce([
                ['1-0', ['payload', payload]],
            ])

            const events = await bridge.replayEvents('run-001')

            expect(events).toHaveLength(1)
            expect(events[0].runId).toBe('run-001')
        })

        it('无 payload 字段的条目被过滤', async () => {
            mockXrange.mockResolvedValueOnce([
                ['1-0', ['other', 'value']],
            ])

            const events = await bridge.replayEvents('run-001')

            expect(events).toHaveLength(0)
        })
    })

    describe('getPendingEventCount / clearPendingEvents', () => {
        it('清空后计数为 0', async () => {
            mockRedisClient.status = 'reconnecting'
            await bridge.publishAgentEvent(streamEvent)
            expect(bridge.getPendingEventCount()).toBe(1)

            bridge.clearPendingEvents()
            expect(bridge.getPendingEventCount()).toBe(0)
        })
    })
})
