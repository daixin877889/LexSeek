/**
 * AgentRun 服务层测试
 *
 * **Feature: agent-background-queue**
 * **Validates: Task 4 - AgentRun 服务层**
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
import {
  enqueueRunService,
  getActiveRunService,
  cancelRunService,
  getRunListService,
} from '../../../server/services/agent/agentRun.service'
import { updateRunStatusDAO } from '../../../server/services/agent/agentRun.dao'
import { AGENT_RUN_STATUS } from '../../../shared/types/agentRun'

// Mock Redis（测试环境无 Redis）
vi.mock('~~/server/lib/redis', () => ({
  getRedisClient: () => ({
    publish: vi.fn().mockResolvedValue(1),
  }),
}))

describe('AgentRun 服务层', () => {
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

  describe('enqueueRunService', () => {
    it('正常入队新 run', async () => {
      const result = await enqueueRunService({
        sessionId: testSession.sessionId,
        threadId: testSession.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: '分析案件' },
      })

      expect('error' in result).toBe(false)
      if (!('error' in result)) {
        expect(result.runId).toBeDefined()
        expect(result.isNew).toBe(true)
        testIds.agentRunIds.push(result.runId)
      }
    })

    it('已有活跃 run 时返回已存在的 runId', async () => {
      // 先创建一个 run
      const first = await enqueueRunService({
        sessionId: testSession.sessionId,
        threadId: testSession.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: '第一次' },
      })
      expect('error' in first).toBe(false)
      if (!('error' in first)) {
        testIds.agentRunIds.push(first.runId)
      }

      // 再次入队同 session
      const second = await enqueueRunService({
        sessionId: testSession.sessionId,
        threadId: testSession.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: '第二次' },
      })

      expect('error' in second).toBe(false)
      if (!('error' in second) && !('error' in first)) {
        expect(second.runId).toBe(first.runId)
        expect(second.isNew).toBe(false)
      }
    })

    it('用户并发超限时返回错误', async () => {
      try {
        // 先入队一个
        const first = await enqueueRunService({
          sessionId: testSession.sessionId,
          threadId: testSession.sessionId,
          userId: testUser.id,
          caseId: testCase.id,
          input: { message: '占位' },
        })
        if (!('error' in first)) {
          testIds.agentRunIds.push(first.runId)
        }

        // 创建另一个 session
        const session2 = await createTestSession(testCase.id)
        testIds.sessionIds.push(session2.sessionId)

        // 再入队不同 session（同用户），通过 options 设置 maxUserConcurrent=1
        const second = await enqueueRunService({
          sessionId: session2.sessionId,
          threadId: session2.sessionId,
          userId: testUser.id,
          caseId: testCase.id,
          input: { message: '超限' },
        }, { maxUserConcurrent: 1 })

        expect('error' in second).toBe(true)
        if ('error' in second) {
          expect(second.error).toContain('最大并发')
        }
      }
      finally {
        // 无需清理
      }
    })
  })

  describe('getActiveRunService', () => {
    it('查找当前活跃 run', async () => {
      const result = await enqueueRunService({
        sessionId: testSession.sessionId,
        threadId: testSession.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: '活跃 run' },
      })
      if (!('error' in result)) {
        testIds.agentRunIds.push(result.runId)
      }

      const active = await getActiveRunService(testSession.sessionId)
      expect(active).not.toBeNull()
      expect(active!.status).toMatch(/pending|running/)
    })

    it('无活跃 run 返回 null', async () => {
      const active = await getActiveRunService('no-such-session')
      expect(active).toBeNull()
    })
  })

  describe('cancelRunService', () => {
    it('取消 pending 状态的 run', async () => {
      const result = await enqueueRunService({
        sessionId: testSession.sessionId,
        threadId: testSession.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: '待取消' },
      })
      if (!('error' in result)) {
        testIds.agentRunIds.push(result.runId)

        const cancelResult = await cancelRunService(result.runId)
        expect(cancelResult.success).toBe(true)

        // 验证状态已变更
        const p = (globalThis as any).prisma
        const run = await p.agentRuns.findUnique({ where: { id: result.runId } })
        expect(run.status).toBe(AGENT_RUN_STATUS.CANCELLED)
      }
    })

    it('取消 running 状态的 run', async () => {
      const result = await enqueueRunService({
        sessionId: testSession.sessionId,
        threadId: testSession.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: '运行中取消' },
      })
      if (!('error' in result)) {
        testIds.agentRunIds.push(result.runId)

        // 手动更新为 running
        await updateRunStatusDAO(result.runId, AGENT_RUN_STATUS.RUNNING)

        const cancelResult = await cancelRunService(result.runId)
        expect(cancelResult.success).toBe(true)

        const p = (globalThis as any).prisma
        const run = await p.agentRuns.findUnique({ where: { id: result.runId } })
        expect(run.status).toBe(AGENT_RUN_STATUS.CANCELLED)
      }
    })

    it('不存在的 run 返回错误', async () => {
      const result = await cancelRunService('nonexistent-id')
      expect(result.success).toBe(false)
      expect(result.error).toContain('不存在')
    })

    it('已完成的 run 无法取消', async () => {
      const enqueued = await enqueueRunService({
        sessionId: testSession.sessionId,
        threadId: testSession.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: '已完成' },
      })
      if (!('error' in enqueued)) {
        testIds.agentRunIds.push(enqueued.runId)
        await updateRunStatusDAO(enqueued.runId, AGENT_RUN_STATUS.COMPLETED, {
          completedAt: new Date(),
        })

        const result = await cancelRunService(enqueued.runId)
        expect(result.success).toBe(false)
        expect(result.error).toContain('无法取消')
      }
    })
  })

  describe('getRunListService', () => {
    it('查询 session 的 run 列表', async () => {
      // 创建并完成一个 run
      const first = await enqueueRunService({
        sessionId: testSession.sessionId,
        threadId: testSession.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: '列表第一条' },
      })
      if (!('error' in first)) {
        testIds.agentRunIds.push(first.runId)
        await updateRunStatusDAO(first.runId, AGENT_RUN_STATUS.COMPLETED, {
          completedAt: new Date(),
        })
      }

      // 创建第二个
      const second = await enqueueRunService({
        sessionId: testSession.sessionId,
        threadId: testSession.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: '列表第二条' },
      })
      if (!('error' in second)) {
        testIds.agentRunIds.push(second.runId)
      }

      const runs = await getRunListService(testSession.sessionId)
      expect(runs.length).toBeGreaterThanOrEqual(2)
    })
  })
})
