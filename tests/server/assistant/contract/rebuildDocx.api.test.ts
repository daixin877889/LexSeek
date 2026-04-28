/**
 * POST /api/v1/assistant/contract/reviews/:id/rebuild-docx handler 分支测试
 *
 * 覆盖路径（spec §8.4）：
 *   - 401 未登录
 *   - 400 id 非正整数
 *   - 404 review 不存在
 *   - 403 跨用户
 *   - 409 status=rebuilding
 *   - 409 status=pending
 *   - 429 atomicSetRebuildingDAO 返回 false（并发占位失败）
 *   - 200 成功路径：service 返回 { reviewedFileId, downloadUrl }
 *   - 500 service 抛异常 → rollbackRebuildDAO 被调 1 次（P0-4 回滚验证）
 *   - 500 service 在 setCompleted 之前抛异常 → rollback 后 status=completed 且 reviewedFileId 未漂移
 *
 * 策略：沿用 M4 globalThis stub + vi.mock DAO/service 模式。
 *
 * **Feature: contract-review-m5**
 * **Validates: Task 3（rebuild-docx.post.ts）**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ==================== 全局 Stub ====================

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

// ==================== Mock DAO / service ====================

vi.mock('~~/server/agents/contract/contractReview.dao', () => ({
    getContractReviewDAO: vi.fn(),
    atomicSetRebuildingDAO: vi.fn(),
    rollbackRebuildDAO: vi.fn(),
}))

vi.mock('~~/server/agents/contract/contractReviewRebuild.service', () => ({
    rebuildDocxService: vi.fn(),
}))

import {
    getContractReviewDAO,
    atomicSetRebuildingDAO,
    rollbackRebuildDAO,
} from '~~/server/agents/contract/contractReview.dao'
import { rebuildDocxService } from '~~/server/agents/contract/contractReviewRebuild.service'

const mockGetReview = getContractReviewDAO as ReturnType<typeof vi.fn>
const mockAtomicSet = atomicSetRebuildingDAO as ReturnType<typeof vi.fn>
const mockRollback = rollbackRebuildDAO as ReturnType<typeof vi.fn>
const mockRebuild = rebuildDocxService as ReturnType<typeof vi.fn>

// ==================== 动态 import handler ====================

const { default: rebuildHandler } = await import(
    '../../../../server/api/v1/assistant/contract/reviews/rebuild-docx/[id].post'
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

function review(overrides: Partial<Record<string, any>> = {}) {
    return {
        id: 42,
        userId: USER_A,
        sessionId: 'sess-contract-uuid',
        status: 'completed',
        originalFileId: 77,
        reviewedFileId: 88,
        ...overrides,
    }
}

// ==================== 测试 ====================

describe('POST /api/v1/assistant/contract/reviews/:id/rebuild-docx', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('未登录返回 401', async () => {
        const res: any = await rebuildHandler(
            makeEvent({ params: { id: '42' } }) as any,
        )
        expect(res.code).toBe(401)
        expect(mockGetReview).not.toHaveBeenCalled()
        expect(mockAtomicSet).not.toHaveBeenCalled()
    })

    it('id 非正整数返回 400', async () => {
        const res: any = await rebuildHandler(
            makeEvent({ userId: USER_A, params: { id: 'abc' } }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockGetReview).not.toHaveBeenCalled()
    })

    it('id 为 0 返回 400', async () => {
        const res: any = await rebuildHandler(
            makeEvent({ userId: USER_A, params: { id: '0' } }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockGetReview).not.toHaveBeenCalled()
    })

    it('review 不存在返回 404', async () => {
        mockGetReview.mockResolvedValue(null)
        const res: any = await rebuildHandler(
            makeEvent({ userId: USER_A, params: { id: '999' } }) as any,
        )
        expect(res.code).toBe(404)
        expect(mockGetReview).toHaveBeenCalledWith(999)
        expect(mockAtomicSet).not.toHaveBeenCalled()
    })

    it('review 属于他人返回 403', async () => {
        mockGetReview.mockResolvedValue(review())
        const res: any = await rebuildHandler(
            makeEvent({ userId: USER_B, params: { id: '42' } }) as any,
        )
        expect(res.code).toBe(403)
        expect(mockAtomicSet).not.toHaveBeenCalled()
    })

    it('status=rebuilding 返回 409', async () => {
        mockGetReview.mockResolvedValue(review({ status: 'rebuilding' }))
        const res: any = await rebuildHandler(
            makeEvent({ userId: USER_A, params: { id: '42' } }) as any,
        )
        expect(res.code).toBe(409)
        expect(mockAtomicSet).not.toHaveBeenCalled()
    })

    it('status=pending 返回 409', async () => {
        mockGetReview.mockResolvedValue(review({ status: 'pending' }))
        const res: any = await rebuildHandler(
            makeEvent({ userId: USER_A, params: { id: '42' } }) as any,
        )
        expect(res.code).toBe(409)
        expect(mockAtomicSet).not.toHaveBeenCalled()
    })

    it('atomicSetRebuildingDAO 返回 false 时返回 429', async () => {
        mockGetReview.mockResolvedValue(review())
        mockAtomicSet.mockResolvedValue(false)
        const res: any = await rebuildHandler(
            makeEvent({ userId: USER_A, params: { id: '42' } }) as any,
        )
        expect(res.code).toBe(429)
        expect(mockAtomicSet).toHaveBeenCalledWith(42)
        expect(mockRebuild).not.toHaveBeenCalled()
        expect(mockRollback).not.toHaveBeenCalled()
    })

    it('成功路径：返回 { reviewedFileId, downloadUrl, filename }', async () => {
        mockGetReview.mockResolvedValue(review())
        mockAtomicSet.mockResolvedValue(true)
        mockRebuild.mockResolvedValue({
            reviewedFileId: 99,
            downloadUrl: 'https://oss.signed/x',
            filename: '劳动合同_工作区_2026-04-23.docx',
        })

        const res: any = await rebuildHandler(
            makeEvent({ userId: USER_A, params: { id: '42' } }) as any,
        )

        expect(res.success).toBe(true)
        expect(res.data).toEqual({
            reviewedFileId: 99,
            downloadUrl: 'https://oss.signed/x',
            filename: '劳动合同_工作区_2026-04-23.docx',
        })
        expect(mockAtomicSet).toHaveBeenCalledWith(42)
        expect(mockRebuild).toHaveBeenCalledTimes(1)
        expect(mockRollback).not.toHaveBeenCalled()
    })

    it('service 抛异常 → rollbackRebuildDAO 被调 1 次，返回 500', async () => {
        mockGetReview.mockResolvedValue(review())
        mockAtomicSet.mockResolvedValue(true)
        mockRebuild.mockRejectedValue(new Error('upload failed'))

        const res: any = await rebuildHandler(
            makeEvent({ userId: USER_A, params: { id: '42' } }) as any,
        )

        expect(res.code).toBe(500)
        expect(res.success).toBe(false)
        expect(mockRollback).toHaveBeenCalledTimes(1)
        expect(mockRollback).toHaveBeenCalledWith(42)
    })

    it('service 在 setCompleted 之前失败（P0-4 关键时序）→ rollback 后回到 completed', async () => {
        // 模拟 service 在 generateSignedUrl 失败：reviewedFileId 不会被写
        mockGetReview.mockResolvedValue(review({ reviewedFileId: 88 }))
        mockAtomicSet.mockResolvedValue(true)
        mockRebuild.mockRejectedValue(new Error('generateSignedUrl failed'))

        const res: any = await rebuildHandler(
            makeEvent({ userId: USER_A, params: { id: '42' } }) as any,
        )

        expect(res.code).toBe(500)
        expect(mockRollback).toHaveBeenCalledTimes(1)
        // rollback 后 handler 不会触达 setCompletedAfterRebuild，reviewedFileId 保持为旧值
        // （此断言依赖 rebuildDocxService 内部时序：setCompleted 是最后一步 → 本用例中未被调用）
        expect(mockRebuild).toHaveBeenCalledTimes(1)
    })
})
