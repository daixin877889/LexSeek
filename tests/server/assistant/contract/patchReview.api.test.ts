/**
 * PATCH /api/v1/assistant/contract/reviews/:id handler 分支测试
 *
 * 覆盖 15 条路径（spec §8.3）：
 *   - 401 未登录
 *   - 400 id 非正整数
 *   - 400 body 非对象
 *   - 400 risks 缺失 / 非数组
 *   - 400 RISK_SHAPE refine 失败（high 无 suggestedClauseText）
 *   - 400 body 含 summary 字段（.strict() 明文禁止）
 *   - 400 risks 数组超过 200 条（DoS 防御）
 *   - 400 clauseText 超 10000 字符
 *   - 400 id 不是 uuid 格式
 *   - 404 review 不存在
 *   - 403 跨用户
 *   - 409 status=pending
 *   - 409 status=rebuilding
 *   - 409 status=failed
 *   - 200 status=completed 全量替换 risks 返回 { reviewId }
 *
 * 策略：纯 mock 风格——vi.mock 替换 DAO / schema 模块，直接调用 handler default export。
 *
 * **Feature: contract-review-m5**
 * **Validates: Task 2（patch.index.ts）**
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
;(globalThis as any).readBody = (event: any) => Promise.resolve(event.__body)
;(globalThis as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }

// ==================== Mock DAO 层 ====================

vi.mock('~~/server/services/assistant/contract/contractReview.dao', () => ({
    getContractReviewDAO: vi.fn(),
    patchReviewRisksDAO: vi.fn(),
    setHasUnsavedTrueDAO: vi.fn(),
}))

import {
    getContractReviewDAO,
    patchReviewRisksDAO,
} from '~~/server/services/assistant/contract/contractReview.dao'

const mockGetReview = getContractReviewDAO as ReturnType<typeof vi.fn>
const mockPatchRisks = patchReviewRisksDAO as ReturnType<typeof vi.fn>

// ==================== 动态 import handler（必须在 mock 之后）====================

const { default: patchHandler } = await import(
    '../../../../server/api/v1/assistant/contract/reviews/[id]/index.patch'
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

const UUID_1 = '11111111-1111-4111-8111-111111111111'
const UUID_2 = '22222222-2222-4222-8222-222222222222'

function validLowRisk(overrides: Partial<Record<string, any>> = {}) {
    return {
        id: UUID_1,
        clauseIndex: 0,
        clauseText: '原文段落内容',
        level: 'low',
        category: '其他',
        problem: '问题',
        analysis: '分析',
        risk: '风险',
        suggestion: '建议',
        ...overrides,
    }
}

function validHighRisk(overrides: Partial<Record<string, any>> = {}) {
    return {
        id: UUID_2,
        clauseIndex: 1,
        clauseText: '原文段落内容',
        level: 'high',
        category: '付款',
        problem: '问题',
        analysis: '分析',
        risk: '风险',
        suggestion: '建议',
        suggestedClauseText: 'AI 重写后的条款',
        ...overrides,
    }
}

function review(overrides: Partial<Record<string, any>> = {}) {
    return {
        id: 42,
        userId: USER_A,
        sessionId: 'sess-contract-uuid',
        status: 'completed',
        ...overrides,
    }
}

// ==================== 测试 ====================

describe('PATCH /api/v1/assistant/contract/reviews/:id', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('未登录返回 401', async () => {
        const res: any = await patchHandler(
            makeEvent({ params: { id: '42' }, body: { risks: [] } }) as any,
        )
        expect(res.code).toBe(401)
        expect(mockGetReview).not.toHaveBeenCalled()
    })

    it('id 非正整数返回 400', async () => {
        const res: any = await patchHandler(
            makeEvent({
                userId: USER_A,
                params: { id: 'abc' },
                body: { risks: [] },
            }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockGetReview).not.toHaveBeenCalled()
    })

    it('body 非对象返回 400', async () => {
        const res: any = await patchHandler(
            makeEvent({
                userId: USER_A,
                params: { id: '42' },
                body: null,
            }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockGetReview).not.toHaveBeenCalled()
    })

    it('risks 缺失返回 400', async () => {
        const res: any = await patchHandler(
            makeEvent({
                userId: USER_A,
                params: { id: '42' },
                body: {},
            }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockGetReview).not.toHaveBeenCalled()
    })

    it('risks 非数组返回 400', async () => {
        const res: any = await patchHandler(
            makeEvent({
                userId: USER_A,
                params: { id: '42' },
                body: { risks: 'not-an-array' },
            }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockGetReview).not.toHaveBeenCalled()
    })

    it('RISK_SHAPE refine 失败（high 无 suggestedClauseText）返回 400', async () => {
        const badRisk = validHighRisk()
        delete (badRisk as any).suggestedClauseText
        const res: any = await patchHandler(
            makeEvent({
                userId: USER_A,
                params: { id: '42' },
                body: { risks: [badRisk] },
            }) as any,
        )
        expect(res.code).toBe(400)
        expect(res.message).toContain('suggestedClauseText')
        expect(mockGetReview).not.toHaveBeenCalled()
    })

    it('body 含 summary 字段（.strict() 明文禁止）返回 400', async () => {
        const res: any = await patchHandler(
            makeEvent({
                userId: USER_A,
                params: { id: '42' },
                body: { risks: [validLowRisk()], summary: '不允许传 summary' },
            }) as any,
        )
        expect(res.code).toBe(400)
        expect(res.message.toLowerCase()).toMatch(/summary|unrecognized/)
        expect(mockGetReview).not.toHaveBeenCalled()
    })

    it('risks 数组超过 200 条返回 400（DoS 防御）', async () => {
        const bigRisks = Array.from({ length: 201 }, (_, i) =>
            validLowRisk({
                id: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
                clauseIndex: i,
            }),
        )
        const res: any = await patchHandler(
            makeEvent({
                userId: USER_A,
                params: { id: '42' },
                body: { risks: bigRisks },
            }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockGetReview).not.toHaveBeenCalled()
    })

    it('clauseText 超 10000 字符返回 400', async () => {
        const res: any = await patchHandler(
            makeEvent({
                userId: USER_A,
                params: { id: '42' },
                body: { risks: [validLowRisk({ clauseText: 'x'.repeat(10001) })] },
            }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockGetReview).not.toHaveBeenCalled()
    })

    it('id 不是 uuid 格式返回 400', async () => {
        const res: any = await patchHandler(
            makeEvent({
                userId: USER_A,
                params: { id: '42' },
                body: { risks: [validLowRisk({ id: 'not-a-uuid' })] },
            }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockGetReview).not.toHaveBeenCalled()
    })

    it('review 不存在返回 404', async () => {
        mockGetReview.mockResolvedValue(null)
        const res: any = await patchHandler(
            makeEvent({
                userId: USER_A,
                params: { id: '999' },
                body: { risks: [validLowRisk()] },
            }) as any,
        )
        expect(res.code).toBe(404)
        expect(mockGetReview).toHaveBeenCalledWith(999)
        expect(mockPatchRisks).not.toHaveBeenCalled()
    })

    it('review 属于他人返回 403', async () => {
        mockGetReview.mockResolvedValue(review())
        const res: any = await patchHandler(
            makeEvent({
                userId: USER_B,
                params: { id: '42' },
                body: { risks: [validLowRisk()] },
            }) as any,
        )
        expect(res.code).toBe(403)
        expect(mockPatchRisks).not.toHaveBeenCalled()
    })

    it('status=pending 返回 409', async () => {
        mockGetReview.mockResolvedValue(review({ status: 'pending' }))
        const res: any = await patchHandler(
            makeEvent({
                userId: USER_A,
                params: { id: '42' },
                body: { risks: [validLowRisk()] },
            }) as any,
        )
        expect(res.code).toBe(409)
        expect(mockPatchRisks).not.toHaveBeenCalled()
    })

    it('status=rebuilding 返回 409', async () => {
        mockGetReview.mockResolvedValue(review({ status: 'rebuilding' }))
        const res: any = await patchHandler(
            makeEvent({
                userId: USER_A,
                params: { id: '42' },
                body: { risks: [validLowRisk()] },
            }) as any,
        )
        expect(res.code).toBe(409)
        expect(mockPatchRisks).not.toHaveBeenCalled()
    })

    it('status=failed 返回 409', async () => {
        mockGetReview.mockResolvedValue(review({ status: 'failed' }))
        const res: any = await patchHandler(
            makeEvent({
                userId: USER_A,
                params: { id: '42' },
                body: { risks: [validLowRisk()] },
            }) as any,
        )
        expect(res.code).toBe(409)
        expect(mockPatchRisks).not.toHaveBeenCalled()
    })

    it('status=completed 全量替换 risks 返回 { reviewId }', async () => {
        mockGetReview.mockResolvedValue(review({ status: 'completed' }))
        mockPatchRisks.mockResolvedValue({ id: 42 } as any)

        const newRisks = [validLowRisk(), validHighRisk()]
        const res: any = await patchHandler(
            makeEvent({
                userId: USER_A,
                params: { id: '42' },
                body: { risks: newRisks },
            }) as any,
        )

        expect(res.success).toBe(true)
        expect(res.data).toEqual({ reviewId: 42 })
        expect(mockPatchRisks).toHaveBeenCalledTimes(1)
        expect(mockPatchRisks).toHaveBeenCalledWith(42, newRisks)
    })
})
