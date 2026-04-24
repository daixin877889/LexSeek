/**
 * PATCH /api/v1/assistant/contract/reviews/annotations/:annotationId/restore handler 测试
 *
 * 覆盖分支：
 *  - 未登录 → 401
 *  - annotationId 无效（非整数 / 0 / 负数）→ 400
 *  - annotation 不存在 → 404
 *  - review 属于他人 → 403
 *  - annotation 未被客户删除（removedByClient=false）→ 409
 *  - happy path（suppressInExport=true 被置 false，removedByClient 保留）→ 200
 *  - 幂等：已恢复过（suppressInExport=false）再次调用仍返回 200
 *
 * 策略：纯 mock 风格——vi.mock 替换 DAO，直接调用 handler default export。
 *
 * **Feature: contract-review-versioning-phase-b（DOCX-H3 恢复推送补齐）**
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

vi.mock('~~/server/services/assistant/contract/contractAnnotation.dao', () => ({
    getContractAnnotationByIdDAO: vi.fn(),
    restoreAnnotationPushDAO: vi.fn(),
}))

vi.mock('~~/server/services/assistant/contract/contractReview.dao', () => ({
    getContractReviewDAO: vi.fn(),
}))

import { getContractAnnotationByIdDAO, restoreAnnotationPushDAO } from '~~/server/services/assistant/contract/contractAnnotation.dao'
import { getContractReviewDAO } from '~~/server/services/assistant/contract/contractReview.dao'

const mockGetAnnotation = getContractAnnotationByIdDAO as ReturnType<typeof vi.fn>
const mockRestoreAnnotation = restoreAnnotationPushDAO as ReturnType<typeof vi.fn>
const mockGetReview = getContractReviewDAO as ReturnType<typeof vi.fn>

// ==================== 动态 import handler（必须在 mock 之后）====================

const { default: restoreHandler } = await import(
    '../../../../server/api/v1/assistant/contract/reviews/annotations/[annotationId]/restore.patch'
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

const USER_A = 2001
const USER_B = 2002
const ANN_ID = 77
const REVIEW_ID = 55

function annotation(overrides: Partial<Record<string, any>> = {}) {
    return {
        id: ANN_ID,
        reviewId: REVIEW_ID,
        riskId: 123,
        authorType: 'ai',
        authorName: 'AI',
        authorUserId: null,
        content: '被客户删除的批注',
        deletedAt: null,
        removedByClient: true,
        suppressInExport: true,
        ...overrides,
    }
}

function review(overrides: Partial<Record<string, any>> = {}) {
    return {
        id: REVIEW_ID,
        userId: USER_A,
        status: 'completed',
        ...overrides,
    }
}

// ==================== 测试 ====================

describe('PATCH /api/v1/assistant/contract/reviews/annotations/:annotationId/restore', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('未登录返回 401', async () => {
        const res: any = await restoreHandler(
            makeEvent({ params: { annotationId: String(ANN_ID) } }) as any,
        )
        expect(res.code).toBe(401)
        expect(mockGetAnnotation).not.toHaveBeenCalled()
        expect(mockRestoreAnnotation).not.toHaveBeenCalled()
    })

    it('annotationId 非整数返回 400', async () => {
        const res: any = await restoreHandler(
            makeEvent({ userId: USER_A, params: { annotationId: 'abc' } }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockRestoreAnnotation).not.toHaveBeenCalled()
    })

    it('annotationId 为 0 返回 400', async () => {
        const res: any = await restoreHandler(
            makeEvent({ userId: USER_A, params: { annotationId: '0' } }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockRestoreAnnotation).not.toHaveBeenCalled()
    })

    it('annotationId 为负数返回 400', async () => {
        const res: any = await restoreHandler(
            makeEvent({ userId: USER_A, params: { annotationId: '-5' } }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockRestoreAnnotation).not.toHaveBeenCalled()
    })

    it('annotation 不存在返回 404', async () => {
        mockGetAnnotation.mockResolvedValue(null)
        const res: any = await restoreHandler(
            makeEvent({ userId: USER_A, params: { annotationId: String(ANN_ID) } }) as any,
        )
        expect(res.code).toBe(404)
        expect(mockRestoreAnnotation).not.toHaveBeenCalled()
    })

    it('annotation 所属 review 属于他人返回 403', async () => {
        mockGetAnnotation.mockResolvedValue(annotation())
        mockGetReview.mockResolvedValue(review({ userId: USER_A }))
        const res: any = await restoreHandler(
            makeEvent({ userId: USER_B, params: { annotationId: String(ANN_ID) } }) as any,
        )
        expect(res.code).toBe(403)
        expect(mockRestoreAnnotation).not.toHaveBeenCalled()
    })

    it('annotation 已软删返回 404', async () => {
        mockGetAnnotation
            // reviewGuard 先查一次（此处模拟 guard 行为：guard 只关心 reviewId）
            .mockResolvedValueOnce(annotation({ deletedAt: new Date() }))
            // service 层再查一次，检测 deletedAt != null
            .mockResolvedValueOnce(annotation({ deletedAt: new Date() }))
        mockGetReview.mockResolvedValue(review())
        const res: any = await restoreHandler(
            makeEvent({ userId: USER_A, params: { annotationId: String(ANN_ID) } }) as any,
        )
        expect(res.code).toBe(404)
        expect(mockRestoreAnnotation).not.toHaveBeenCalled()
    })

    it('annotation 未被客户删除（removedByClient=false）返回 409', async () => {
        mockGetAnnotation
            .mockResolvedValueOnce(annotation({ removedByClient: false, suppressInExport: false }))
            .mockResolvedValueOnce(annotation({ removedByClient: false, suppressInExport: false }))
        mockGetReview.mockResolvedValue(review())
        const res: any = await restoreHandler(
            makeEvent({ userId: USER_A, params: { annotationId: String(ANN_ID) } }) as any,
        )
        expect(res.code).toBe(409)
        expect(mockRestoreAnnotation).not.toHaveBeenCalled()
    })

    it('happy path：suppressInExport 由 true 被置 false', async () => {
        mockGetAnnotation
            .mockResolvedValueOnce(annotation())
            .mockResolvedValueOnce(annotation())
        mockGetReview.mockResolvedValue(review())
        mockRestoreAnnotation.mockResolvedValue(annotation({ suppressInExport: false }))

        const res: any = await restoreHandler(
            makeEvent({ userId: USER_A, params: { annotationId: String(ANN_ID) } }) as any,
        )

        expect(res.success).toBe(true)
        expect(res.data.suppressInExport).toBe(false)
        expect(mockRestoreAnnotation).toHaveBeenCalledWith(ANN_ID)
    })

    it('幂等：已恢复（suppressInExport=false）再次调用不落 DB 仍返回 200', async () => {
        mockGetAnnotation
            .mockResolvedValueOnce(annotation({ suppressInExport: false }))
            .mockResolvedValueOnce(annotation({ suppressInExport: false }))
        mockGetReview.mockResolvedValue(review())

        const res: any = await restoreHandler(
            makeEvent({ userId: USER_A, params: { annotationId: String(ANN_ID) } }) as any,
        )

        expect(res.success).toBe(true)
        expect(res.data.suppressInExport).toBe(false)
        // 关键：已处于恢复态时不应再写 DB（service 层的幂等短路）
        expect(mockRestoreAnnotation).not.toHaveBeenCalled()
    })
})
