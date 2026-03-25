/**
 * Agent Worker 核心测试
 *
 * **Feature: agent-background-queue**
 * **Validates: Task 6 - Agent Worker 核心逻辑**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import './test-setup'
import {
  createTestUser,
  createTestCaseType,
  createTestCase,
  createTestSession,
  createEmptyTestIds,
  cleanupTestData,
  disconnectTestDb,
  type AgentTestIds,
} from './test-db-helper'
import { createAgentRunDAO, updateRunStatusDAO } from '../../../server/services/agent/agentRun.dao'
import { AGENT_RUN_STATUS } from '../../../shared/types/agentRun'

// Mock Redis
const mockPublish = vi.fn().mockResolvedValue(1)
const mockSubscribe = vi.fn().mockResolvedValue(undefined)
const mockPsubscribe = vi.fn().mockResolvedValue(undefined)
const mockOn = vi.fn()

vi.mock('~~/server/lib/redis', () => ({
  getRedisClient: () => ({
    publish: mockPublish,
    status: 'ready',
  }),
  getRedisSubscriber: () => ({
    subscribe: mockSubscribe,
    psubscribe: mockPsubscribe,
    on: mockOn,
  }),
  createRedisSubscription: () => ({
    connect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
  }),
}))

// Mock agentEventBridge
vi.mock('../../../server/services/agent/agentEventBridge', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
  publishStatusChange: vi.fn().mockResolvedValue(undefined),
  startReconnectFlush: vi.fn(),
}))

// Mock caseAgent (runCaseChat)
const mockStream = {
  getReader: () => ({
    read: vi.fn()
      .mockResolvedValueOnce({
        done: false,
        value: new TextEncoder().encode('event: values\ndata: {"test":true}\n\n'),
      })
      .mockResolvedValueOnce({ done: true, value: undefined }),
    releaseLock: vi.fn(),
  }),
}
vi.mock('../../../server/services/agent/caseAgent', () => ({
  runCaseChat: vi.fn().mockResolvedValue(mockStream),
}))

// 动态导入（在 mock 之后）
const { AgentWorker } = await import('../../../server/services/agent/agentWorker')
const { publishAgentEvent, publishStatusChange } = await import('../../../server/services/agent/agentEventBridge')

describe('Agent Worker 核心', () => {
  let testIds: AgentTestIds
  let testUser: Awaited<ReturnType<typeof createTestUser>>
  let testCaseType: Awaited<ReturnType<typeof createTestCaseType>>
  let testCase: Awaited<ReturnType<typeof createTestCase>>
  let testSession: Awaited<ReturnType<typeof createTestSession>>

  beforeAll(async () => {
    testIds = createEmptyTestIds()
    testUser = await createTestUser()
    testIds.userIds.push(testUser.id)
    testCaseType = await createTestCaseType()
    testIds.caseTypeIds.push(testCaseType.id)
    testCase = await createTestCase(testUser.id, testCaseType.id)
    testIds.caseIds.push(testCase.id)
    testSession = await createTestSession(testCase.id)
    testIds.sessionIds.push(testSession.sessionId)
  })

  afterEach(async () => {
    vi.clearAllMocks()
    if (testIds.agentRunIds.length > 0) {
      const p = (globalThis as any).prisma
      await p.agentRuns.deleteMany({ where: { id: { in: testIds.agentRunIds } } })
      testIds.agentRunIds = []
    }
  })

  afterAll(async () => {
    await cleanupTestData(testIds)
    await disconnectTestDb()
  })

  it('构造函数生成唯一 workerId', () => {
    const worker = new AgentWorker()
    expect(worker.workerId).toMatch(/^worker-/)
    expect(worker.activeRunCount).toBe(0)
    expect(worker.shuttingDown).toBe(false)
  })

  it('自定义 workerId', () => {
    const worker = new AgentWorker('test-worker-1')
    expect(worker.workerId).toBe('test-worker-1')
  })

  it('processNextTask 取到 pending 任务', async () => {
    const run = await createAgentRunDAO({
      sessionId: testSession.sessionId,
      threadId: testSession.sessionId,
      userId: testUser.id,
      caseId: testCase.id,
      input: { message: '测试执行' },
    })
    testIds.agentRunIds.push(run.id)

    const worker = new AgentWorker('test-claim-worker')
    const claimed = await worker.processNextTask()
    expect(claimed).toBe(true)

    // 等待 executeRun 完成
    await new Promise(r => setTimeout(r, 200))

    expect(publishStatusChange).toHaveBeenCalled()
    await worker.shutdown()
  })

  it('processNextTask 无 pending 任务返回 false', async () => {
    const worker = new AgentWorker('test-empty-worker')
    const claimed = await worker.processNextTask()
    expect(claimed).toBe(false)
  })

  it('processNextTask 并发已满时不取任务', async () => {
    // 通过构造函数注入 maxConcurrent=1 的配置
    const testConfig = {
      maxConcurrent: 1,
      timeoutMs: 3_600_000,
      heartbeatIntervalMs: 15_000,
      crashThresholdMs: 60_000,
    }

    try {
      // 先创建一个 run 并让 worker 取走
      const run1 = await createAgentRunDAO({
        sessionId: testSession.sessionId,
        threadId: testSession.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: '占位任务' },
      })
      testIds.agentRunIds.push(run1.id)

      const worker = new AgentWorker('test-full-worker', testConfig)
      const first = await worker.processNextTask()
      expect(first).toBe(true)

      // 创建第二个 session 和 run
      const session2 = await createTestSession(testCase.id)
      testIds.sessionIds.push(session2.sessionId)
      const run2 = await createAgentRunDAO({
        sessionId: session2.sessionId,
        threadId: session2.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: '超限任务' },
      })
      testIds.agentRunIds.push(run2.id)

      // 并发已满，不应取到
      const second = await worker.processNextTask()
      expect(second).toBe(false)

      await worker.shutdown()
    }
    finally {
      // 无需清理，配置仅在 worker 实例内
    }
  })

  it('shutdown 将 isShuttingDown 设为 true', async () => {
    const worker = new AgentWorker('test-shutdown-worker')
    expect(worker.shuttingDown).toBe(false)

    await worker.shutdown()
    expect(worker.shuttingDown).toBe(true)
  })

  it('isShuttingDown 时 processNextTask 返回 false', async () => {
    const worker = new AgentWorker('test-shutting-down-worker')
    await worker.shutdown()

    const claimed = await worker.processNextTask()
    expect(claimed).toBe(false)
  })

  it('executeRun 完成后更新状态为 completed', async () => {
    const run = await createAgentRunDAO({
      sessionId: testSession.sessionId,
      threadId: testSession.sessionId,
      userId: testUser.id,
      caseId: testCase.id,
      input: { message: '完成测试' },
    })
    testIds.agentRunIds.push(run.id)

    const worker = new AgentWorker('test-complete-worker')
    await worker.processNextTask()

    // 等待 executeRun 完成
    await new Promise(r => setTimeout(r, 500))

    const p = (globalThis as any).prisma
    const updated = await p.agentRuns.findUnique({ where: { id: run.id } })
    expect(updated.status).toBe(AGENT_RUN_STATUS.COMPLETED)

    await worker.shutdown()
  })
})
