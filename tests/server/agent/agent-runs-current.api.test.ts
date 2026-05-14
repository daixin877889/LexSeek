/**
 * 通用 AI 任务查询接口（vertical 无关）
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
import { AGENT_RUN_STATUS } from '#shared/types/agentRun'

// 与现有 runs-cancel.api.test.ts 对齐：全局 stub 模拟 Nitro 自动导入
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
;(globalThis as any).resError = resError
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).getQuery = (event: any) => event.__query ?? {}
;(globalThis as any).readBody = async (event: any) => event.__body
;(globalThis as any).getRouterParam = (event: any, key: string) => event.__params?.[key]

const { default: currentHandler } = await import(
    '../../../server/api/v1/agent/runs/current/[sessionId].get'
)

function makeEvent(opts: { userId?: number; params?: Record<string, string> }) {
    return {
        context: opts.userId ? { auth: { user: { id: opts.userId } } } : {},
        __params: opts.params,
    }
}

describe('GET /api/v1/agent/runs/current/:sessionId', () => {
    let testIds: CaseTestIds
    const createdRunIds: string[] = []

    beforeAll(() => {
        testIds = createEmptyTestIds()
    })

    afterEach(async () => {
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

    it('未登录返回 401', async () => {
        const res: any = await currentHandler(
            makeEvent({ params: { sessionId: 'any' } }) as any,
        )
        expect(res.code).toBe(401)
    })

    it('sessionId 缺失返回 400', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)
        const res: any = await currentHandler(makeEvent({ userId: user.id }) as any)
        expect(res.code).toBe(400)
    })

    it('归属正确且有活跃 run 返回 run 对象（assistant scope，caseId=null 也能查）', async () => {
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
                status: AGENT_RUN_STATUS.RUNNING,
            },
            select: { id: true },
        })
        createdRunIds.push(run.id)

        const res: any = await currentHandler(
            makeEvent({
                userId: user.id,
                params: { sessionId: s.sessionId },
            }) as any,
        )
        expect(res.success).toBe(true)
        expect(res.data.run.id).toBe(run.id)
    })

    it('无活跃 run 返回 run=null', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)
        const s = await createAssistantSessionDAO({ userId: user.id })
        testIds.sessionIds.push(s.sessionId)

        const res: any = await currentHandler(
            makeEvent({
                userId: user.id,
                params: { sessionId: s.sessionId },
            }) as any,
        )
        expect(res.success).toBe(true)
        expect(res.data.run).toBeNull()
    })

    it('跨用户访问返回 403（归属校验）', async () => {
        const owner = await createTestUser()
        const intruder = await createTestUser()
        testIds.userIds.push(owner.id, intruder.id)

        const s = await createAssistantSessionDAO({ userId: owner.id })
        testIds.sessionIds.push(s.sessionId)

        const run = await getTestPrisma().agentRuns.create({
            data: {
                sessionId: s.sessionId,
                threadId: s.sessionId,
                userId: owner.id,
                caseId: null,
                input: { message: '测试' },
                status: AGENT_RUN_STATUS.PENDING,
            },
            select: { id: true },
        })
        createdRunIds.push(run.id)

        const res: any = await currentHandler(
            makeEvent({
                userId: intruder.id,
                params: { sessionId: s.sessionId },
            }) as any,
        )
        expect(res.code).toBe(403)
    })
})
