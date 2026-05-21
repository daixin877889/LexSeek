/**
 * AgentEventBridge 补充覆盖率测试
 *
 * 覆盖 agentEventBridge.ts 中 publishCustomEvent、drainExpired、
 * flushPendingEvents、startReconnectFlush 等未覆盖路径
 *
 * **Feature: agent-background-queue**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentCustomEvent, AgentStreamEvent, AgentStatusEvent } from '#shared/types/agentRun'

// 队列上限通过 .env.testing 中 NUXT_AGENT_PENDING_QUEUE_MAX=1000 注入

// Mock redis.ts
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

describe('AgentEventBridge 补充覆盖率', () => {
  let bridge: typeof import('~~/server/services/agent/agentEventBridge')

  const streamEvent: AgentStreamEvent = {
    type: 'stream_event',
    runId: 'run-001',
    sessionId: 'session-001',
    event: 'values',
    data: { key: 'value' },
  }

  const statusEvent: AgentStatusEvent = {
    type: 'status_change',
    runId: 'run-001',
    sessionId: 'session-001',
    status: 'running',
  }

  const customEvent: AgentCustomEvent = {
    type: 'custom_event',
    runId: 'run-001',
    sessionId: 'session-001',
    name: 'analysis_result_saved',
    data: { resultId: 'r-1' },
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    mockRedisClient.status = 'ready'
    vi.resetModules()
    bridge = await import('~~/server/services/agent/agentEventBridge')
    bridge.clearPendingEvents()
  })

  describe('publishCustomEvent', () => {
    it('正常发布自定义事件到 pub/sub 和 stream', async () => {
      await bridge.publishCustomEvent(customEvent)

      expect(mockPublish).toHaveBeenCalledWith(
        'run:run-001',
        JSON.stringify(customEvent),
      )
      expect(mockXadd).toHaveBeenCalledWith(
        'run_events:run-001', 'MAXLEN', '~', '2000', '*',
        'payload', JSON.stringify(customEvent),
      )
    })

    it('Redis 断连时降级到内存队列', async () => {
      mockRedisClient.status = 'reconnecting'

      await bridge.publishCustomEvent(customEvent)

      expect(mockPublish).not.toHaveBeenCalled()
      expect(bridge.getPendingEventCount()).toBe(1)
    })

    it('publish 失败时降级到内存队列', async () => {
      mockPublish.mockRejectedValueOnce(new Error('connection lost'))

      await bridge.publishCustomEvent(customEvent)

      expect(bridge.getPendingEventCount()).toBe(1)
    })
  })

  describe('publishStatusChange 失败降级', () => {
    it('publish 异常时降级到内存队列', async () => {
      mockPublish.mockRejectedValueOnce(new Error('redis error'))

      await bridge.publishStatusChange(statusEvent)

      expect(bridge.getPendingEventCount()).toBe(1)
    })
  })

  describe('内存队列 - 队列满时 status_change 全满场景', () => {
    it('队列全是 status_change 时无法再入队', async () => {
      mockRedisClient.status = 'reconnecting'

      // 填满队列，全部用 status_change
      for (let i = 0; i < 1000; i++) {
        await bridge.publishStatusChange({
          ...statusEvent,
          runId: `run-${i}`,
        })
      }
      expect(bridge.getPendingEventCount()).toBe(1000)

      // 再发一条 status_change，队列已全是 status_change 无法腾出空间
      await bridge.publishStatusChange({
        ...statusEvent,
        runId: 'run-overflow',
      })
      // 全是 status_change 且队列满，丢弃
      expect(bridge.getPendingEventCount()).toBe(1000)
    })
  })

  describe('startReconnectFlush', () => {
    it('注册 Redis ready 事件回调', () => {
      bridge.startReconnectFlush()

      expect(mockOn).toHaveBeenCalledWith('ready', expect.any(Function))
    })

    it('Redis ready 时触发 flushPendingEvents', async () => {
      // 先在内存队列中放入事件
      mockRedisClient.status = 'reconnecting'
      await bridge.publishAgentEvent(streamEvent)
      expect(bridge.getPendingEventCount()).toBe(1)

      // 恢复 Redis 状态
      mockRedisClient.status = 'ready'

      bridge.startReconnectFlush()

      // 手动触发 ready 回调
      const readyCallback = mockOn.mock.calls.find(
        (call: any[]) => call[0] === 'ready',
      )?.[1]
      expect(readyCallback).toBeDefined()

      await readyCallback()

      // flush 后内存队列应清空
      expect(bridge.getPendingEventCount()).toBe(0)
      expect(mockXadd).toHaveBeenCalled()
    })
  })

  describe('replayEvents 边界情况', () => {
    it('stream 条目 payload 索引后无值应过滤', async () => {
      mockXrange.mockResolvedValueOnce([
        ['1-0', ['payload']], // payload 字段后无值
      ])

      const events = await bridge.replayEvents('run-001')
      expect(events).toHaveLength(0)
    })

    it('空 stream 返回空数组', async () => {
      mockXrange.mockResolvedValueOnce([])

      const events = await bridge.replayEvents('run-001')
      expect(events).toHaveLength(0)
    })
  })
})
