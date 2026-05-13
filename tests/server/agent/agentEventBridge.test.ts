import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AgentStreamEvent, AgentStatusEvent } from '#shared/types/agentRun'

// 队列上限通过 .env.testing 中 NUXT_AGENT_PENDING_QUEUE_MAX=1000 注入；
// 不要用 vi.stubGlobal('useRuntimeConfig', ...) —— bridge 模块的 useRuntimeConfig
// 来自 #imports 虚拟模块，不会被 globalThis stub 替换。

// Mock redis.ts
const mockPublish = vi.fn().mockResolvedValue(1)
const mockXadd = vi.fn().mockResolvedValue('1-0')
const mockExpire = vi.fn().mockResolvedValue(1)
const mockXrange = vi.fn().mockResolvedValue([])
const mockSubscribe = vi.fn().mockResolvedValue(1)
const mockUnsubscribe = vi.fn().mockResolvedValue(1)
const mockQuit = vi.fn().mockResolvedValue('OK')
const mockConnect = vi.fn().mockResolvedValue(undefined)

let messageHandler: ((channel: string, message: string) => void) | null = null

const mockRedisClient = {
  publish: mockPublish,
  xadd: mockXadd,
  expire: mockExpire,
  xrange: mockXrange,
  status: 'ready',
  on: vi.fn(),
}

const mockSubClient = {
  subscribe: mockSubscribe,
  unsubscribe: mockUnsubscribe,
  quit: mockQuit,
  connect: mockConnect,
  on: vi.fn((event: string, handler: any) => {
    if (event === 'message') messageHandler = handler
  }),
}

vi.mock('~~/server/lib/redis', () => ({
  getRedisClient: () => mockRedisClient,
  createRedisSubscription: () => mockSubClient,
}))

describe('AgentEventBridge', () => {
  let bridge: typeof import('~~/server/services/agent/agentEventBridge')

  const streamEvent: AgentStreamEvent = {
    type: 'stream_event',
    runId: 'run-123',
    sessionId: 'session-456',
    event: 'values',
    data: { key: 'value' },
  }

  const statusEvent: AgentStatusEvent = {
    type: 'status_change',
    runId: 'run-123',
    sessionId: 'session-456',
    status: 'completed',
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    mockRedisClient.status = 'ready'
    messageHandler = null

    // 重新导入以清除模块级状态
    vi.resetModules()
    bridge = await import('~~/server/services/agent/agentEventBridge')
    bridge.clearPendingEvents()
  })

  describe('publishAgentEvent', () => {
    it('正常发布流事件到 pub/sub 和 stream', async () => {
      await bridge.publishAgentEvent(streamEvent)

      expect(mockPublish).toHaveBeenCalledWith(
        'run:run-123',
        JSON.stringify(streamEvent),
      )
      expect(mockXadd).toHaveBeenCalledWith(
        'run_events:run-123', 'MAXLEN', '~', '2000', '*',
        'payload', JSON.stringify(streamEvent),
      )
    })

    it('Redis 断连时降级到内存队列', async () => {
      mockRedisClient.status = 'reconnecting'

      await bridge.publishAgentEvent(streamEvent)

      expect(mockPublish).not.toHaveBeenCalled()
      expect(bridge.getPendingEventCount()).toBe(1)
    })

    it('publish 失败时降级到内存队列', async () => {
      mockPublish.mockRejectedValueOnce(new Error('connection lost'))

      await bridge.publishAgentEvent(streamEvent)

      expect(bridge.getPendingEventCount()).toBe(1)
    })
  })

  describe('publishStatusChange', () => {
    it('发布状态变更事件并设置 stream TTL', async () => {
      await bridge.publishStatusChange(statusEvent)

      expect(mockPublish).toHaveBeenCalledWith(
        'run:run-123',
        JSON.stringify(statusEvent),
      )
      expect(mockXadd).toHaveBeenCalled()
      expect(mockExpire).toHaveBeenCalledWith(
        'run_events:run-123',
        7 * 24 * 3600,
      )
    })

    it('Redis 断连时降级到内存队列', async () => {
      mockRedisClient.status = 'reconnecting'

      await bridge.publishStatusChange(statusEvent)

      expect(mockPublish).not.toHaveBeenCalled()
      expect(bridge.getPendingEventCount()).toBe(1)
    })
  })

  describe('replayEvents', () => {
    it('从 Stream 补发缺失事件', async () => {
      const storedEvent = JSON.stringify(streamEvent)
      mockXrange.mockResolvedValueOnce([
        ['1-0', ['payload', storedEvent]],
        ['2-0', ['payload', JSON.stringify(statusEvent)]],
      ])

      const events = await bridge.replayEvents('run-123')

      expect(mockXrange).toHaveBeenCalledWith('run_events:run-123', '0-0', '+')
      expect(events).toHaveLength(2)
      expect(events[0]).toEqual(streamEvent)
      expect(events[1]).toEqual(statusEvent)
    })

    it('使用自定义 lastEventId', async () => {
      mockXrange.mockResolvedValueOnce([])

      await bridge.replayEvents('run-123', '5-0')

      expect(mockXrange).toHaveBeenCalledWith('run_events:run-123', '5-0', '+')
    })

    it('过滤无效的 stream 条目', async () => {
      mockXrange.mockResolvedValueOnce([
        ['1-0', ['payload', JSON.stringify(streamEvent)]],
        ['2-0', ['other_field', 'value']], // 无 payload 字段
        ['3-0', ['payload', 'invalid json']], // 无效 JSON
      ])

      const events = await bridge.replayEvents('run-123')

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual(streamEvent)
    })
  })

  describe('createEventSubscription', () => {
    it('创建订阅并接收事件', async () => {
      const controller = new AbortController()
      const gen = bridge.createEventSubscription('run-123', controller.signal)

      // 模拟收到消息
      const eventPromise = gen.next()

      // 等 subscribe 完成后模拟消息
      await new Promise(r => setTimeout(r, 10))
      messageHandler?.('run:run-123', JSON.stringify(streamEvent))

      const result = await eventPromise
      expect(result.value).toEqual(streamEvent)
      expect(result.done).toBe(false)

      // 清理
      controller.abort()
      await gen.next() // 触发 cleanup
    })

    it('abort 信号触发后停止订阅', async () => {
      const controller = new AbortController()
      const gen = bridge.createEventSubscription('run-123', controller.signal)

      // 启动 generator（让它进入 await 循环）
      const resultPromise = gen.next()

      // 等待 subscribe 完成后再 abort
      await new Promise(r => setTimeout(r, 10))
      controller.abort()

      const result = await resultPromise
      expect(result.done).toBe(true)
    })
  })

  describe('内存队列降级', () => {
    it('队列超限时只保留 status_change 事件', async () => {
      mockRedisClient.status = 'reconnecting'

      // 填满队列
      for (let i = 0; i < 1000; i++) {
        await bridge.publishAgentEvent({
          ...streamEvent,
          runId: `run-${i}`,
        })
      }
      expect(bridge.getPendingEventCount()).toBe(1000)

      // 再发一条 stream_event 应被丢弃
      await bridge.publishAgentEvent({
        ...streamEvent,
        runId: 'run-overflow',
      })
      expect(bridge.getPendingEventCount()).toBe(1000)

      // 但 status_change 应替换最早的非 status_change 事件
      await bridge.publishStatusChange(statusEvent)
      expect(bridge.getPendingEventCount()).toBe(1000)
    })
  })
})
