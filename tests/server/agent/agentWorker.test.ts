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

// Mock agentRegistry.dispatch：让 case scope 的任务返回 mock stream
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
vi.mock('~~/server/services/agent-platform/registry/agentRegistry', () => ({
  agentRegistry: {
    dispatch: vi.fn().mockResolvedValue(mockStream),
  },
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

/**
 * Task 6: scope 分流 + 数据异常抛错
 *
 * executeRun 是私有方法，通过 processNextTask 间接触发。
 * 异步 executeRun 捕获的错误会被写入 agentRuns.status=FAILED + error 字段。
 */
describe('agentWorker.executeRun - scope 分流与数据异常', () => {
  let testIds: AgentTestIds
  let testUser: Awaited<ReturnType<typeof createTestUser>>

  beforeAll(async () => {
    testIds = createEmptyTestIds()
    testUser = await createTestUser()
    testIds.userIds.push(testUser.id)
  })

  afterEach(async () => {
    vi.clearAllMocks()
    const p = (globalThis as any).prisma
    if (testIds.agentRunIds.length > 0) {
      await p.agentRuns.deleteMany({ where: { id: { in: testIds.agentRunIds } } })
      testIds.agentRunIds = []
    }
    if (testIds.sessionIds.length > 0) {
      await p.caseSessions.deleteMany({ where: { sessionId: { in: testIds.sessionIds } } })
      testIds.sessionIds = []
    }
  })

  afterAll(async () => {
    await cleanupTestData(testIds)
    await disconnectTestDb()
  })

  /**
   * 等待 run 变为非 pending/running 状态（或超时返回当前状态）
   */
  async function waitForRunTermination(runId: string, maxMs = 1500) {
    const p = (globalThis as any).prisma
    const deadline = Date.now() + maxMs
    while (Date.now() < deadline) {
      const row = await p.agentRuns.findUnique({ where: { id: runId } })
      if (row && row.status !== AGENT_RUN_STATUS.PENDING && row.status !== AGENT_RUN_STATUS.RUNNING) {
        return row
      }
      await new Promise(r => setTimeout(r, 50))
    }
    return p.agentRuns.findUnique({ where: { id: runId } })
  }

  it('scope=assistant 但 session.userId=null 应写入明确错误（数据损坏）', async () => {
    const sessionId = `broken-assist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await (globalThis as any).prisma.$executeRaw`
      INSERT INTO case_sessions (session_id, scope, user_id, case_id, status, type, created_at, updated_at)
      VALUES (${sessionId}, 'assistant', NULL, NULL, 1, 1, NOW(), NOW())
    `
    testIds.sessionIds.push(sessionId)

    const run = await createAgentRunDAO({
      sessionId,
      threadId: sessionId,
      userId: testUser.id,
      caseId: null,
      input: { message: 'hi' },
    })
    testIds.agentRunIds.push(run.id)

    const worker = new AgentWorker('test-broken-assist-worker')
    await worker.processNextTask()

    const terminated = await waitForRunTermination(run.id)
    expect(terminated.status).toBe(AGENT_RUN_STATUS.FAILED)
    expect(terminated.error).toMatch(/缺失 userId/)

    await worker.shutdown()
  })

  it('scope=case 但 session.caseId=null 应写入明确错误（数据损坏）', async () => {
    const sessionId = `broken-case-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await (globalThis as any).prisma.$executeRaw`
      INSERT INTO case_sessions (session_id, scope, user_id, case_id, status, type, created_at, updated_at)
      VALUES (${sessionId}, 'case', ${testUser.id}, NULL, 1, 1, NOW(), NOW())
    `
    testIds.sessionIds.push(sessionId)

    const run = await createAgentRunDAO({
      sessionId,
      threadId: sessionId,
      userId: testUser.id,
      caseId: null,
      input: { message: 'hi' },
    })
    testIds.agentRunIds.push(run.id)

    const worker = new AgentWorker('test-broken-case-worker')
    await worker.processNextTask()

    const terminated = await waitForRunTermination(run.id)
    expect(terminated.status).toBe(AGENT_RUN_STATUS.FAILED)
    expect(terminated.error).toMatch(/缺失 caseId/)

    await worker.shutdown()
  })

  it.skip('scope=assistant 正常分流到 runAssistantChat（Task 8 后行为变更，改由 Task 19 E2E 验证）', async () => {
    // Task 6 占位 stub 阶段的断言：error 含 "尚未实现"。
    // Task 8 将 stub 替换为真实 runAssistantChat 后，测试环境无有效外部 API Key，
    // 行为会变成：节点缺失或模型调用失败等不同错误路径，不再匹配 /尚未实现/。
    // 为避免脆弱断言，此处在 Task 8 中标记为 skip，留待 Task 19 E2E 用真实账号回归。
    const sessionId = `assist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await (globalThis as any).prisma.caseSessions.create({
      data: {
        sessionId,
        scope: 'assistant',
        userId: testUser.id,
        caseId: null,
        status: 1,
        type: 1,
      },
    })
    testIds.sessionIds.push(sessionId)

    const run = await createAgentRunDAO({
      sessionId,
      threadId: sessionId,
      userId: testUser.id,
      caseId: null,
      input: { message: 'hi' },
    })
    testIds.agentRunIds.push(run.id)

    const worker = new AgentWorker('test-assist-stub-worker')
    await worker.processNextTask()

    const terminated = await waitForRunTermination(run.id)
    expect(terminated.status).toBe(AGENT_RUN_STATUS.FAILED)
    expect(terminated.error).toMatch(/尚未实现/)

    await worker.shutdown()
  })
})
