/**
 * GET /api/v1/assistant/contract/reviews/:id handler 测试
 *
 * 策略：直接 import handler default export，传入 mock event（含 auth 上下文），
 * DAO 层由外部 Mock 替换——避免真实数据库调用。
 *
 * 覆盖：
 *  - 未登录 → 401
 *  - id 无效（非数字 / 0 / 负数）→ 400
 *  - review 不存在 → 404
 *  - review 属于他人 → 403
 *  - happy path → 200，字段白名单（含 sessionId，不含 userId / deletedAt）
 *
 * **Feature: contract-review-m3**
 * **Validates: Task 8.1 + 8.2**
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
;(globalThis as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }

// ==================== Mock DAO 层 ====================

vi.mock('~~/server/services/assistant/contract/contractReview.dao', () => ({
    getContractReviewDAO: vi.fn(),
}))

import { getContractReviewDAO } from '~~/server/services/assistant/contract/contractReview.dao'

const mockGetContractReviewDAO = getContractReviewDAO as ReturnType<typeof vi.fn>

// ==================== 动态 import handler（必须在 mock 之后）====================

const { default: getHandler } = await import(
    '../../../../server/api/v1/assistant/contract/reviews/[id].get'
)

// ==================== 工具函数 ====================

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

const USER_A = 1001
const USER_B = 1002

// ==================== 测试 ====================

describe('GET /api/v1/assistant/contract/reviews/:id', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('未登录返回 401', async () => {
        const res: any = await getHandler(makeEvent({ params: { id: '1' } }) as any)
        expect(res.code).toBe(401)
        expect(mockGetContractReviewDAO).not.toHaveBeenCalled()
    })

    it('id 非数字返回 400', async () => {
        const res: any = await getHandler(
            makeEvent({ userId: USER_A, params: { id: 'abc' } }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockGetContractReviewDAO).not.toHaveBeenCalled()
    })

    it('id 为 0 返回 400', async () => {
        const res: any = await getHandler(
            makeEvent({ userId: USER_A, params: { id: '0' } }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockGetContractReviewDAO).not.toHaveBeenCalled()
    })

    it('id 为负数返回 400', async () => {
        const res: any = await getHandler(
            makeEvent({ userId: USER_A, params: { id: '-5' } }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockGetContractReviewDAO).not.toHaveBeenCalled()
    })

    it('review 不存在返回 404', async () => {
        mockGetContractReviewDAO.mockResolvedValue(null)
        const res: any = await getHandler(
            makeEvent({ userId: USER_A, params: { id: '999' } }) as any,
        )
        expect(res.code).toBe(404)
        expect(mockGetContractReviewDAO).toHaveBeenCalledWith(999)
    })

    it('review 属于他人返回 403', async () => {
        mockGetContractReviewDAO.mockResolvedValue({
            id: 1,
            userId: USER_A,
            sessionId: 'sess-xxx',
            status: 'pending',
        })
        const res: any = await getHandler(
            makeEvent({ userId: USER_B, params: { id: '1' } }) as any,
        )
        expect(res.code).toBe(403)
    })

    it('happy path 返回字段白名单（含 sessionId，不含 userId / deletedAt）', async () => {
        const fakeReview = {
            id: 42,
            userId: USER_A,
            sessionId: 'sess-contract-uuid',
            status: 'completed',
            contractType: '劳动合同',
            partyA: '甲方公司',
            partyB: '乙方个人',
            stance: 'partyA',
            risks: [{ level: 'high', description: '未约定违约金' }],
            summary: '整体风险可控',
            originalFileId: 777,
            reviewedFileId: 888,
            createdAt: new Date('2026-04-18T00:00:00Z'),
            updatedAt: new Date('2026-04-18T01:00:00Z'),
            deletedAt: null,
        }
        mockGetContractReviewDAO.mockResolvedValue(fakeReview)

        const res: any = await getHandler(
            makeEvent({ userId: USER_A, params: { id: '42' } }) as any,
        )

        expect(res.success).toBe(true)
        expect(res.data.review).toMatchObject({
            id: 42,
            sessionId: 'sess-contract-uuid',
            status: 'completed',
            contractType: '劳动合同',
            partyA: '甲方公司',
            partyB: '乙方个人',
            stance: 'partyA',
            risks: [{ level: 'high', description: '未约定违约金' }],
            summary: '整体风险可控',
            originalFileId: 777,
            reviewedFileId: 888,
        })

        // 字段白名单严格断言：不得泄漏 userId / deletedAt
        expect(res.data.review).not.toHaveProperty('userId')
        expect(res.data.review).not.toHaveProperty('deletedAt')

        // 必须包含 sessionId（前端 SSE 订阅依赖）
        expect(res.data.review).toHaveProperty('sessionId', 'sess-contract-uuid')
    })
})
