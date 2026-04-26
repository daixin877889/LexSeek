/**
 * rebuildDocxService 单元测试
 *
 * 覆盖路径：
 *   - happy path：下载→查 annotation→注入→上传→签名→createOssFile→setCompleted 顺序正确
 *   - originalFileId 为空 → 抛错 "没有原始文件"
 *   - findOssFileByIdDao 返回 null → 抛错 "原始文件已丢失"
 *   - origOssFile.filePath 为空 → 抛错 "原始文件已丢失"
 *   - setCompletedAfterRebuildDAO 抛异常 → 错误冒泡（service 内不 catch）
 *   - generateSignedUrlService 抛异常 → 错误冒泡，createOssFileDao / setCompletedAfterRebuildDAO 都未被调（P0-4 关键时序验证）
 *
 * **Feature: contract-review-m5**
 * **Phase B 改造**：注入来源切换为 contractAnnotations 表
 * **Validates: Task 3（contractReviewRebuild.service.ts）**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ==================== 全局 Stub ====================

;(globalThis as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
;(globalThis as any).prisma = {
    contractAnnotations: { update: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn().mockImplementation((ops: any[]) => Promise.all(ops)),
}

// ==================== Mock 所有外部依赖 ====================

vi.mock('~~/server/services/files/ossFiles.dao', () => ({
    findOssFileByIdDao: vi.fn(),
    createOssFileDao: vi.fn(),
}))

vi.mock('~~/server/agents/contract/contractReview.dao', () => ({
    setCompletedAfterRebuildDAO: vi.fn(),
}))

vi.mock('~~/server/agents/contract/docx', () => ({
    injectAnnotations: vi.fn(),
}))

vi.mock('~~/server/agents/contract/contractAnnotation.dao', () => ({
    listAnnotationsForExportDAO: vi.fn(),
}))

vi.mock('~~/server/services/storage/storage.service', () => ({
    downloadFileService: vi.fn(),
    uploadFileService: vi.fn(),
    generateSignedUrlService: vi.fn(),
    deleteFileService: vi.fn(),
}))

vi.mock('~~/server/services/storage/storageConfig.dao', () => ({
    getDefaultStorageConfigDao: vi.fn(),
}))

import {
    findOssFileByIdDao,
    createOssFileDao,
} from '~~/server/services/files/ossFiles.dao'
import { setCompletedAfterRebuildDAO } from '~~/server/agents/contract/contractReview.dao'
import { injectAnnotations } from '~~/server/agents/contract/docx'
import { listAnnotationsForExportDAO } from '~~/server/agents/contract/contractAnnotation.dao'
import {
    downloadFileService,
    uploadFileService,
    generateSignedUrlService,
    deleteFileService,
} from '~~/server/services/storage/storage.service'
import { getDefaultStorageConfigDao } from '~~/server/services/storage/storageConfig.dao'

const mockFindOss = findOssFileByIdDao as ReturnType<typeof vi.fn>
const mockCreateOss = createOssFileDao as ReturnType<typeof vi.fn>
const mockSetCompleted = setCompletedAfterRebuildDAO as ReturnType<typeof vi.fn>
const mockInjectAnnotations = injectAnnotations as ReturnType<typeof vi.fn>
const mockListAnnotations = listAnnotationsForExportDAO as ReturnType<typeof vi.fn>
const mockDownload = downloadFileService as ReturnType<typeof vi.fn>
const mockUpload = uploadFileService as ReturnType<typeof vi.fn>
const mockSignUrl = generateSignedUrlService as ReturnType<typeof vi.fn>
const mockGetCfg = getDefaultStorageConfigDao as ReturnType<typeof vi.fn>
const mockDelete = deleteFileService as ReturnType<typeof vi.fn>

/** 构造 injectAnnotations 返回值 */
function injResult(buf: Buffer | Uint8Array) {
    return { buffer: buf, refsByAnnotationId: new Map<number, string>() }
}

/** 构造一条模拟 annotation（带 risk 关联） */
function makeDbAnnotation(id: number, overrides: Record<string, any> = {}) {
    return {
        id,
        reviewId: REVIEW_ID,
        riskId: 1,
        parentAnnotationId: null,
        authorType: 'ai',
        authorName: 'AI',
        content: '审查意见',
        deletedAt: null,
        suppressInExport: false,
        wordCommentRef: null,
        risk: { anchorQuote: '条款原文', anchorParagraphIndex: 1 },
        ...overrides,
    }
}

// ==================== 动态 import service ====================

const { rebuildDocxService } = await import(
    '../../../../server/services/assistant/contract/contractReviewRebuild.service'
)

// ==================== 固件 ====================

const USER_ID = 1001
const REVIEW_ID = 42
const ORIG_FILE_ID = 77

function review(overrides: Partial<Record<string, any>> = {}) {
    return {
        id: REVIEW_ID,
        userId: USER_ID,
        sessionId: 'sess',
        status: 'rebuilding',
        originalFileId: ORIG_FILE_ID,
        reviewedFileId: 88,
        risks: [{ id: 'r1', clauseText: 'x', level: 'low' }],
        ...overrides,
    } as any
}

// ==================== 测试 ====================

describe('rebuildDocxService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('happy path：下载→查 annotation→注入→上传→签名→createOssFile→setCompleted 顺序正确', async () => {
        mockFindOss.mockResolvedValue({ id: ORIG_FILE_ID, filePath: 'orig/path.docx', fileName: '劳动合同.docx' } as any)
        mockDownload.mockResolvedValue(Buffer.from('orig-docx'))
        mockListAnnotations.mockResolvedValue([makeDbAnnotation(1), makeDbAnnotation(2)])
        mockInjectAnnotations.mockResolvedValue(injResult(Buffer.from('new-docx')))
        mockUpload.mockResolvedValue({
            name: 'contract-review/1001/rebuild-xxx.docx',
            etag: 'e',
            url: 'u',
        })
        mockGetCfg.mockResolvedValue({ bucket: 'lexseek-bucket' } as any)
        mockSignUrl.mockResolvedValue('https://oss.signed/download')
        mockCreateOss.mockResolvedValue({ id: 999 } as any)
        mockSetCompleted.mockResolvedValue({ id: REVIEW_ID } as any)

        const result = await rebuildDocxService(review({ maxVersionNo: 2 }))

        // 用户可见文件名：{合同名}_{v 或 工作区}_{日期}.docx（spec §4.4）
        expect(result.reviewedFileId).toBe(999)
        expect(result.downloadUrl).toBe('https://oss.signed/download')
        expect(result.filename).toMatch(/^劳动合同_v2_\d{4}-\d{2}-\d{2}\.docx$/)

        // 时序断言：signUrl 在 createOss 之前，createOss 在 setCompleted 之前
        const signUrlOrder = mockSignUrl.mock.invocationCallOrder[0]
        const createOssOrder = mockCreateOss.mock.invocationCallOrder[0]
        const setCompletedOrder = mockSetCompleted.mock.invocationCallOrder[0]
        expect(signUrlOrder).toBeLessThan(createOssOrder)
        expect(createOssOrder).toBeLessThan(setCompletedOrder)

        // 关键断言：每个都被调 1 次
        expect(mockDownload).toHaveBeenCalledWith('orig/path.docx')
        expect(mockListAnnotations).toHaveBeenCalledWith(REVIEW_ID)
        expect(mockInjectAnnotations).toHaveBeenCalledTimes(1)
        expect(mockUpload).toHaveBeenCalledTimes(1)
        // 签名 URL 必须带 Content-Disposition，否则浏览器用 URL 最后一段作文件名
        expect(mockSignUrl).toHaveBeenCalledWith(
            'contract-review/1001/rebuild-xxx.docx',
            expect.objectContaining({
                expires: 3600,
                userId: USER_ID,
                response: expect.objectContaining({
                    contentDisposition: expect.stringContaining('attachment'),
                }),
            }),
        )
        expect(mockCreateOss).toHaveBeenCalledTimes(1)
        const ossArg = mockCreateOss.mock.calls[0]?.[0] as any
        expect(ossArg.userId).toBe(USER_ID)
        expect(ossArg.bucketName).toBe('lexseek-bucket')
        expect(ossArg.filePath).toBe('contract-review/1001/rebuild-xxx.docx')
        // ossFile.fileName 用规范文件名，方便 OSS 后台 / 后续功能识别
        expect(ossArg.fileName).toBe(result.filename)
        expect(mockSetCompleted).toHaveBeenCalledWith(REVIEW_ID, 999)
    })

    it('originalFileId 为空抛错 "没有原始文件"', async () => {
        await expect(rebuildDocxService(review({ originalFileId: null }))).rejects.toThrow(
            /没有原始文件/,
        )
        expect(mockFindOss).not.toHaveBeenCalled()
    })

    it('findOssFileByIdDao 返回 null 抛错 "原始文件已丢失"', async () => {
        mockFindOss.mockResolvedValue(null)
        await expect(rebuildDocxService(review())).rejects.toThrow(/原始文件已丢失/)
        expect(mockDownload).not.toHaveBeenCalled()
    })

    it('findOssFileByIdDao 返回 filePath 为空抛错 "原始文件已丢失"', async () => {
        mockFindOss.mockResolvedValue({ id: ORIG_FILE_ID, filePath: null } as any)
        await expect(rebuildDocxService(review())).rejects.toThrow(/原始文件已丢失/)
        expect(mockDownload).not.toHaveBeenCalled()
    })

    it('setCompletedAfterRebuildDAO 抛异常 → 错误冒泡（service 不 catch）', async () => {
        mockFindOss.mockResolvedValue({ id: ORIG_FILE_ID, filePath: 'orig/path.docx' } as any)
        mockDownload.mockResolvedValue(Buffer.from('orig'))
        mockListAnnotations.mockResolvedValue([makeDbAnnotation(1)])
        mockInjectAnnotations.mockResolvedValue(injResult(Buffer.from('new')))
        mockUpload.mockResolvedValue({ name: 'contract-review/1001/rebuild-x.docx', etag: 'e', url: 'u' })
        mockGetCfg.mockResolvedValue({ bucket: 'b' } as any)
        mockSignUrl.mockResolvedValue('https://signed')
        mockCreateOss.mockResolvedValue({ id: 999 } as any)
        mockSetCompleted.mockRejectedValue(new Error('db write failed'))

        await expect(rebuildDocxService(review())).rejects.toThrow(/db write failed/)
    })

    it('generateSignedUrlService 抛异常 → createOssFileDao / setCompletedAfterRebuildDAO 都未被调（P0-4 时序）', async () => {
        mockFindOss.mockResolvedValue({ id: ORIG_FILE_ID, filePath: 'orig/path.docx' } as any)
        mockDownload.mockResolvedValue(Buffer.from('orig'))
        mockListAnnotations.mockResolvedValue([makeDbAnnotation(1)])
        mockInjectAnnotations.mockResolvedValue(injResult(Buffer.from('new')))
        mockUpload.mockResolvedValue({ name: 'contract-review/1001/rebuild-x.docx', etag: 'e', url: 'u' })
        mockGetCfg.mockResolvedValue({ bucket: 'b' } as any)
        mockSignUrl.mockRejectedValue(new Error('signed-url failed'))

        await expect(rebuildDocxService(review())).rejects.toThrow(/signed-url failed/)
        // P0-4 关键时序验证：signedUrl 失败时，createOssFile 和 setCompleted 都不应被调
        expect(mockCreateOss).not.toHaveBeenCalled()
        expect(mockSetCompleted).not.toHaveBeenCalled()
    })

    it('annotation 列表为空 → listAnnotationsForExportDAO 返回空数组，仍走 inject 流程（空 docx）', async () => {
        mockFindOss.mockResolvedValue({ id: ORIG_FILE_ID, filePath: 'orig/path.docx' } as any)
        mockDownload.mockResolvedValue(Buffer.from('orig'))
        mockListAnnotations.mockResolvedValue([])
        mockInjectAnnotations.mockResolvedValue(injResult(Buffer.from('new')))
        mockUpload.mockResolvedValue({ name: 'contract-review/1001/rebuild-x.docx', etag: 'e', url: 'u' })
        mockGetCfg.mockResolvedValue({ bucket: 'b' } as any)
        mockSignUrl.mockResolvedValue('https://signed')
        mockCreateOss.mockResolvedValue({ id: 123 } as any)
        mockSetCompleted.mockResolvedValue({ id: REVIEW_ID } as any)

        await rebuildDocxService(review())
        // 空 annotations 时 injectAnnotations 仍被调用（它内部会 remove comments.xml）
        expect(mockInjectAnnotations).toHaveBeenCalledTimes(1)
        const injectCall = mockInjectAnnotations.mock.calls[0]
        expect(injectCall?.[1]).toEqual([])
    })

    it('storageConfig 为 null → bucketName 回退空字符串，流程仍继续', async () => {
        mockFindOss.mockResolvedValue({ id: ORIG_FILE_ID, filePath: 'orig/path.docx' } as any)
        mockDownload.mockResolvedValue(Buffer.from('orig'))
        mockListAnnotations.mockResolvedValue([makeDbAnnotation(1)])
        mockInjectAnnotations.mockResolvedValue(injResult(Buffer.from('new')))
        mockUpload.mockResolvedValue({ name: 'contract-review/1001/rebuild-x.docx', etag: 'e', url: 'u' })
        mockGetCfg.mockResolvedValue(null)
        mockSignUrl.mockResolvedValue('https://signed')
        mockCreateOss.mockResolvedValue({ id: 321 } as any)
        mockSetCompleted.mockResolvedValue({ id: REVIEW_ID } as any)

        await rebuildDocxService(review())
        const ossArg = mockCreateOss.mock.calls[0]?.[0] as any
        expect(ossArg.bucketName).toBe('')
    })

    it('injectAnnotations 返回 Uint8Array（非 Buffer）→ Buffer.from 分支正确处理', async () => {
        mockFindOss.mockResolvedValue({ id: ORIG_FILE_ID, filePath: 'orig/path.docx' } as any)
        mockDownload.mockResolvedValue(Buffer.from('orig'))
        mockListAnnotations.mockResolvedValue([makeDbAnnotation(1)])
        // 返回非 Buffer 的 Uint8Array
        mockInjectAnnotations.mockResolvedValue(injResult(new Uint8Array([1, 2, 3])))
        mockUpload.mockResolvedValue({ name: 'contract-review/1001/rebuild-x.docx', etag: 'e', url: 'u' })
        mockGetCfg.mockResolvedValue({ bucket: 'b' } as any)
        mockSignUrl.mockResolvedValue('https://signed')
        mockCreateOss.mockResolvedValue({ id: 456 } as any)
        mockSetCompleted.mockResolvedValue({ id: REVIEW_ID } as any)

        const r = await rebuildDocxService(review())
        expect(r.reviewedFileId).toBe(456)
        const uploadArg = mockUpload.mock.calls[0]?.[1]
        expect(Buffer.isBuffer(uploadArg)).toBe(true)
    })
})
