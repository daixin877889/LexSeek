/**
 * GET /api/v1/assistant/contract/reviews/:id/download handler 测试
 *
 * 语义（客户 2026-04-24 诉求后）：
 *   每次下载都 atomicSetRebuildingDAO 抢锁 + rebuildDocxService 生成最新产物
 *   + 切换 reviewedFileId，再返回 { downloadUrl, filename }。不再有"重新生成"
 *   独立按钮入口。
 *
 * 覆盖分支：
 *  - 未登录 → 401
 *  - reviewId 非整数/0/负数 → 400
 *  - review 不存在 → 404
 *  - review 属于他人 → 403
 *  - reviewedFileId 为空 → 400
 *  - 抢锁失败（有并发 rebuild 正在跑）→ 409
 *  - rebuildDocxService 抛错 → rollbackRebuildDAO 被调 + 500
 *  - happy path → 200，downloadUrl + filename 来自 rebuildDocxService 返回
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

// ==================== Mock DAO / Service 层 ====================

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
const mockAtomicClaim = atomicSetRebuildingDAO as ReturnType<typeof vi.fn>
const mockRollback = rollbackRebuildDAO as ReturnType<typeof vi.fn>
const mockRebuildDocx = rebuildDocxService as ReturnType<typeof vi.fn>

// ==================== 动态 import handler（必须在 mock 之后）====================

const { default: downloadHandler } = await import(
    '../../../../server/api/v1/assistant/contract/reviews/download/[id].get'
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

function completedReview(overrides: Partial<Record<string, any>> = {}) {
    return {
        id: 42,
        userId: USER_A,
        sessionId: 'sess-contract-uuid',
        status: 'completed',
        reviewedFileId: 888,
        originalFileId: 777,
        maxVersionNo: 3,
        currentVersionId: 99,
        ...overrides,
    }
}

function rebuildResult(overrides: Partial<Record<string, any>> = {}) {
    return {
        reviewedFileId: 1234,
        downloadUrl: 'https://oss.example.com/tmp-rebuild.docx?sig=yyy',
        filename: '劳动合同_v3_2026-04-24.docx',
        ...overrides,
    }
}

// ==================== 测试 ====================

describe('GET /api/v1/assistant/contract/reviews/:id/download', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // 多数路径 rollback 不会被调用，但它在 catch 分支里做 `.catch()` 链式调用，
        // mock 默认 returns undefined（没 .catch 方法）会让 handler 自己抛错。
        mockRollback.mockResolvedValue(undefined)
    })

    it('未登录返回 401', async () => {
        const res: any = await downloadHandler(
            makeEvent({ params: { id: '42' } }) as any,
        )
        expect(res.code).toBe(401)
        expect(mockGetReview).not.toHaveBeenCalled()
    })

    it('reviewId 非整数返回 400', async () => {
        const res: any = await downloadHandler(
            makeEvent({ userId: USER_A, params: { id: 'abc' } }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockGetReview).not.toHaveBeenCalled()
    })

    it('reviewId 为 0 返回 400', async () => {
        const res: any = await downloadHandler(
            makeEvent({ userId: USER_A, params: { id: '0' } }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockGetReview).not.toHaveBeenCalled()
    })

    it('reviewId 为负数返回 400', async () => {
        const res: any = await downloadHandler(
            makeEvent({ userId: USER_A, params: { id: '-5' } }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockGetReview).not.toHaveBeenCalled()
    })

    it('review 不存在返回 404', async () => {
        mockGetReview.mockResolvedValue(null)
        const res: any = await downloadHandler(
            makeEvent({ userId: USER_A, params: { id: '999' } }) as any,
        )
        expect(res.code).toBe(404)
        expect(mockGetReview).toHaveBeenCalledWith(999)
        expect(mockAtomicClaim).not.toHaveBeenCalled()
        expect(mockRebuildDocx).not.toHaveBeenCalled()
    })

    it('review 属于他人返回 403', async () => {
        mockGetReview.mockResolvedValue(completedReview())
        const res: any = await downloadHandler(
            makeEvent({ userId: USER_B, params: { id: '42' } }) as any,
        )
        expect(res.code).toBe(403)
        expect(mockAtomicClaim).not.toHaveBeenCalled()
        expect(mockRebuildDocx).not.toHaveBeenCalled()
    })

    it('reviewedFileId 为空（审查未完成）返回 400', async () => {
        mockGetReview.mockResolvedValue(completedReview({ reviewedFileId: null, status: 'pending' }))
        const res: any = await downloadHandler(
            makeEvent({ userId: USER_A, params: { id: '42' } }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockAtomicClaim).not.toHaveBeenCalled()
        expect(mockRebuildDocx).not.toHaveBeenCalled()
    })

    it('抢锁失败返回 409 且不跑 rebuild', async () => {
        mockGetReview.mockResolvedValue(completedReview())
        mockAtomicClaim.mockResolvedValue(false)
        const res: any = await downloadHandler(
            makeEvent({ userId: USER_A, params: { id: '42' } }) as any,
        )
        expect(res.code).toBe(409)
        expect(mockAtomicClaim).toHaveBeenCalledWith(42)
        expect(mockRebuildDocx).not.toHaveBeenCalled()
        expect(mockRollback).not.toHaveBeenCalled()
    })

    it('rebuildDocxService 抛错：回滚 + 500', async () => {
        mockGetReview.mockResolvedValue(completedReview())
        mockAtomicClaim.mockResolvedValue(true)
        mockRollback.mockResolvedValue(undefined)
        mockRebuildDocx.mockRejectedValue(new Error('OSS upload failed'))
        const res: any = await downloadHandler(
            makeEvent({ userId: USER_A, params: { id: '42' } }) as any,
        )
        expect(res.code).toBe(500)
        expect(mockRollback).toHaveBeenCalledWith(42)
    })

    it('happy path：claim → rebuild → 返回 { downloadUrl, filename }', async () => {
        mockGetReview.mockResolvedValue(completedReview())
        mockAtomicClaim.mockResolvedValue(true)
        mockRebuildDocx.mockResolvedValue(rebuildResult())

        const res: any = await downloadHandler(
            makeEvent({ userId: USER_A, params: { id: '42' } }) as any,
        )

        expect(res.success).toBe(true)
        expect(res.data.downloadUrl).toBe(rebuildResult().downloadUrl)
        expect(res.data.filename).toBe(rebuildResult().filename)
        expect(mockAtomicClaim).toHaveBeenCalledWith(42)
        expect(mockRebuildDocx).toHaveBeenCalledTimes(1)
        expect(mockRollback).not.toHaveBeenCalled()
    })
})
