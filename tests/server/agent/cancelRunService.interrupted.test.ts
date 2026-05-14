/**
 * cancelRunService 对 INTERRUPTED 状态的处理
 *
 * **Feature: ai-stop-and-queue**
 * **Validates: spec §6.2**
 *
 * 治本前：cancelRunService 对 INTERRUPTED 返回幂等成功但不改 status,
 * 与 findActiveRunBySessionIdDAO 将 INTERRUPTED 视为活跃的判定矛盾,
 * 导致后续消息被拦截或卡死。
 *
 * 治本后：INTERRUPTED 走显式分支,改 status=CANCELLED + 调
 * repairOrphanToolUseCheckpoint 释放 orphan tool_use。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import './test-setup'
import {
    createTestUser,
    createEmptyTestIds,
    cleanupTestData,
    disconnectTestDb,
    getTestPrisma,
    type AgentTestIds,
} from './test-db-helper'
import { createAssistantSessionDAO } from '../../../server/services/assistant/assistantSession.dao'
import { cancelRunService } from '../../../server/services/agent/agentRun.service'
import { findActiveRunBySessionIdDAO } from '../../../server/services/agent/agentRun.dao'
import { AGENT_RUN_STATUS } from '#shared/types/agentRun'

// Mock Redis（测试环境无 Redis）
vi.mock('~~/server/lib/redis', () => ({
    getRedisClient: () => ({
        publish: vi.fn().mockResolvedValue(1),
    }),
}))

// repairOrphanToolUseCheckpoint mock — 只验证被调用 + 入参
// vi.hoisted 确保变量在 vi.mock hoisting 之前初始化
const { repairMock } = vi.hoisted(() => ({
    repairMock: vi.fn(async (_sessionId: string, _msg: string) => ({
        fixed: 0,
        parseFailures: 0,
    })),
}))
vi.mock('~~/server/services/workflow/repairOrphanToolUse', () => ({
    repairOrphanToolUseCheckpoint: repairMock,
}))

describe('cancelRunService — INTERRUPTED 分支', () => {
    let testIds: AgentTestIds
    const createdRunIds: string[] = []

    beforeAll(() => {
        testIds = createEmptyTestIds()
    })

    afterEach(async () => {
        repairMock.mockClear()
        if (createdRunIds.length > 0) {
            await getTestPrisma().agentRuns.deleteMany({
                where: { id: { in: createdRunIds } },
            })
            createdRunIds.length = 0
        }
        if (testIds.sessionIds.length > 0 || testIds.userIds.length > 0) {
            await cleanupTestData(testIds)
            testIds = createEmptyTestIds()
        }
    })

    afterAll(async () => {
        await disconnectTestDb()
    })

    it('对 INTERRUPTED 状态的 run，cancel 必须改 status 为 CANCELLED + 写 completedAt', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const s = await createAssistantSessionDAO({ userId: user.id })
        testIds.sessionIds.push(s.sessionId)

        const run = await getTestPrisma().agentRuns.create({
            data: {
                sessionId: s.sessionId,
                threadId: s.sessionId,
                userId: user.id,
                caseId: null,
                input: { message: '测试' },
                status: AGENT_RUN_STATUS.INTERRUPTED,
            },
            select: { id: true },
        })
        createdRunIds.push(run.id)

        const result = await cancelRunService(run.id)
        expect(result.success).toBe(true)

        const after = await getTestPrisma().agentRuns.findUnique({
            where: { id: run.id },
        })
        expect(after?.status).toBe(AGENT_RUN_STATUS.CANCELLED)
        expect(after?.completedAt).toBeInstanceOf(Date)
    })

    it('对 INTERRUPTED 的 cancel 应调用 repairOrphanToolUseCheckpoint', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)
        const s = await createAssistantSessionDAO({ userId: user.id })
        testIds.sessionIds.push(s.sessionId)

        const run = await getTestPrisma().agentRuns.create({
            data: {
                sessionId: s.sessionId,
                threadId: s.sessionId,
                userId: user.id,
                caseId: null,
                input: { message: '测试' },
                status: AGENT_RUN_STATUS.INTERRUPTED,
            },
            select: { id: true },
        })
        createdRunIds.push(run.id)

        await cancelRunService(run.id)

        expect(repairMock).toHaveBeenCalledTimes(1)
        expect(repairMock).toHaveBeenCalledWith(
            s.sessionId,
            expect.stringContaining('取消'),
        )
    })

    it('cancel 之后 findActiveRunBySessionIdDAO 应返回 null（活跃锁已释放）', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)
        const s = await createAssistantSessionDAO({ userId: user.id })
        testIds.sessionIds.push(s.sessionId)

        const run = await getTestPrisma().agentRuns.create({
            data: {
                sessionId: s.sessionId,
                threadId: s.sessionId,
                userId: user.id,
                caseId: null,
                input: { message: '测试' },
                status: AGENT_RUN_STATUS.INTERRUPTED,
            },
            select: { id: true },
        })
        createdRunIds.push(run.id)

        await cancelRunService(run.id)

        const active = await findActiveRunBySessionIdDAO(s.sessionId)
        expect(active).toBeNull()
    })
})
