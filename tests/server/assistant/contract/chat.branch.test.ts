/**
 * POST /api/v1/assistant/contract/chat handler 分支测试
 *
 * 策略：纯 mock 风格——通过 vi.mock 替换 DAO / agent / SSE 服务，直接调用 handler default export。
 * 覆盖 5 条早返回分支 + 1 条 INTERRUPTED 恢复分支（断言 caseId=null 核心 delta）：
 *  1. 未登录 → 401
 *  2. sessionId 空 → 400
 *  3. session 不存在 → 404
 *  4. session 属于他人 → 403
 *  5. 活跃 RUNNING + 新消息 → 429
 *  6. 活跃 INTERRUPTED + 新消息 → 旧 run 标 COMPLETED + enqueue(caseId=null)
 *
 * 其余分支（SSE 流 / enqueue 成功主路径）由 document/chat 同源逻辑覆盖。
 *
 * **Feature: contract-review-m4**
 * **Validates: Task 1.1（chat.post.ts）**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ==================== 全局 Stub（模拟 Nuxt nitro 自动导入）====================

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
;(globalThis as any).readBody = (event: any) => Promise.resolve(event.__body ?? {})
;(globalThis as any).setResponseHeaders = () => undefined
;(globalThis as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }

// ==================== Mock DAO / Service 层 ====================

vi.mock('~~/server/services/assistant/contract/contractReview.dao', () => ({
    findContractReviewBySessionIdDAO: vi.fn(),
}))

vi.mock('~~/server/services/agent/agentRun.dao', () => ({
    findActiveRunBySessionIdDAO: vi.fn(),
    findLatestRunBySessionIdDAO: vi.fn(),
    updateRunStatusDAO: vi.fn(),
}))

vi.mock('~~/server/services/agent/agentRun.service', () => ({
    enqueueRunService: vi.fn(),
}))

vi.mock('~~/server/services/sse/agentSseStream', () => ({
    createAgentSseStream: vi.fn(() => new ReadableStream()),
}))

import { findContractReviewBySessionIdDAO } from '~~/server/services/assistant/contract/contractReview.dao'
import {
    findActiveRunBySessionIdDAO,
    findLatestRunBySessionIdDAO,
    updateRunStatusDAO,
} from '~~/server/services/agent/agentRun.dao'
import { enqueueRunService } from '~~/server/services/agent/agentRun.service'
import { AGENT_RUN_STATUS } from '#shared/types/agentRun'

const mockFindReviewBySession = findContractReviewBySessionIdDAO as ReturnType<typeof vi.fn>
const mockFindActiveRun = findActiveRunBySessionIdDAO as ReturnType<typeof vi.fn>
const mockFindLatestRun = findLatestRunBySessionIdDAO as ReturnType<typeof vi.fn>
const mockUpdateRunStatus = updateRunStatusDAO as ReturnType<typeof vi.fn>
const mockEnqueueRun = enqueueRunService as ReturnType<typeof vi.fn>

// ==================== 动态 import handler（必须在 mock 之后）====================

const { default: chatHandler } = await import(
    '../../../../server/api/v1/assistant/contract/chat.post'
)

// ==================== 工具函数 ====================

interface MockEvent {
    context: { auth?: { user: { id: number } } }
    __body?: any
}

/**
 * 模拟 FetchStreamTransport（@langchain/vue）线协议请求体。
 * 顶层 `body` 允许用 `{ sessionId, message }` 扁平写法，自动封装成 input/config 结构。
 */
function makeEvent(opts: { userId?: number; body?: any }): MockEvent {
    const b = opts.body ?? {}
    const wireBody = {
        input: {
            messages: typeof b.message === 'string'
                ? [{ type: 'human', content: b.message }]
                : undefined,
            thinking: b.thinking,
        },
        config: { configurable: { thread_id: b.sessionId } },
        command: b.command,
    }
    return {
        context: opts.userId ? { auth: { user: { id: opts.userId } } } : {},
        __body: wireBody,
    }
}

const USER_A = 1001
const USER_B = 1002

function contractReview(overrides: Partial<Record<string, any>> = {}) {
    return {
        id: 42,
        userId: USER_A,
        sessionId: 'sess-contract-uuid',
        status: 'pending',
        ...overrides,
    }
}

// ==================== 测试 ====================

describe('POST /api/v1/assistant/contract/chat', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('未登录返回 401', async () => {
        const res: any = await chatHandler(
            makeEvent({ body: { sessionId: 'sess-x', message: 'hi' } }) as any,
        )
        expect(res.code).toBe(401)
        expect(mockFindReviewBySession).not.toHaveBeenCalled()
    })

    it('sessionId 为空返回 400', async () => {
        const res: any = await chatHandler(
            makeEvent({ userId: USER_A, body: { message: 'hi' } }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockFindReviewBySession).not.toHaveBeenCalled()
    })

    it('合同审查 session 不存在返回 404', async () => {
        mockFindReviewBySession.mockResolvedValue(null)
        const res: any = await chatHandler(
            makeEvent({
                userId: USER_A,
                body: { sessionId: 'sess-not-exist', message: 'hi' },
            }) as any,
        )
        expect(res.code).toBe(404)
        expect(res.message).toContain('合同审查会话不存在')
        expect(mockFindReviewBySession).toHaveBeenCalledWith('sess-not-exist')
    })

    it('合同审查属于他人返回 403', async () => {
        mockFindReviewBySession.mockResolvedValue(contractReview())
        const res: any = await chatHandler(
            makeEvent({
                userId: USER_B,
                body: { sessionId: 'sess-contract-uuid', message: 'hi' },
            }) as any,
        )
        expect(res.code).toBe(403)
        expect(res.message).toContain('无权访问该合同审查')
        expect(mockFindActiveRun).not.toHaveBeenCalled()
    })

    it('活跃 RUNNING + 新消息返回 429', async () => {
        mockFindReviewBySession.mockResolvedValue(contractReview())
        mockFindActiveRun.mockResolvedValue({
            id: 'run-running',
            status: 'running',
        })

        const res: any = await chatHandler(
            makeEvent({
                userId: USER_A,
                body: { sessionId: 'sess-contract-uuid', message: '再审一次' },
            }) as any,
        )
        expect(res.code).toBe(429)
        expect(res.message).toContain('等待')

        // 关键：没有触发入队或旧 run 释放
        expect(mockEnqueueRun).not.toHaveBeenCalled()
        expect(mockUpdateRunStatus).not.toHaveBeenCalled()
        expect(mockFindLatestRun).not.toHaveBeenCalled()
    })

    it('INTERRUPTED + 新消息：旧 run 置 COMPLETED 后入队 caseId=null', async () => {
        // contract vs document 的核心 delta：入队时 caseId 必须是 null（独立页，无案件绑定）
        mockFindReviewBySession.mockResolvedValue(contractReview())
        mockFindActiveRun.mockResolvedValue({
            id: 'run-old',
            status: AGENT_RUN_STATUS.INTERRUPTED,
        })
        mockEnqueueRun.mockResolvedValue({ runId: 'run-new' })

        const res: any = await chatHandler(
            makeEvent({
                userId: USER_A,
                body: { sessionId: 'sess-contract-uuid', message: '继续审查' },
            }) as any,
        )

        // 返回 SSE Response（Response 实例，不是 error envelope）
        expect(res).toBeInstanceOf(Response)

        // 旧 run 被标记 COMPLETED 以释放 partial unique index
        expect(mockUpdateRunStatus).toHaveBeenCalledTimes(1)
        expect(mockUpdateRunStatus).toHaveBeenCalledWith(
            'run-old',
            AGENT_RUN_STATUS.COMPLETED,
            expect.objectContaining({ completedAt: expect.any(Date) }),
        )

        // 入队参数断言：caseId=null 是 M4 契约核心
        expect(mockEnqueueRun).toHaveBeenCalledTimes(1)
        expect(mockEnqueueRun).toHaveBeenCalledWith(
            expect.objectContaining({
                sessionId: 'sess-contract-uuid',
                threadId: 'sess-contract-uuid',
                userId: USER_A,
                caseId: null,
                input: expect.objectContaining({ message: '继续审查' }),
            }),
        )
    })
})
