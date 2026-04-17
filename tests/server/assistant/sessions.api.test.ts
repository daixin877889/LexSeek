/**
 * Assistant Sessions CRUD API 端到端测试
 *
 * 策略：直接 import handler default export，传入 mock event（含 auth 上下文、
 * getRouterParam / getQuery / readBody 由 H3 的 context 填充），断言返回 body。
 * DAO 打真库（通过 test-db-helper 清理）。
 *
 * Service 层已在 assistantSession.service.test.ts 做了业务覆盖，这里聚焦于
 * API handler 的鉴权、参数校验、404 跨用户语义、以及响应 shape。
 *
 * **Feature: legal-assistant-phase1**
 * **Validates: Task 10, spec §5.6.1-3**
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

// 模拟 Nuxt 服务端自动导入的全局函数
import { createAssistantSessionDAO } from '../../../server/services/assistant/assistantSession.dao'

// 全局 stub — 模拟 Nuxt nitro 的自动导入（test-setup 已装 prisma / logger）
// 与 shared/utils/apiResponse.ts 行为一致：success 为 code=0，error 的 code 为业务码。
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

// Mock getAssistantThreadState：避免引 LangGraph checkpointer（测试不需要真的拉 Postgres 的 checkpoints 表）
vi.mock('~~/server/services/workflow/agents', () => ({
    getAssistantThreadState: vi.fn(async () => ({ values: { messages: [] } })),
}))

// 动态 import handlers（必须在全局 stub 之后）
const { default: listHandler } = await import('../../../server/api/v1/assistant/sessions.get')
const { default: createHandler } = await import('../../../server/api/v1/assistant/sessions.post')
const { default: detailHandler } = await import('../../../server/api/v1/assistant/sessions/[id].get')
const { default: patchHandler } = await import('../../../server/api/v1/assistant/sessions/[id].patch')
const { default: deleteHandler } = await import('../../../server/api/v1/assistant/sessions/[id].delete')

interface MockEvent {
    context: { auth?: { user: { id: number } } }
    __query?: Record<string, any>
    __body?: any
    __params?: Record<string, string>
}

function makeEvent(opts: {
    userId?: number
    query?: Record<string, any>
    body?: any
    params?: Record<string, string>
}): MockEvent {
    return {
        context: opts.userId ? { auth: { user: { id: opts.userId } } } : {},
        __query: opts.query,
        __body: opts.body,
        __params: opts.params,
    }
}

describe('Assistant Sessions CRUD API', () => {
    let testIds: CaseTestIds

    beforeAll(() => {
        testIds = createEmptyTestIds()
    })

    afterEach(async () => {
        const snapshot: CaseTestIds = {
            ...createEmptyTestIds(),
            sessionIds: [...testIds.sessionIds],
            userIds: [...testIds.userIds],
        }
        if (snapshot.sessionIds.length > 0 || snapshot.userIds.length > 0) {
            await cleanupTestData(snapshot)
        }
        testIds.sessionIds = []
        testIds.userIds = []
    })

    afterAll(async () => {
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    describe('POST /api/v1/assistant/sessions', () => {
        it('未登录返回 401', async () => {
            const res: any = await createHandler(makeEvent({ body: {} }) as any)
            expect(res.code).toBe(401)
            expect(res.message).toContain('登录')
        })

        it('登录用户创建会话返回 sessionId + title=null', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const res: any = await createHandler(
                makeEvent({ userId: user.id, body: {} }) as any,
            )
            expect(res.success).toBe(true)
            expect(res.data.sessionId).toMatch(/^[0-9a-f-]{36}$/)
            expect(res.data.title).toBeNull()

            testIds.sessionIds.push(res.data.sessionId)
        })

        it('支持传 title 创建会话', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const res: any = await createHandler(
                makeEvent({ userId: user.id, body: { title: '我的会话' } }) as any,
            )
            expect(res.success).toBe(true)
            expect(res.data.title).toBe('我的会话')

            testIds.sessionIds.push(res.data.sessionId)
        })

        it('title 超长返回 400', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const res: any = await createHandler(
                makeEvent({
                    userId: user.id,
                    body: { title: 'x'.repeat(201) },
                }) as any,
            )
            expect(res.code).toBe(400)
        })
    })

    describe('GET /api/v1/assistant/sessions', () => {
        it('未登录返回 401', async () => {
            const res: any = await listHandler(makeEvent({}) as any)
            expect(res.code).toBe(401)
        })

        it('只返回当前用户的 assistant session', async () => {
            const userA = await createTestUser()
            const userB = await createTestUser()
            testIds.userIds.push(userA.id, userB.id)

            const sa = await createAssistantSessionDAO({ userId: userA.id, title: 'A' })
            const sb = await createAssistantSessionDAO({ userId: userB.id, title: 'B' })
            testIds.sessionIds.push(sa.sessionId, sb.sessionId)

            const res: any = await listHandler(
                makeEvent({ userId: userA.id, query: {} }) as any,
            )
            expect(res.success).toBe(true)
            expect(res.data.total).toBe(1)
            expect(res.data.list[0].sessionId).toBe(sa.sessionId)
            expect(res.data.page).toBe(1)
            expect(res.data.pageSize).toBe(20)
        })

        it('非法 page 返回 400', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const res: any = await listHandler(
                makeEvent({ userId: user.id, query: { page: '-1' } }) as any,
            )
            expect(res.code).toBe(400)
        })
    })

    describe('GET /api/v1/assistant/sessions/:id', () => {
        it('未登录返回 401', async () => {
            const res: any = await detailHandler(
                makeEvent({ params: { id: 'xxx' } }) as any,
            )
            expect(res.code).toBe(401)
        })

        it('返回会话详情 + 空 messages 数组', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const s = await createAssistantSessionDAO({ userId: user.id, title: 'Detail' })
            testIds.sessionIds.push(s.sessionId)

            const res: any = await detailHandler(
                makeEvent({
                    userId: user.id,
                    params: { id: s.sessionId },
                }) as any,
            )
            expect(res.success).toBe(true)
            expect(res.data.sessionId).toBe(s.sessionId)
            expect(res.data.title).toBe('Detail')
            expect(Array.isArray(res.data.messages)).toBe(true)
        })

        it('跨用户访问返回 404', async () => {
            const owner = await createTestUser()
            const intruder = await createTestUser()
            testIds.userIds.push(owner.id, intruder.id)

            const s = await createAssistantSessionDAO({ userId: owner.id })
            testIds.sessionIds.push(s.sessionId)

            const res: any = await detailHandler(
                makeEvent({
                    userId: intruder.id,
                    params: { id: s.sessionId },
                }) as any,
            )
            expect(res.code).toBe(404)
        })
    })

    describe('PATCH /api/v1/assistant/sessions/:id', () => {
        it('修改 title 成功返回 sessionId + title', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const s = await createAssistantSessionDAO({ userId: user.id })
            testIds.sessionIds.push(s.sessionId)

            const res: any = await patchHandler(
                makeEvent({
                    userId: user.id,
                    params: { id: s.sessionId },
                    body: { title: '新标题' },
                }) as any,
            )
            expect(res.success).toBe(true)
            expect(res.data.title).toBe('新标题')

            const row = await getTestPrisma().caseSessions.findFirst({
                where: { sessionId: s.sessionId },
            })
            expect(row?.title).toBe('新标题')
        })

        it('title 为空返回 400', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const s = await createAssistantSessionDAO({ userId: user.id })
            testIds.sessionIds.push(s.sessionId)

            const res: any = await patchHandler(
                makeEvent({
                    userId: user.id,
                    params: { id: s.sessionId },
                    body: { title: '' },
                }) as any,
            )
            expect(res.code).toBe(400)
        })

        it('跨用户修改返回 404', async () => {
            const owner = await createTestUser()
            const intruder = await createTestUser()
            testIds.userIds.push(owner.id, intruder.id)

            const s = await createAssistantSessionDAO({ userId: owner.id })
            testIds.sessionIds.push(s.sessionId)

            const res: any = await patchHandler(
                makeEvent({
                    userId: intruder.id,
                    params: { id: s.sessionId },
                    body: { title: '篡改' },
                }) as any,
            )
            expect(res.code).toBe(404)
        })
    })

    describe('DELETE /api/v1/assistant/sessions/:id', () => {
        it('软删成功后列表不包含', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const s = await createAssistantSessionDAO({ userId: user.id })
            testIds.sessionIds.push(s.sessionId)

            const delRes: any = await deleteHandler(
                makeEvent({
                    userId: user.id,
                    params: { id: s.sessionId },
                }) as any,
            )
            expect(delRes.success).toBe(true)

            const listRes: any = await listHandler(
                makeEvent({ userId: user.id, query: {} }) as any,
            )
            expect(listRes.data.total).toBe(0)

            // 且数据库里 deletedAt 非空
            const row = await getTestPrisma().caseSessions.findFirst({
                where: { sessionId: s.sessionId },
            })
            expect(row?.deletedAt).not.toBeNull()
        })

        it('跨用户删除返回 404', async () => {
            const owner = await createTestUser()
            const intruder = await createTestUser()
            testIds.userIds.push(owner.id, intruder.id)

            const s = await createAssistantSessionDAO({ userId: owner.id })
            testIds.sessionIds.push(s.sessionId)

            const res: any = await deleteHandler(
                makeEvent({
                    userId: intruder.id,
                    params: { id: s.sessionId },
                }) as any,
            )
            expect(res.code).toBe(404)
        })
    })
})
