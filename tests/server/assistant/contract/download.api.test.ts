/**
 * GET /api/v1/assistant/contract/reviews/:id/download handler 测试
 *
 * 覆盖 6 个分支：
 *  - 未登录 → 401
 *  - reviewId 无效（非整数 / 0 / 负数）→ 400
 *  - review 不存在 → 404
 *  - review 属于他人 → 403
 *  - reviewedFileId 为空（review 尚未完成）→ 400
 *  - ossFile 不存在 → 404
 *  - happy path → 200，downloadUrl 为非空 https 字符串
 *
 * 策略：纯 mock 风格——vi.mock 替换 DAO / storage 服务，直接调用 handler default export。
 *
 * **Feature: contract-review-m4**
 * **Validates: Task 1.2（download.get.ts）**
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

vi.mock('~~/server/services/assistant/contract/contractReview.dao', () => ({
    getContractReviewDAO: vi.fn(),
}))

vi.mock('~~/server/services/files/ossFiles.dao', () => ({
    findOssFileByIdDao: vi.fn(),
}))

vi.mock('~~/server/services/storage/storage.service', () => ({
    generateSignedUrlService: vi.fn(),
}))

import { getContractReviewDAO } from '~~/server/services/assistant/contract/contractReview.dao'
import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { generateSignedUrlService } from '~~/server/services/storage/storage.service'

const mockGetReview = getContractReviewDAO as ReturnType<typeof vi.fn>
const mockFindOssFile = findOssFileByIdDao as ReturnType<typeof vi.fn>
const mockGenerateSignedUrl = generateSignedUrlService as ReturnType<typeof vi.fn>

// ==================== 动态 import handler（必须在 mock 之后）====================

const { default: downloadHandler } = await import(
    '../../../../server/api/v1/assistant/contract/reviews/[id]/download.get'
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
        maxVersionNo: 3,
        currentVersionId: 99,
        ...overrides,
    }
}

function ossFile(overrides: Partial<Record<string, any>> = {}) {
    return {
        id: 888,
        userId: USER_A,
        filePath: 'users/1001/contract-reviews/42.docx',
        fileName: 'contract-review.docx',
        ...overrides,
    }
}

// ==================== 测试 ====================

describe('GET /api/v1/assistant/contract/reviews/:id/download', () => {
    beforeEach(() => {
        vi.clearAllMocks()
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
        expect(mockGenerateSignedUrl).not.toHaveBeenCalled()
    })

    it('review 属于他人返回 403', async () => {
        mockGetReview.mockResolvedValue(completedReview())
        const res: any = await downloadHandler(
            makeEvent({ userId: USER_B, params: { id: '42' } }) as any,
        )
        expect(res.code).toBe(403)
        expect(mockFindOssFile).not.toHaveBeenCalled()
        expect(mockGenerateSignedUrl).not.toHaveBeenCalled()
    })

    it('reviewedFileId 为空（审查未完成）返回 400', async () => {
        mockGetReview.mockResolvedValue(completedReview({ reviewedFileId: null, status: 'pending' }))
        const res: any = await downloadHandler(
            makeEvent({ userId: USER_A, params: { id: '42' } }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockFindOssFile).not.toHaveBeenCalled()
        expect(mockGenerateSignedUrl).not.toHaveBeenCalled()
    })

    it('ossFile 不存在返回 404', async () => {
        mockGetReview.mockResolvedValue(completedReview())
        mockFindOssFile.mockResolvedValue(null)
        const res: any = await downloadHandler(
            makeEvent({ userId: USER_A, params: { id: '42' } }) as any,
        )
        expect(res.code).toBe(404)
        expect(mockFindOssFile).toHaveBeenCalledWith(888)
        expect(mockGenerateSignedUrl).not.toHaveBeenCalled()
    })

    it('happy path 返回 downloadUrl（非空 https 字符串）', async () => {
        mockGetReview.mockResolvedValue(completedReview())
        mockFindOssFile.mockResolvedValue(ossFile())
        mockGenerateSignedUrl.mockResolvedValue(
            'https://oss.example.com/users/1001/contract-reviews/42.docx?sig=xxx',
        )

        const res: any = await downloadHandler(
            makeEvent({ userId: USER_A, params: { id: '42' } }) as any,
        )

        expect(res.success).toBe(true)
        expect(res.message).toContain('获取下载地址成功')
        expect(typeof res.data.downloadUrl).toBe('string')
        expect(res.data.downloadUrl.length).toBeGreaterThan(0)
        expect(res.data.downloadUrl.startsWith('https://')).toBe(true)

        // Task 4.3: filename 带版本号，格式 {原名}_v{N}_{YYYY-MM-DD}.docx
        expect(typeof res.data.filename).toBe('string')
        expect(res.data.filename).toMatch(/^contract-review_v\d+_\d{4}-\d{2}-\d{2}\.docx$/)

        // 关键：签名参数包含 Content-Disposition（文件名）
        expect(mockGenerateSignedUrl).toHaveBeenCalledWith(
            'users/1001/contract-reviews/42.docx',
            expect.objectContaining({
                expires: 3600,
                userId: USER_A,
                response: expect.objectContaining({
                    contentDisposition: expect.stringContaining('attachment'),
                }),
            }),
        )
    })
})
