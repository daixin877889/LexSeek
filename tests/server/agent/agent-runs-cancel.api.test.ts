/**
 * 通用 AI 任务取消接口（vertical 无关）
 *
 * **Feature: ai-stop-and-queue**
 * **Validates: spec §6.1**
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import '../case/test-setup'
import {
    createTestUser,
    createEmptyTestIds,
    cleanupTestData,
    disconnectTestDb,
    getTestPrisma,
    type CaseTestIds,
} from '../case/test-db-helper'
import { createAssistantSessionDAO } from '../../../server/services/assistant/assistantSession.dao'

const resError = (_event: any, code: number, message: string) => ({
    code, success: false, message, data: null,
})
const resSuccess = (_event: any, message: string, data: any) => ({
    code: 0, success: true, message, data,
})
;(globalThis as any).resError = resError
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).getRouterParam = (event: any, key: string) => event.__params?.[key]

// vi.hoisted 模式（与 Task 1 测试一致），避免 vi.mock 提升导致变量未初始化
const { cancelRunServiceMock } = vi.hoisted(() => ({
    cancelRunServiceMock: vi.fn(async (_runId: string) => ({ success: true })),
}))
vi.mock('~~/server/services/agent/agentRun.service', () => ({
    cancelRunService: cancelRunServiceMock,
}))

const { default: cancelHandler } = await import(
    '../../../server/api/v1/agent/runs/cancel/[runId].post'
)

function makeEvent(opts: { userId?: number; params?: Record<string, string> }) {
    return {
        context: opts.userId ? { auth: { user: { id: opts.userId } } } : {},
        __params: opts.params,
    }
}

async function insertTestRun(input: { userId: number; sessionId: string; status?: string }) {
    return getTestPrisma().agentRuns.create({
        data: {
            sessionId: input.sessionId,
            threadId: input.sessionId,
            userId: input.userId,
            caseId: null,
            input: { message: '测试' },
            status: input.status ?? 'pending',
        },
        select: { id: true },
    })
}

describe('POST /api/v1/agent/runs/cancel/:runId', () => {
    let testIds: CaseTestIds
    const createdRunIds: string[] = []

    beforeAll(() => { testIds = createEmptyTestIds() })

    afterEach(async () => {
        cancelRunServiceMock.mockClear()
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

    afterAll(async () => { await disconnectTestDb() })

    it('未登录返回 401', async () => {
        const res: any = await cancelHandler(makeEvent({ params: { runId: 'any' } }) as any)
        expect(res.code).toBe(401)
        expect(cancelRunServiceMock).not.toHaveBeenCalled()
    })

    it('runId 缺失返回 400', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)
        const res: any = await cancelHandler(makeEvent({ userId: user.id }) as any)
        expect(res.code).toBe(400)
    })

    it('run 不存在返回 404', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)
        const res: any = await cancelHandler(
            makeEvent({
                userId: user.id,
                params: { runId: '00000000-0000-0000-0000-000000000000' },
            }) as any,
        )
        expect(res.code).toBe(404)
    })

    it('跨用户访问返回 403', async () => {
        const owner = await createTestUser()
        const intruder = await createTestUser()
        testIds.userIds.push(owner.id, intruder.id)

        const s = await createAssistantSessionDAO({ userId: owner.id })
        testIds.sessionIds.push(s.sessionId)

        const run = await insertTestRun({ userId: owner.id, sessionId: s.sessionId })
        createdRunIds.push(run.id)

        const res: any = await cancelHandler(
            makeEvent({ userId: intruder.id, params: { runId: run.id } }) as any,
        )
        expect(res.code).toBe(403)
        expect(cancelRunServiceMock).not.toHaveBeenCalled()
    })

    it('归属正确：vertical 无关地取消（assistant scope 也能用，不再 scope 校验）', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const s = await createAssistantSessionDAO({ userId: user.id })
        testIds.sessionIds.push(s.sessionId)

        const run = await insertTestRun({ userId: user.id, sessionId: s.sessionId })
        createdRunIds.push(run.id)

        const res: any = await cancelHandler(
            makeEvent({ userId: user.id, params: { runId: run.id } }) as any,
        )
        expect(res.success).toBe(true)
        expect(res.data).toEqual({ cancelled: true })
        expect(cancelRunServiceMock).toHaveBeenCalledTimes(1)
        expect(cancelRunServiceMock).toHaveBeenCalledWith(run.id)
    })

    it('cancelRunService 返回失败时返回 400', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)
        const s = await createAssistantSessionDAO({ userId: user.id })
        testIds.sessionIds.push(s.sessionId)

        const run = await insertTestRun({ userId: user.id, sessionId: s.sessionId })
        createdRunIds.push(run.id)

        cancelRunServiceMock.mockResolvedValueOnce({ success: false, error: '模拟失败' })

        const res: any = await cancelHandler(
            makeEvent({ userId: user.id, params: { runId: run.id } }) as any,
        )
        expect(res.code).toBe(400)
        expect(res.message).toContain('模拟失败')
    })
})
