/**
 * POST /api/v1/assistant/contract/reviews/:id/stance handler 测试
 *
 * 覆盖 8 条路径：
 *  - 未登录 → 401
 *  - review 属于他人 → 403
 *  - 非 awaiting_stance 状态 → 200 幂等（不调 enqueueRunService / findActiveRunBySessionIdDAO）
 *  - stance 参数非法 → 400
 *  - reviewId 无效（非整数/≤0）→ 400
 *  - happy path（无 activeRun）→ 200，不调 updateRunStatusDAO
 *  - 旧 run INTERRUPTED → updateRunStatusDAO('runId', 'completed', ...) 被调用 1 次
 *  - enqueueRunService 返回 { error } → 429
 *
 * **Feature: contract-review-m3**
 * **Validates: Task 9.1 + 9.2**
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
;(globalThis as any).getRouterParam = (event: any, key: string) => event.__params?.[key]
;(globalThis as any).readBody = (event: any) => Promise.resolve(event.__body ?? {})
;(globalThis as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }

// ==================== Mock DAO / Service 层 ====================

vi.mock('~~/server/services/assistant/contract/contractReview.dao', () => ({
    getContractReviewDAO: vi.fn(),
}))

vi.mock('~~/server/services/agent/agentRun.service', () => ({
    enqueueRunService: vi.fn(),
}))

vi.mock('~~/server/services/agent/agentRun.dao', () => ({
    findActiveRunBySessionIdDAO: vi.fn(),
    updateRunStatusDAO: vi.fn(),
}))

import { getContractReviewDAO } from '~~/server/services/assistant/contract/contractReview.dao'
import { enqueueRunService } from '~~/server/services/agent/agentRun.service'
import {
    findActiveRunBySessionIdDAO,
    updateRunStatusDAO,
} from '~~/server/services/agent/agentRun.dao'

const mockGetContractReviewDAO = getContractReviewDAO as ReturnType<typeof vi.fn>
const mockEnqueueRunService = enqueueRunService as ReturnType<typeof vi.fn>
const mockFindActiveRunBySessionIdDAO = findActiveRunBySessionIdDAO as ReturnType<typeof vi.fn>
const mockUpdateRunStatusDAO = updateRunStatusDAO as ReturnType<typeof vi.fn>

// ==================== 动态 import handler（必须在 mock 之后）====================

const { default: stanceHandler } = await import(
    '../../../../server/api/v1/assistant/contract/reviews/[id]/stance.post'
)

// ==================== 工具函数 ====================

interface MockEvent {
    context: { auth?: { user: { id: number } } }
    __params?: Record<string, string>
    __body?: any
}

function makeEvent(opts: {
    userId?: number
    params?: Record<string, string>
    body?: any
}): MockEvent {
    return {
        context: opts.userId ? { auth: { user: { id: opts.userId } } } : {},
        __params: opts.params,
        __body: opts.body,
    }
}

const USER_A = 1001
const USER_B = 1002

function awaitingReview(overrides: Partial<Record<string, any>> = {}) {
    return {
        id: 42,
        userId: USER_A,
        sessionId: 'sess-contract-uuid',
        status: 'awaiting_stance',
        ...overrides,
    }
}

// ==================== 测试 ====================

describe('POST /api/v1/assistant/contract/reviews/:id/stance', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('未登录返回 401', async () => {
        const res: any = await stanceHandler(
            makeEvent({ params: { id: '42' }, body: { stance: 'partyA' } }) as any,
        )
        expect(res.code).toBe(401)
        expect(mockGetContractReviewDAO).not.toHaveBeenCalled()
        expect(mockEnqueueRunService).not.toHaveBeenCalled()
    })

    it('reviewId 非整数返回 400', async () => {
        const res: any = await stanceHandler(
            makeEvent({
                userId: USER_A,
                params: { id: 'abc' },
                body: { stance: 'partyA' },
            }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockGetContractReviewDAO).not.toHaveBeenCalled()
    })

    it('reviewId 为 0 返回 400', async () => {
        const res: any = await stanceHandler(
            makeEvent({
                userId: USER_A,
                params: { id: '0' },
                body: { stance: 'partyA' },
            }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockGetContractReviewDAO).not.toHaveBeenCalled()
    })

    it('stance 参数非法返回 400', async () => {
        const res: any = await stanceHandler(
            makeEvent({
                userId: USER_A,
                params: { id: '42' },
                body: { stance: 'invalid-stance' },
            }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockGetContractReviewDAO).not.toHaveBeenCalled()
        expect(mockEnqueueRunService).not.toHaveBeenCalled()
    })

    it('review 属于他人返回 403', async () => {
        mockGetContractReviewDAO.mockResolvedValue(awaitingReview())
        const res: any = await stanceHandler(
            makeEvent({
                userId: USER_B,
                params: { id: '42' },
                body: { stance: 'partyA' },
            }) as any,
        )
        expect(res.code).toBe(403)
        expect(mockEnqueueRunService).not.toHaveBeenCalled()
        expect(mockFindActiveRunBySessionIdDAO).not.toHaveBeenCalled()
    })

    it('review 状态非 awaiting_stance（completed）→ 200 幂等返回，不触发入队', async () => {
        mockGetContractReviewDAO.mockResolvedValue(
            awaitingReview({ status: 'completed' }),
        )
        const res: any = await stanceHandler(
            makeEvent({
                userId: USER_A,
                params: { id: '42' },
                body: { stance: 'partyA' },
            }) as any,
        )
        expect(res.success).toBe(true)
        expect(res.data).toEqual({ reviewId: 42 })
        expect(mockEnqueueRunService).not.toHaveBeenCalled()
        expect(mockFindActiveRunBySessionIdDAO).not.toHaveBeenCalled()
        expect(mockUpdateRunStatusDAO).not.toHaveBeenCalled()
    })

    it('happy path（无 activeRun）→ 200，enqueue 成功，updateRunStatusDAO 未被调用', async () => {
        mockGetContractReviewDAO.mockResolvedValue(awaitingReview())
        mockFindActiveRunBySessionIdDAO.mockResolvedValue(null)
        mockEnqueueRunService.mockResolvedValue({ runId: 'run-xyz', isNew: true })

        const res: any = await stanceHandler(
            makeEvent({
                userId: USER_A,
                params: { id: '42' },
                body: { stance: 'partyB', partyA: '甲方', partyB: '乙方' },
            }) as any,
        )

        expect(res.success).toBe(true)
        expect(res.data).toEqual({ reviewId: 42, runId: 'run-xyz' })
        expect(mockUpdateRunStatusDAO).not.toHaveBeenCalled()
        expect(mockEnqueueRunService).toHaveBeenCalledWith(
            expect.objectContaining({
                sessionId: 'sess-contract-uuid',
                threadId: 'sess-contract-uuid',
                userId: USER_A,
                caseId: null,
                input: expect.objectContaining({
                    command: expect.objectContaining({
                        stance: 'partyB',
                        partyA: '甲方',
                        partyB: '乙方',
                    }),
                }),
            }),
        )
    })

    it('旧 run 为 INTERRUPTED → updateRunStatusDAO 被调用 1 次释放 + enqueue 成功', async () => {
        mockGetContractReviewDAO.mockResolvedValue(awaitingReview())
        mockFindActiveRunBySessionIdDAO.mockResolvedValue({
            id: 'old-run-id',
            status: 'interrupted',
        })
        mockEnqueueRunService.mockResolvedValue({ runId: 'new-run', isNew: true })

        const res: any = await stanceHandler(
            makeEvent({
                userId: USER_A,
                params: { id: '42' },
                body: { stance: 'neutral' },
            }) as any,
        )

        expect(res.success).toBe(true)
        expect(res.data).toEqual({ reviewId: 42, runId: 'new-run' })

        // 关键断言：INTERRUPTED → COMPLETED 释放，只调用 1 次
        expect(mockUpdateRunStatusDAO).toHaveBeenCalledTimes(1)
        expect(mockUpdateRunStatusDAO).toHaveBeenCalledWith(
            'old-run-id',
            'completed',
            expect.objectContaining({ completedAt: expect.any(Date) }),
        )
        expect(mockEnqueueRunService).toHaveBeenCalled()
    })

    it('enqueueRunService 返回 { error } → 429', async () => {
        mockGetContractReviewDAO.mockResolvedValue(awaitingReview())
        mockFindActiveRunBySessionIdDAO.mockResolvedValue(null)
        mockEnqueueRunService.mockResolvedValue({ error: '并发超限' })

        const res: any = await stanceHandler(
            makeEvent({
                userId: USER_A,
                params: { id: '42' },
                body: { stance: 'partyA' },
            }) as any,
        )
        expect(res.code).toBe(429)
        expect(res.message).toBe('并发超限')
    })
})
