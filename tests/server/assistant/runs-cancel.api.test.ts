/**
 * Assistant Runs Cancel API 端到端测试
 *
 * 策略：直接 import handler default export，传入 mock event（含 auth 上下文、
 * getRouterParam 由 event.__params 填充），断言返回 body。
 * DAO 打真库（通过 test-db-helper 清理）。cancelRunService 通过 vi.mock 替身，
 * 专注验证 handler 的鉴权 / scope 校验逻辑。
 *
 * **Feature: legal-assistant-phase1**
 * **Validates: Task 13, spec §5.6.5**
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

// 全局 stub — 模拟 Nuxt nitro 的自动导入（test-setup 已装 prisma / logger）
const resError = (_event: any, code: number, message: string) => ({
    code,
    success: false,
    message,
    data: null,
})
const resSuccess = (_event: any, message: string, data: any) => ({
    code: 0,
    success: true,
    message,
    data,
})

    ; (globalThis as any).resError = resError
    ; (globalThis as any).resSuccess = resSuccess
    ; (globalThis as any).defineEventHandler = (h: any) => h
    ; (globalThis as any).getQuery = (event: any) => event.__query ?? {}
    ; (globalThis as any).readBody = async (event: any) => event.__body
    ; (globalThis as any).getRouterParam = (event: any, key: string) => event.__params?.[key]

// Mock cancelRunService：验证是否被调用，不真的跑业务
const cancelRunServiceMock = vi.fn(async (_runId: string) => ({ success: true }))
vi.mock('~~/server/services/agent/agentRun.service', () => ({
    cancelRunService: cancelRunServiceMock,
}))

// 动态 import handler（必须在全局 stub + mock 之后）
const { default: cancelHandler } = await import(
    '../../../server/api/v1/assistant/runs/cancel/[runId].post'
)

interface MockEvent {
    context: { auth?: { user: { id: number } } }
    __params?: Record<string, string>
}

function makeEvent(opts: {
    userId?: number
    params?: Record<string, string>
}): MockEvent {
    return {
        context: opts.userId ? { auth: { user: { id: opts.userId } } } : {},
        __params: opts.params,
    }
}

/**
 * 直接 insert 一条 agentRuns 行（测试不需要真正的 enqueue 全流程）
 */
async function insertTestRun(input: {
    userId: number
    sessionId: string
    status?: string
}): Promise<{ id: string }> {
    const row = await getTestPrisma().agentRuns.create({
        data: {
            sessionId: input.sessionId,
            threadId: input.sessionId,
            userId: input.userId,
            caseId: null,
            input: { message: '测试消息' },
            status: input.status ?? 'pending',
        },
        select: { id: true },
    })
    return row
}

describe('POST /api/v1/assistant/runs/cancel/:runId', () => {
    let testIds: CaseTestIds
    const createdRunIds: string[] = []

    beforeAll(() => {
        testIds = createEmptyTestIds()
    })

    afterEach(async () => {
        cancelRunServiceMock.mockClear()

        // 清理本轮创建的 runs
        if (createdRunIds.length > 0) {
            await getTestPrisma().agentRuns.deleteMany({
                where: { id: { in: createdRunIds } },
            })
            createdRunIds.length = 0
        }

        const snapshot: CaseTestIds = {
            ...createEmptyTestIds(),
            sessionIds: [...testIds.sessionIds],
            userIds: [...testIds.userIds],
            caseIds: [...testIds.caseIds],
            caseTypeIds: [...testIds.caseTypeIds],
        }
        if (
            snapshot.sessionIds.length > 0 ||
            snapshot.userIds.length > 0 ||
            snapshot.caseIds.length > 0 ||
            snapshot.caseTypeIds.length > 0
        ) {
            await cleanupTestData(snapshot)
        }
        testIds.sessionIds = []
        testIds.userIds = []
        testIds.caseIds = []
        testIds.caseTypeIds = []
    })

    afterAll(async () => {
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    it('未登录返回 401', async () => {
        const res: any = await cancelHandler(
            makeEvent({ params: { runId: 'any' } }) as any,
        )
        expect(res.code).toBe(401)
        expect(res.message).toContain('登录')
        expect(cancelRunServiceMock).not.toHaveBeenCalled()
    })

    it('runId 缺失返回 400', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const res: any = await cancelHandler(makeEvent({ userId: user.id }) as any)
        expect(res.code).toBe(400)
        expect(cancelRunServiceMock).not.toHaveBeenCalled()
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
        expect(cancelRunServiceMock).not.toHaveBeenCalled()
    })

    it('跨用户访问返回 403', async () => {
        const owner = await createTestUser()
        const intruder = await createTestUser()
        testIds.userIds.push(owner.id, intruder.id)

        const s = await createAssistantSessionDAO({ userId: owner.id })
        testIds.sessionIds.push(s.sessionId)

        const run = await insertTestRun({
            userId: owner.id,
            sessionId: s.sessionId,
        })
        createdRunIds.push(run.id)

        const res: any = await cancelHandler(
            makeEvent({
                userId: intruder.id,
                params: { runId: run.id },
            }) as any,
        )
        expect(res.code).toBe(403)
        expect(cancelRunServiceMock).not.toHaveBeenCalled()
    })

    it('scope=case 的 run 返回 403（不走 assistant 取消接口）', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        // 构造一个 scope='case' 的 session（不能走 assistant DAO，
        // 否则会强制 scope='assistant'）
        const prisma = getTestPrisma()

        // caseTypes + cases 是 case 域 session 的必要外键
        const caseType = await prisma.caseTypes.create({
            data: {
                name: `测试类型_scope_${Date.now()}`,
                description: '测试',
                priority: 1,
                status: 1,
            },
        })
        testIds.caseTypeIds.push(caseType.id)

        const caseRow = await prisma.cases.create({
            data: {
                title: `测试案件_scope_${Date.now()}`,
                content: '测试',
                caseTypeId: caseType.id,
                userId: user.id,
                status: 1,
            },
        })
        testIds.caseIds.push(caseRow.id)

        const caseSession = await prisma.caseSessions.create({
            data: {
                sessionId: crypto.randomUUID(),
                scope: 'case',
                userId: user.id,
                caseId: caseRow.id,
                type: 1,
                status: 1,
            },
        })
        testIds.sessionIds.push(caseSession.sessionId)

        const run = await insertTestRun({
            userId: user.id,
            sessionId: caseSession.sessionId,
        })
        createdRunIds.push(run.id)

        const res: any = await cancelHandler(
            makeEvent({
                userId: user.id,
                params: { runId: run.id },
            }) as any,
        )
        expect(res.code).toBe(403)
        expect(res.message).toContain('assistant')
        expect(cancelRunServiceMock).not.toHaveBeenCalled()
    })

    it('归属正确 + scope=assistant 成功取消', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const s = await createAssistantSessionDAO({ userId: user.id })
        testIds.sessionIds.push(s.sessionId)

        const run = await insertTestRun({
            userId: user.id,
            sessionId: s.sessionId,
        })
        createdRunIds.push(run.id)

        const res: any = await cancelHandler(
            makeEvent({
                userId: user.id,
                params: { runId: run.id },
            }) as any,
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

        const run = await insertTestRun({
            userId: user.id,
            sessionId: s.sessionId,
        })
        createdRunIds.push(run.id)

        cancelRunServiceMock.mockResolvedValueOnce({
            success: false,
            error: '模拟取消失败',
        })

        const res: any = await cancelHandler(
            makeEvent({
                userId: user.id,
                params: { runId: run.id },
            }) as any,
        )
        expect(res.code).toBe(400)
        expect(res.message).toContain('模拟取消失败')
    })
})
