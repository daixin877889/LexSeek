/**
 * AgentRun DAO 层测试
 *
 * **Feature: agent-background-queue**
 * **Validates: Task 3 - AgentRun 数据访问层**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
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
  createAgentRunDAO,
  findActiveRunBySessionIdDAO,
  claimPendingRunDAO,
  updateRunStatusDAO,
  updateHeartbeatDAO,
  findStaleRunsDAO,
  resetStaleRunDAO,
  countActiveRunsByUserIdDAO,
  findRunsBySessionIdDAO,
  deleteOldRunsDAO,
} from '../../../server/services/agent/agentRun.dao'
import { AGENT_RUN_STATUS } from '../../../shared/types/agentRun'

describe('AgentRun DAO 层', () => {
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
    // 清理每个测试创建的 agent runs
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

  describe('createAgentRunDAO', () => {
    it('正常创建 AgentRun', async () => {
      const run = await createAgentRunDAO({
        sessionId: testSession.sessionId,
        threadId: testSession.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: '分析案件' },
      })
      testIds.agentRunIds.push(run.id)

      expect(run.id).toBeDefined()
      expect(run.sessionId).toBe(testSession.sessionId)
      expect(run.status).toBe(AGENT_RUN_STATUS.PENDING)
      expect(run.input).toEqual({ message: '分析案件' })
      expect(run.workerId).toBeNull()
    })

    it('同 session 允许并存多条 run（partial unique 约束已移除）', async () => {
      // 业务侧已经移除 agent_runs_session_active_uq partial unique index
      // 历史回放/重启等场景需要同 session 多 run 共存，幂等由上层的
      // findActiveRunBySessionIdDAO + 分布式锁保证。
      const run1 = await createAgentRunDAO({
        sessionId: testSession.sessionId,
        threadId: testSession.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: '第一次' },
      })
      testIds.agentRunIds.push(run1.id)

      const run2 = await createAgentRunDAO({
        sessionId: testSession.sessionId,
        threadId: testSession.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: '第二次' },
      })
      testIds.agentRunIds.push(run2.id)

      expect(run2.id).not.toBe(run1.id)
      expect(run2.sessionId).toBe(run1.sessionId)
    })

    it('caseId=null 时应正常写入（assistant 域场景）', async () => {
      // 为 assistant 域创建一个 scope=assistant、caseId=null 的 session
      const p = (globalThis as any).prisma
      const assistantSessionId = `assist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      await p.caseSessions.create({
        data: {
          sessionId: assistantSessionId,
          scope: 'assistant',
          userId: testUser.id,
          caseId: null,
          type: 1,
          status: 1,
        },
      })
      testIds.sessionIds.push(assistantSessionId)

      const run = await createAgentRunDAO({
        sessionId: assistantSessionId,
        threadId: assistantSessionId,
        userId: testUser.id,
        caseId: null,
        input: { message: 'hello' },
      })
      testIds.agentRunIds.push(run.id)

      expect(run.caseId).toBeNull()
      expect(run.sessionId).toBe(assistantSessionId)
      expect(run.status).toBe(AGENT_RUN_STATUS.PENDING)
    })

    it('caseId=数字时保持兼容 case 域', async () => {
      // 复用已有 testSession（scope=case，caseId=testCase.id）
      // 但此 describe 顶部已为其 push 了 run，需要独立 session 避免 unique 冲突
      const session2 = await createTestSession(testCase.id)
      testIds.sessionIds.push(session2.sessionId)

      const run = await createAgentRunDAO({
        sessionId: session2.sessionId,
        threadId: session2.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: 'hi' },
      })
      testIds.agentRunIds.push(run.id)

      expect(run.caseId).toBe(testCase.id)
      expect(run.sessionId).toBe(session2.sessionId)
    })
  })

  describe('findActiveRunBySessionIdDAO', () => {
    it('查找活跃 run', async () => {
      const run = await createAgentRunDAO({
        sessionId: testSession.sessionId,
        threadId: testSession.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: '测试' },
      })
      testIds.agentRunIds.push(run.id)

      const found = await findActiveRunBySessionIdDAO(testSession.sessionId)
      expect(found).not.toBeNull()
      expect(found!.id).toBe(run.id)
    })

    it('无活跃 run 返回 null', async () => {
      const found = await findActiveRunBySessionIdDAO('nonexistent-session-id')
      expect(found).toBeNull()
    })
  })

  describe('claimPendingRunDAO', () => {
    it('取到 pending 任务并更新为 running', async () => {
      const run = await createAgentRunDAO({
        sessionId: testSession.sessionId,
        threadId: testSession.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: '待取任务' },
      })
      testIds.agentRunIds.push(run.id)

      const claimed = await claimPendingRunDAO('worker-test-1')
      expect(claimed).not.toBeNull()
      expect(claimed!.id).toBe(run.id)
      expect(claimed!.status).toBe(AGENT_RUN_STATUS.RUNNING)
      expect(claimed!.workerId).toBe('worker-test-1')
      expect(claimed!.startedAt).toBeInstanceOf(Date)
      expect(claimed!.heartbeatAt).toBeInstanceOf(Date)
    })

    it('无 pending 任务返回 null', async () => {
      const claimed = await claimPendingRunDAO('worker-test-2')
      expect(claimed).toBeNull()
    })
  })

  describe('updateRunStatusDAO', () => {
    it('更新状态为 completed', async () => {
      const run = await createAgentRunDAO({
        sessionId: testSession.sessionId,
        threadId: testSession.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: '即将完成' },
      })
      testIds.agentRunIds.push(run.id)

      const now = new Date()
      const updated = await updateRunStatusDAO(run.id, AGENT_RUN_STATUS.COMPLETED, {
        completedAt: now,
      })
      expect(updated.status).toBe(AGENT_RUN_STATUS.COMPLETED)
      expect(updated.completedAt).toEqual(now)
    })

    it('更新状态为 failed 并记录错误', async () => {
      const run = await createAgentRunDAO({
        sessionId: testSession.sessionId,
        threadId: testSession.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: '即将失败' },
      })
      testIds.agentRunIds.push(run.id)

      const updated = await updateRunStatusDAO(run.id, AGENT_RUN_STATUS.FAILED, {
        error: 'Agent 执行超时',
        completedAt: new Date(),
      })
      expect(updated.status).toBe(AGENT_RUN_STATUS.FAILED)
      expect(updated.error).toBe('Agent 执行超时')
    })
  })

  describe('updateHeartbeatDAO', () => {
    it('更新心跳并返回受影响行数', async () => {
      const run = await createAgentRunDAO({
        sessionId: testSession.sessionId,
        threadId: testSession.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: '心跳测试' },
      })
      testIds.agentRunIds.push(run.id)

      // 先 claim 使其变为 running
      const claimed = await claimPendingRunDAO('worker-heartbeat')
      expect(claimed).not.toBeNull()

      const count = await updateHeartbeatDAO('worker-heartbeat')
      expect(count).toBeGreaterThanOrEqual(1)
    })

    it('不存在的 worker 返回 0', async () => {
      const count = await updateHeartbeatDAO('worker-nonexistent')
      expect(count).toBe(0)
    })
  })

  describe('findStaleRunsDAO', () => {
    it('查找心跳超时的任务', async () => {
      const run = await createAgentRunDAO({
        sessionId: testSession.sessionId,
        threadId: testSession.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: 'stale 测试' },
      })
      testIds.agentRunIds.push(run.id)

      // claim 并设置一个很旧的心跳时间
      await claimPendingRunDAO('worker-stale')
      const p = (globalThis as any).prisma
      await p.agentRuns.update({
        where: { id: run.id },
        data: { heartbeatAt: new Date(Date.now() - 120_000) },
      })

      const staleRuns = await findStaleRunsDAO(60_000) // 60s 阈值
      expect(staleRuns.some((r: any) => r.id === run.id)).toBe(true)
    })
  })

  describe('resetStaleRunDAO', () => {
    it('重置超时任务为 pending', async () => {
      const run = await createAgentRunDAO({
        sessionId: testSession.sessionId,
        threadId: testSession.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: 'reset 测试' },
      })
      testIds.agentRunIds.push(run.id)

      await claimPendingRunDAO('worker-reset')

      const success = await resetStaleRunDAO(run.id, 'worker-reset')
      expect(success).toBe(true)

      // 验证已重置
      const found = await findActiveRunBySessionIdDAO(testSession.sessionId)
      expect(found).not.toBeNull()
      expect(found!.status).toBe(AGENT_RUN_STATUS.PENDING)
      expect(found!.workerId).toBeNull()
    })

    it('workerId 不匹配时返回 false', async () => {
      const run = await createAgentRunDAO({
        sessionId: testSession.sessionId,
        threadId: testSession.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: 'reset 失败测试' },
      })
      testIds.agentRunIds.push(run.id)

      await claimPendingRunDAO('worker-original')

      const success = await resetStaleRunDAO(run.id, 'worker-wrong')
      expect(success).toBe(false)
    })
  })

  describe('countActiveRunsByUserIdDAO', () => {
    it('统计用户活跃 run 数量', async () => {
      const run = await createAgentRunDAO({
        sessionId: testSession.sessionId,
        threadId: testSession.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: '计数测试' },
      })
      testIds.agentRunIds.push(run.id)

      const count = await countActiveRunsByUserIdDAO(testUser.id)
      expect(count).toBeGreaterThanOrEqual(1)
    })

    it('无活跃 run 时返回 0', async () => {
      const count = await countActiveRunsByUserIdDAO(999999)
      expect(count).toBe(0)
    })
  })

  describe('findRunsBySessionIdDAO', () => {
    it('按 session 查询 run 列表', async () => {
      const run = await createAgentRunDAO({
        sessionId: testSession.sessionId,
        threadId: testSession.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: '列表查询' },
      })
      testIds.agentRunIds.push(run.id)

      // 先完成它，再创建新的
      await updateRunStatusDAO(run.id, AGENT_RUN_STATUS.COMPLETED, { completedAt: new Date() })

      const session2 = await createTestSession(testCase.id)
      testIds.sessionIds.push(session2.sessionId)

      // 在同 session 再创建一条（此时 run1 已 completed，不触发 unique 约束）
      const run2 = await createAgentRunDAO({
        sessionId: testSession.sessionId,
        threadId: testSession.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: '第二条' },
      })
      testIds.agentRunIds.push(run2.id)

      const runs = await findRunsBySessionIdDAO(testSession.sessionId)
      expect(runs.length).toBeGreaterThanOrEqual(2)
      // 按 createdAt 降序
      expect(runs[0].createdAt.getTime()).toBeGreaterThanOrEqual(runs[1].createdAt.getTime())
    })
  })

  describe('deleteOldRunsDAO', () => {
    it('清理过期数据', async () => {
      const run = await createAgentRunDAO({
        sessionId: testSession.sessionId,
        threadId: testSession.sessionId,
        userId: testUser.id,
        caseId: testCase.id,
        input: { message: '清理测试' },
      })
      testIds.agentRunIds.push(run.id)

      // 完成它并设置很旧的创建时间
      await updateRunStatusDAO(run.id, AGENT_RUN_STATUS.COMPLETED, { completedAt: new Date() })
      const p = (globalThis as any).prisma
      await p.agentRuns.update({
        where: { id: run.id },
        data: { createdAt: new Date('2020-01-01') },
      })

      const deleted = await deleteOldRunsDAO(1) // 1天前
      expect(deleted).toBeGreaterThanOrEqual(1)

      // 从追踪列表移除（已被删除）
      testIds.agentRunIds = testIds.agentRunIds.filter(id => id !== run.id)
    })
  })
})
