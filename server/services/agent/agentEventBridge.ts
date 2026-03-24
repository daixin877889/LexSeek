import type { AgentEvent, AgentStreamEvent, AgentStatusEvent } from '#shared/types/agentRun'
import { getRedisClient, createRedisSubscription } from '~~/server/lib/redis'

// ==================== 内存降级队列 ====================

interface PendingEvent {
  event: AgentEvent
  timestamp: number
}

const pendingEvents: PendingEvent[] = []
const PENDING_QUEUE_MAX = 500000
const PENDING_QUEUE_TTL_MS = 5 * 60 * 1000 // 5 分钟

function isRedisReady(): boolean {
  try {
    const client = getRedisClient()
    return client.status === 'ready'
  }
  catch {
    return false
  }
}

function enqueuePending(event: AgentEvent): void {
  // 超限时只保留 status_change 类型
  if (pendingEvents.length >= PENDING_QUEUE_MAX) {
    if (event.type !== 'status_change') return
    // 移除最早的非 status_change 事件腾出空间
    const idx = pendingEvents.findIndex(e => e.event.type !== 'status_change')
    if (idx >= 0) pendingEvents.splice(idx, 1)
    else return // 全是 status_change，队列满则丢弃
  }
  pendingEvents.push({ event, timestamp: Date.now() })
}

function drainExpired(): void {
  const now = Date.now()
  let removed = 0
  while (pendingEvents.length > 0 && now - pendingEvents[0]!.timestamp > PENDING_QUEUE_TTL_MS) {
    pendingEvents.shift()
    removed++
  }
  if (removed > 0) {
    logger.error(`Agent event bridge: 丢弃 ${removed} 条超时事件`)
  }
}

async function flushPendingEvents(): Promise<void> {
  drainExpired()
  if (pendingEvents.length === 0) return

  const redis = getRedisClient()
  const events = pendingEvents.splice(0)
  for (const { event } of events) {
    try {
      const payload = JSON.stringify(event)
      const runId = event.runId
      await redis.xadd(
        `run_events:${runId}`, 'MAXLEN', '~', '2000', '*',
        'payload', payload,
      )
    }
    catch (err) {
      logger.error('Agent event bridge: flush 补发失败:', err)
    }
  }
  logger.info(`Agent event bridge: 补发 ${events.length} 条缓存事件`)
}

// ==================== 公共 API ====================

/** 发布 Agent 流事件（pub/sub + stream 双写） */
export async function publishAgentEvent(event: AgentStreamEvent): Promise<void> {
  if (!isRedisReady()) {
    enqueuePending(event)
    return
  }

  const redis = getRedisClient()
  const payload = JSON.stringify(event)
  try {
    await Promise.all([
      redis.publish(`run:${event.runId}`, payload),
      redis.xadd(
        `run_events:${event.runId}`, 'MAXLEN', '~', '2000', '*',
        'payload', payload,
      ),
    ])
  }
  catch (err) {
    logger.error('Agent event bridge: publish 失败，降级到内存队列:', err)
    enqueuePending(event)
  }
}

/** 发布状态变更事件 */
export async function publishStatusChange(event: AgentStatusEvent): Promise<void> {
  if (!isRedisReady()) {
    enqueuePending(event)
    return
  }

  const redis = getRedisClient()
  const payload = JSON.stringify(event)
  try {
    await Promise.all([
      redis.publish(`run:${event.runId}`, payload),
      redis.xadd(
        `run_events:${event.runId}`, 'MAXLEN', '~', '2000', '*',
        'payload', payload,
      ),
    ])
    // 设置 Stream 7 天过期
    await redis.expire(`run_events:${event.runId}`, 7 * 24 * 3600)
  }
  catch (err) {
    logger.error('Agent event bridge: publishStatusChange 失败，降级到内存队列:', err)
    enqueuePending(event)
  }
}

/** 从 Stream 补发缺失事件（用于重连） */
export async function replayEvents(
  runId: string,
  lastEventId: string = '0-0',
): Promise<AgentEvent[]> {
  const redis = getRedisClient()
  const results = await redis.xrange(`run_events:${runId}`, lastEventId, '+')
  return results
    .map(([_id, fields]) => {
      const payloadIdx = fields.indexOf('payload')
      if (payloadIdx < 0 || payloadIdx + 1 >= fields.length) return null
      const payloadStr = fields[payloadIdx + 1]
      if (!payloadStr) return null
      try {
        return JSON.parse(payloadStr) as AgentEvent
      }
      catch {
        return null
      }
    })
    .filter((e): e is AgentEvent => e !== null)
}

/** 创建事件订阅（返回 AsyncGenerator，用于 SSE 推送） */
export async function* createEventSubscription(
  runId: string,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const sub = createRedisSubscription()
  await sub.connect()

  const channel = `run:${runId}`
  const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 分钟空闲超时

  // 用 Promise 队列将 redis message 事件转为 async iterable
  type QueueItem = { value: AgentEvent } | { done: true }
  const queue: QueueItem[] = []
  let resolve: (() => void) | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null

  function resetIdleTimer(): void {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      queue.push({ done: true })
      resolve?.()
    }, IDLE_TIMEOUT_MS)
  }

  function cleanup(): void {
    if (idleTimer) clearTimeout(idleTimer)
    sub.unsubscribe(channel).catch(() => {})
    sub.quit().catch(() => {})
  }

  sub.on('message', (_ch: string, message: string) => {
    resetIdleTimer()
    try {
      const event = JSON.parse(message) as AgentEvent
      queue.push({ value: event })
      resolve?.()
    }
    catch {
      // 忽略解析失败的消息
    }
  })

  signal.addEventListener('abort', () => {
    queue.push({ done: true })
    resolve?.()
  }, { once: true })

  await sub.subscribe(channel)
  resetIdleTimer()

  try {
    while (true) {
      if (queue.length === 0) {
        await new Promise<void>((r) => { resolve = r })
        resolve = null
      }

      while (queue.length > 0) {
        const item = queue.shift()!
        if ('done' in item) return
        yield item.value
      }
    }
  }
  finally {
    cleanup()
  }
}

/** 启动 Redis 重连补发监听（在 Worker 启动时调用一次） */
export function startReconnectFlush(): void {
  try {
    const client = getRedisClient()
    client.on('ready', () => {
      flushPendingEvents().catch((err) => {
        logger.error('Agent event bridge: reconnect flush 失败:', err)
      })
    })
  }
  catch {
    // REDIS_URL 未配置时忽略
  }
}

/** 获取内存降级队列长度（用于测试/监控） */
export function getPendingEventCount(): number {
  return pendingEvents.length
}

/** 清空内存降级队列（用于测试） */
export function clearPendingEvents(): void {
  pendingEvents.length = 0
}
