import { describe, it, expect, vi, beforeEach } from 'vitest'

const redisMock = {
  zadd: vi.fn().mockResolvedValue(1),
  zrangebyscore: vi.fn().mockResolvedValue([]),
  zrem: vi.fn().mockResolvedValue(1),
}

vi.mock('~~/server/lib/redis', () => ({
  getRedisClient: () => redisMock,
}))

describe('consolidator · schedule + drain', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('schedule 将 sessionId 写入 Redis ZSET，score 为 now+30s', async () => {
    const { scheduleConsolidation } = await import('~~/server/services/memory/consolidator.service')

    const beforeMs = Date.now()
    await scheduleConsolidation({ caseId: 1, sessionId: 'sess-x' })
    // ioredis zadd(key, score, member) — 需要跳过第一个参数 key
    const [[_key, dueAt, sessionId]] = redisMock.zadd.mock.calls
    expect(sessionId).toBe('sess-x')
    expect(dueAt).toBeGreaterThanOrEqual(beforeMs + 30 * 1000 - 100)
    expect(dueAt).toBeLessThanOrEqual(beforeMs + 30 * 1000 + 100)
  })

  it('schedule 重复调用会覆盖同 sessionId 的 score（debounce）', async () => {
    const { scheduleConsolidation } = await import('~~/server/services/memory/consolidator.service')

    await scheduleConsolidation({ caseId: 1, sessionId: 'sess-y' })
    await new Promise((r) => setTimeout(r, 50))
    await scheduleConsolidation({ caseId: 1, sessionId: 'sess-y' })

    expect(redisMock.zadd).toHaveBeenCalledTimes(2)
    // 两次都用同一 sessionId；Redis ZADD 会覆盖分数
  })

  it('drainDueSessions 调 zrangebyscore + zrem', async () => {
    const { drainDueSessions } = await import('~~/server/services/memory/consolidator.service')
    redisMock.zrangebyscore.mockResolvedValue(['sess-due-1', 'sess-due-2'])

    const due = await drainDueSessions()
    expect(due).toEqual(['sess-due-1', 'sess-due-2'])
    expect(redisMock.zrem).toHaveBeenCalledTimes(2)
  })
})
