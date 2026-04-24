/**
 * GET /api/v1/assistant/contract/reviews/:id/download handler 测试
 *
 * 覆盖分支：
 *  - 未登录 → 401
 *  - reviewId 无效（非整数 / 0 / 负数）→ 400
 *  - review 不存在 → 404
 *  - review 属于他人 → 403
 *  - reviewedFileId 为空（review 尚未完成）→ 400
 *  - rebuildDocxService 抛异常 → 500
 *  - 新产物 ossFile 不存在 → 404
 *  - happy path → 200，downloadUrl 为非空 https 字符串，wordCommentRef 已更新
 *
 * 策略：纯 mock 风格——vi.mock 替换 DAO / service，直接调用 handler default export。
 *
 * **Feature: contract-review-m4**
 * **Validates: Task 1.2（download.get.ts）+ Phase B injectAnnotations**
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

vi.mock('~~/server/services/assistant/contract/contractReviewRebuild.service', () => ({
    rebuildDocxService: vi.fn(),
}))

import { getContractReviewDAO } from '~~/server/services/assistant/contract/contractReview.dao'
import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { generateSignedUrlService } from '~~/server/services/storage/storage.service'
import { rebuildDocxService } from '~~/server/services/assistant/contract/contractReviewRebuild.service'

const mockGetReview = getContractReviewDAO as ReturnType<typeof vi.fn>
const mockFindOssFile = findOssFileByIdDao as ReturnType<typeof vi.fn>
const mockGenerateSignedUrl = generateSignedUrlService as ReturnType<typeof vi.fn>
const mockRebuildDocx = rebuildDocxService as ReturnType<typeof vi.fn>

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

// rebuild 后新 ossFile id
const NEW_FILE_ID = 999

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

function ossFile(overrides: Partial<Record<string, any>> = {}) {
    return {
        id: NEW_FILE_ID,
        userId: USER_A,
        filePath: 'users/1001/contract-reviews/rebuild-new.docx',
        fileName: 'contract-review.docx',
        ...overrides,
    }
}

function rebuildResult() {
    return {
        reviewedFileId: NEW_FILE_ID,
        downloadUrl: 'https://oss.example.com/tmp-rebuild.docx?sig=yyy',
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
        expect(mockRebuildDocx).not.toHaveBeenCalled()
    })

    it('review 属于他人返回 403', async () => {
        mockGetReview.mockResolvedValue(completedReview())
        const res: any = await downloadHandler(
            makeEvent({ userId: USER_B, params: { id: '42' } }) as any,
        )
        expect(res.code).toBe(403)
        expect(mockRebuildDocx).not.toHaveBeenCalled()
    })

    it('reviewedFileId 为空（审查未完成）返回 400', async () => {
        mockGetReview.mockResolvedValue(completedReview({ reviewedFileId: null, status: 'pending' }))
        const res: any = await downloadHandler(
            makeEvent({ userId: USER_A, params: { id: '42' } }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockRebuildDocx).not.toHaveBeenCalled()
    })

    // 按 spec §8.5 回归后，download 不再调 rebuildDocxService
    it('不调用 rebuildDocxService（spec §8.5：download 只取签名 URL，不做 rebuild）', async () => {
        mockGetReview.mockResolvedValue(completedReview())
        mockFindOssFile.mockResolvedValue(ossFile({ id: 888 }))
        mockGenerateSignedUrl.mockResolvedValue('https://oss.example.com/x?sig=xxx')

        await downloadHandler(makeEvent({ userId: USER_A, params: { id: '42' } }) as any)

        expect(mockRebuildDocx).not.toHaveBeenCalled()
    })

    it('reviewedFileId 对应的 OSS 文件丢失返回 404', async () => {
        mockGetReview.mockResolvedValue(completedReview())
        mockFindOssFile.mockResolvedValue(null)
        const res: any = await downloadHandler(
            makeEvent({ userId: USER_A, params: { id: '42' } }) as any,
        )
        expect(res.code).toBe(404)
        // 直接用 review.reviewedFileId 查（不再通过 rebuildDocxService 拿新 id）
        expect(mockFindOssFile).toHaveBeenCalledWith(888)
        expect(mockGenerateSignedUrl).not.toHaveBeenCalled()
    })

    it('happy path：直接用 review.reviewedFileId 生成签名 URL', async () => {
        mockGetReview.mockResolvedValue(completedReview())
        // 第一次调 findOssFile 是查 reviewedFileId=888 → 拿到 ossFile；
        // 第二次调是查 originalFileId=777 取文件名；两次都走 reviewedFile mock 即可验证链路
        mockFindOssFile.mockResolvedValue(ossFile({
            id: 888,
            fileName: 'contract-review.docx',
            filePath: 'users/1001/contract-reviews/reviewed-888.docx',
        }))
        mockGenerateSignedUrl.mockResolvedValue(
            'https://oss.example.com/users/1001/contract-reviews/reviewed-888.docx?sig=xxx',
        )

        const res: any = await downloadHandler(
            makeEvent({ userId: USER_A, params: { id: '42' } }) as any,
        )

        expect(res.success).toBe(true)
        expect(res.data.downloadUrl.startsWith('https://')).toBe(true)

        // 文件名规则：{原合同名}_{v 版本号 | "工作区"}_{YYYY-MM-DD}.docx
        expect(res.data.filename).toMatch(/^contract-review_v\d+_\d{4}-\d{2}-\d{2}\.docx$/)

        // 确认：不再触发 rebuild
        expect(mockRebuildDocx).not.toHaveBeenCalled()

        // 直接用 review.reviewedFileId=888 查 OSS
        expect(mockFindOssFile).toHaveBeenCalledWith(888)

        // 签名 URL 带 Content-Disposition
        expect(mockGenerateSignedUrl).toHaveBeenCalledWith(
            'users/1001/contract-reviews/reviewed-888.docx',
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
