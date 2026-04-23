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
vi.mock('~~/server/services/node/chatModelFactory', () => ({
  createChatModel: vi.fn(),
}))
vi.mock('~~/server/services/memory/memory.service', () => ({
  writeMemoryService: vi.fn().mockResolvedValue(undefined),
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

  it('session 不存在时提前返回，不调用 AI 模型', async () => {
    const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
    const { getCheckpointer } = await import('~~/server/services/workflow/checkpointer')
    prismaMock.caseSessions.findUnique.mockResolvedValue(null)

    const { consolidateSession } = await import('~~/server/services/memory/consolidator.service')
    await consolidateSession('sess-no-exist')

    expect(createChatModel).not.toHaveBeenCalled()
    expect(getCheckpointer).not.toHaveBeenCalled()
  })

  it('消息列表为空时提前返回，不调用 AI 模型', async () => {
    const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
    const { getCheckpointer } = await import('~~/server/services/workflow/checkpointer')
    prismaMock.caseSessions.findUnique.mockResolvedValue({ caseId: 42 })
    ;(getCheckpointer as ReturnType<typeof vi.fn>).mockResolvedValue({
      getTuple: vi.fn().mockResolvedValue(null),
    })

    const { consolidateSession } = await import('~~/server/services/memory/consolidator.service')
    await consolidateSession('sess-empty')

    expect(createChatModel).not.toHaveBeenCalled()
  })

  it('置信度 < 0.6 的 fact/preference 被过滤，不写入记忆', async () => {
    const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
    const { getCheckpointer } = await import('~~/server/services/workflow/checkpointer')
    const { writeMemoryService } = await import('~~/server/services/memory/memory.service')
    prismaMock.caseSessions.findUnique.mockResolvedValue({ caseId: 42 })
    ;(getCheckpointer as ReturnType<typeof vi.fn>).mockResolvedValue({
      getTuple: vi.fn().mockResolvedValue({
        checkpoint: {
          channel_values: {
            messages: [
              { getType: () => 'human', content: '你好' },
              { getType: () => 'ai', content: '我是AI' },
            ],
          },
        },
      }),
    })
    ;(createChatModel as ReturnType<typeof vi.fn>).mockReturnValue({
      withStructuredOutput: () => ({
        invoke: vi.fn().mockResolvedValue({
          facts: [{ subjectKey: 'k', text: '低置信事实', confidence: 0.3 }],
          preferences: [{ text: '低置信偏好', confidence: 0.4 }],
          dialogueNotes: [],
        }),
      }),
    })

    const { consolidateSession } = await import('~~/server/services/memory/consolidator.service')
    await consolidateSession('sess-low-conf')

    expect(writeMemoryService).not.toHaveBeenCalled()
  })

  it('正常路径：facts/preferences/dialogueNotes 都写入记忆', async () => {
    const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
    const { getCheckpointer } = await import('~~/server/services/workflow/checkpointer')
    const { writeMemoryService } = await import('~~/server/services/memory/memory.service')
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
    ;(createChatModel as ReturnType<typeof vi.fn>).mockReturnValue({
      withStructuredOutput: () => ({
        invoke: vi.fn().mockResolvedValue({
          facts: [{ subjectKey: 'plaintiff.address', text: '原告住在北京', confidence: 0.9 }],
          preferences: [{ text: '简洁输出', confidence: 0.8 }],
          dialogueNotes: [{ text: '关注地址信息' }],
        }),
      }),
    })

    const { consolidateSession } = await import('~~/server/services/memory/consolidator.service')
    await consolidateSession('sess-normal')

    expect(writeMemoryService).toHaveBeenCalledTimes(3)
    expect(writeMemoryService).toHaveBeenCalledWith(expect.objectContaining({ kind: 'fact', caseId: 99 }))
    expect(writeMemoryService).toHaveBeenCalledWith(expect.objectContaining({ kind: 'preference', caseId: 99 }))
    expect(writeMemoryService).toHaveBeenCalledWith(expect.objectContaining({ kind: 'dialogue_note', caseId: 99 }))
  })
})
