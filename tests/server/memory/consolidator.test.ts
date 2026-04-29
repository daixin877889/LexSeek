import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const redisMock = {
  zadd: vi.fn().mockResolvedValue(1),
  zrangebyscore: vi.fn().mockResolvedValue([]),
  zrem: vi.fn().mockResolvedValue(1),
}

vi.mock('~~/server/lib/redis', () => ({
  getRedisClient: () => redisMock,
}))

vi.mock('~~/server/services/workflow/checkpointer', () => ({
  getCheckpointer: vi.fn(),
}))
vi.mock('~~/server/services/memory/memoryExtraction.service', () => ({
  runMemoryExtractionService: vi.fn().mockResolvedValue(undefined),
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

describe('consolidateSession', () => {
  let prismaMock: { caseSessions: { findUnique: ReturnType<typeof vi.fn> } }

  beforeEach(async () => {
    vi.clearAllMocks()
    prismaMock = {
      caseSessions: {
        findUnique: vi.fn(),
      },
    }
    vi.stubGlobal('prisma', prismaMock)
    vi.stubGlobal('logger', { warn: vi.fn() })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('session 不存在时提前返回，不触发记忆抽取', async () => {
    const { runMemoryExtractionService } = await import('~~/server/services/memory/memoryExtraction.service')
    const { getCheckpointer } = await import('~~/server/services/workflow/checkpointer')
    prismaMock.caseSessions.findUnique.mockResolvedValue(null)

    const { consolidateSession } = await import('~~/server/services/memory/consolidator.service')
    await consolidateSession('sess-no-exist')

    expect(runMemoryExtractionService).not.toHaveBeenCalled()
    expect(getCheckpointer).not.toHaveBeenCalled()
  })

  it('消息列表为空时提前返回，不触发记忆抽取', async () => {
    const { runMemoryExtractionService } = await import('~~/server/services/memory/memoryExtraction.service')
    const { getCheckpointer } = await import('~~/server/services/workflow/checkpointer')
    prismaMock.caseSessions.findUnique.mockResolvedValue({ caseId: 42 })
    ;(getCheckpointer as ReturnType<typeof vi.fn>).mockResolvedValue({
      getTuple: vi.fn().mockResolvedValue(null),
    })

    const { consolidateSession } = await import('~~/server/services/memory/consolidator.service')
    await consolidateSession('sess-empty')

    expect(runMemoryExtractionService).not.toHaveBeenCalled()
  })

  it('LangChain 序列化格式消息（真实 checkpoint 场景）可被正确解析后转交 memoryExtraction', async () => {
    const { runMemoryExtractionService } = await import('~~/server/services/memory/memoryExtraction.service')
    const { getCheckpointer } = await import('~~/server/services/workflow/checkpointer')
    prismaMock.caseSessions.findUnique.mockResolvedValue({ caseId: 77 })
    ;(getCheckpointer as ReturnType<typeof vi.fn>).mockResolvedValue({
      getTuple: vi.fn().mockResolvedValue({
        checkpoint: {
          channel_values: {
            messages: [
              { lc: 1, type: 'constructor', id: ['langchain_core', 'messages', 'HumanMessage'], kwargs: { content: '原告叫张三' } },
              { lc: 1, type: 'constructor', id: ['langchain_core', 'messages', 'AIMessageChunk'], kwargs: { content: [{ type: 'text', text: '已记录，原告为张三' }] } },
            ],
          },
        },
      }),
    })

    const { consolidateSession } = await import('~~/server/services/memory/consolidator.service')
    await consolidateSession('sess-serialized')

    expect(runMemoryExtractionService).toHaveBeenCalledTimes(1)
    const callArg = vi.mocked(runMemoryExtractionService).mock.calls[0][0]
    expect(callArg.caseId).toBe(77)
    expect(callArg.sessionId).toBe('sess-serialized')
    expect(callArg.messages).toEqual([
      { role: 'human', content: '原告叫张三' },
      { role: 'ai', content: '已记录，原告为张三' },
    ])
  })

  it('正常路径：调用 runMemoryExtractionService 并透传解析后的对话', async () => {
    const { runMemoryExtractionService } = await import('~~/server/services/memory/memoryExtraction.service')
    const { getCheckpointer } = await import('~~/server/services/workflow/checkpointer')
    prismaMock.caseSessions.findUnique.mockResolvedValue({ caseId: 99 })
    ;(getCheckpointer as ReturnType<typeof vi.fn>).mockResolvedValue({
      getTuple: vi.fn().mockResolvedValue({
        checkpoint: {
          channel_values: {
            messages: [
              { getType: () => 'human', content: '原告住在北京' },
              { getType: () => 'ai', content: '已记录' },
            ],
          },
        },
      }),
    })

    const { consolidateSession } = await import('~~/server/services/memory/consolidator.service')
    await consolidateSession('sess-normal')

    expect(runMemoryExtractionService).toHaveBeenCalledTimes(1)
    const callArg = vi.mocked(runMemoryExtractionService).mock.calls[0][0]
    expect(callArg.caseId).toBe(99)
    expect(callArg.sessionId).toBe('sess-normal')
    expect(callArg.messages).toEqual([
      { role: 'human', content: '原告住在北京' },
      { role: 'ai', content: '已记录' },
    ])
  })
})
