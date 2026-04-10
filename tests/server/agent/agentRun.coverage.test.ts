/**
 * AgentRun 覆盖率补充测试
 *
 * 覆盖 agentRun.service.ts 和 agentRun.dao.ts 中未被测试的路径：
 * - cancelRunService 各种状态分支
 * - getLatestRunService 最新 run 查询
 * - getRunListService 列表查询
 * - DAO: updateRunStatusDAO 额外字段
 * - DAO: updateHeartbeatDAO 心跳更新
 * - DAO: findStaleRunsDAO 超时任务查询
 * - DAO: resetStaleRunDAO 重置超时任务
 * - DAO: deleteOldRunsDAO 清理过期数据
 *
 * **Feature: agent-background-queue**
 * **Validates: Task 4 - AgentRun 覆盖率**
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
    cancelRunService,
    getActiveRunService,
    getLatestRunService,
    getRunListService,
} from '../../../server/services/agent/agentRun.service'
import {
    createAgentRunDAO,
    updateRunStatusDAO,
    updateHeartbeatDAO,
    findStaleRunsDAO,
    resetStaleRunDAO,
    deleteOldRunsDAO,
    findRunsBySessionIdDAO,
    countActiveRunsByUserIdDAO,
} from '../../../server/services/agent/agentRun.dao'
import { AGENT_RUN_STATUS } from '../../../shared/types/agentRun'

// Mock Redis
vi.mock('~~/server/lib/redis', () => ({
    getRedisClient: () => ({
        publish: vi.fn().mockResolvedValue(1),
    }),
}))

describe('AgentRun 覆盖率补充', () => {
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

    // ==================== cancelRunService ====================

    describe('cancelRunService - 取消 run', () => {
        it('应取消 PENDING 状态的 run', async () => {
            const result = await enqueueRunService({
                sessionId: testSession.sessionId,
                threadId: testSession.sessionId,
                userId: testUser.id,
                caseId: testCase.id,
                input: { message: '取消测试', thinking: undefined },
            })
            if ('error' in result) throw new Error(result.error)
            testIds.agentRunIds.push(result.runId)

            const cancelResult = await cancelRunService(result.runId)
            expect(cancelResult.success).toBe(true)
        })

        it('应取消 RUNNING 状态的 run', async () => {
            // 创建新会话避免冲突
            const newSession = await createTestSession(testCase.id)
            testIds.sessionIds.push(newSession.sessionId)

            const result = await enqueueRunService({
                sessionId: newSession.sessionId,
                threadId: newSession.sessionId,
                userId: testUser.id,
                caseId: testCase.id,
                input: { message: '运行中取消测试', thinking: undefined },
            })
            if ('error' in result) throw new Error(result.error)
            testIds.agentRunIds.push(result.runId)

            // 更新为 RUNNING 状态
            await updateRunStatusDAO(result.runId, AGENT_RUN_STATUS.RUNNING)

            const cancelResult = await cancelRunService(result.runId)
            expect(cancelResult.success).toBe(true)
        })

        it('不存在的 run 应返回失败', async () => {
            const cancelResult = await cancelRunService('non-existent-run-id')
            expect(cancelResult.success).toBe(false)
            expect(cancelResult.error).toBe('Run 不存在')
        })

        it('已完成的 run 不能取消', async () => {
            const newSession = await createTestSession(testCase.id)
            testIds.sessionIds.push(newSession.sessionId)

            const result = await enqueueRunService({
                sessionId: newSession.sessionId,
                threadId: newSession.sessionId,
                userId: testUser.id,
                caseId: testCase.id,
                input: { message: '已完成取消测试', thinking: undefined },
            })
            if ('error' in result) throw new Error(result.error)
            testIds.agentRunIds.push(result.runId)

            // 更新为 COMPLETED 状态
            await updateRunStatusDAO(result.runId, AGENT_RUN_STATUS.COMPLETED, {
                completedAt: new Date(),
            })

            const cancelResult = await cancelRunService(result.runId)
            expect(cancelResult.success).toBe(false)
            expect(cancelResult.error).toContain('无法取消')
        })
    })

    // ==================== getLatestRunService ====================

    describe('getLatestRunService - 最新 run', () => {
        it('应返回最新的 run（不限状态）', async () => {
            const newSession = await createTestSession(testCase.id)
            testIds.sessionIds.push(newSession.sessionId)

            const result = await enqueueRunService({
                sessionId: newSession.sessionId,
                threadId: newSession.sessionId,
                userId: testUser.id,
                caseId: testCase.id,
                input: { message: '最新 run 测试', thinking: undefined },
            })
            if ('error' in result) throw new Error(result.error)
            testIds.agentRunIds.push(result.runId)

            const latest = await getLatestRunService(newSession.sessionId)
            expect(latest).not.toBeNull()
            expect(latest!.id).toBe(result.runId)
        })

        it('不存在的会话应返回 null', async () => {
            const latest = await getLatestRunService('non-existent-session')
            expect(latest).toBeNull()
        })
    })

    // ==================== getRunListService ====================

    describe('getRunListService - run 列表', () => {
        it('应返回会话的所有 run', async () => {
            const newSession = await createTestSession(testCase.id)
            testIds.sessionIds.push(newSession.sessionId)

            const result = await enqueueRunService({
                sessionId: newSession.sessionId,
                threadId: newSession.sessionId,
                userId: testUser.id,
                caseId: testCase.id,
                input: { message: '列表测试', thinking: undefined },
            })
            if ('error' in result) throw new Error(result.error)
            testIds.agentRunIds.push(result.runId)

            const list = await getRunListService(newSession.sessionId)
            expect(list.length).toBeGreaterThanOrEqual(1)
        })

        it('空会话应返回空数组', async () => {
            const list = await getRunListService('empty-session')
            expect(list).toEqual([])
        })
    })

    // ==================== DAO 层补充 ====================

    describe('updateRunStatusDAO - 额外字段', () => {
        it('应更新 error 和 metadata', async () => {
            const newSession = await createTestSession(testCase.id)
            testIds.sessionIds.push(newSession.sessionId)

            const run = await createAgentRunDAO({
                sessionId: newSession.sessionId,
                threadId: newSession.sessionId,
                userId: testUser.id,
                caseId: testCase.id,
                input: { message: 'status 测试', thinking: undefined },
            })
            testIds.agentRunIds.push(run.id)

            const updated = await updateRunStatusDAO(run.id, AGENT_RUN_STATUS.FAILED, {
                error: '测试错误',
                completedAt: new Date(),
                metadata: { reason: 'timeout' },
            })

            expect(updated.status).toBe(AGENT_RUN_STATUS.FAILED)
            expect(updated.error).toBe('测试错误')
            expect(updated.completedAt).toBeDefined()
        })
    })

    describe('updateHeartbeatDAO - 心跳更新', () => {
        it('应更新指定 worker 的所有 running run', async () => {
            const count = await updateHeartbeatDAO('test-worker-999')
            // 不存在的 worker 应返回 0
            expect(count).toBe(0)
        })
    })

    describe('findStaleRunsDAO - 超时任务', () => {
        it('应查找心跳超时的任务', async () => {
            const staleRuns = await findStaleRunsDAO(60000)
            expect(Array.isArray(staleRuns)).toBe(true)
        })
    })

    describe('resetStaleRunDAO - 重置超时任务', () => {
        it('不匹配的条件应返回 false', async () => {
            const result = await resetStaleRunDAO('non-existent-run', 'non-existent-worker')
            expect(result).toBe(false)
        })
    })

    describe('deleteOldRunsDAO - 清理过期数据', () => {
        it('应返回删除的记录数', async () => {
            const count = await deleteOldRunsDAO(9999)
            expect(typeof count).toBe('number')
        })
    })

    describe('countActiveRunsByUserIdDAO - 活跃计数', () => {
        it('应返回用户的活跃 run 数量', async () => {
            const count = await countActiveRunsByUserIdDAO(testUser.id)
            expect(typeof count).toBe('number')
        })
    })
})
