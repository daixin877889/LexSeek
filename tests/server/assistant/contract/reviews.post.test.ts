/**
 * createAndStartContractReviewService 测试
 *
 * 跳过 handler 层 401 测试：handler 中 `if (!user) return resError(event, 401, ...)`
 * 是项目所有 API 统一写法，搭 h3 mock 不划算。本套测测 service 层 5 条路径。
 *
 * **Feature: contract-review-m3**
 * **Validates: Task 7.1 + 7.2**
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ==================== Mock 外部依赖（必须在 import 被测模块之前） ====================

vi.mock('~~/server/services/files/ossFiles.dao', () => ({
    findOssFileByIdDao: vi.fn(),
    createOssFileDao: vi.fn(),
}))

vi.mock('~~/server/services/storage/storage.service', () => ({
    uploadFileService: vi.fn(),
}))

vi.mock('~~/server/services/storage/storageConfig.dao', () => ({
    getDefaultStorageConfigDao: vi.fn(),
}))

vi.mock('~~/server/agents/contract/textToDocx.service', () => ({
    textToDocxService: vi.fn(),
}))

vi.mock('~~/server/agents/contract/contractReview.dao', () => ({
    createContractReviewDAO: vi.fn(),
}))

vi.mock('~~/server/services/agent/agentRun.service', () => ({
    enqueueRunService: vi.fn(),
}))

vi.mock('~~/server/utils/db', () => ({
    prisma: {
        caseSessions: { create: vi.fn() },
        cases: { findFirst: vi.fn() },
    },
}))

// ==================== 导入被测模块（在 mock 之后） ====================

import { createAndStartContractReviewService } from '~~/server/agents/contract/contractReview.service'
import { findOssFileByIdDao, createOssFileDao } from '~~/server/services/files/ossFiles.dao'
import { uploadFileService } from '~~/server/services/storage/storage.service'
import { getDefaultStorageConfigDao } from '~~/server/services/storage/storageConfig.dao'
import { textToDocxService } from '~~/server/agents/contract/textToDocx.service'
import { createContractReviewDAO } from '~~/server/agents/contract/contractReview.dao'
import { enqueueRunService } from '~~/server/services/agent/agentRun.service'
import { prisma } from '~~/server/utils/db'

// ==================== 类型转换（方便使用 mockResolvedValue） ====================

const mockFindOssFileByIdDao = findOssFileByIdDao as ReturnType<typeof vi.fn>
const mockCreateOssFileDao = createOssFileDao as ReturnType<typeof vi.fn>
const mockUploadFileService = uploadFileService as ReturnType<typeof vi.fn>
const mockGetDefaultStorageConfigDao = getDefaultStorageConfigDao as ReturnType<typeof vi.fn>
const mockTextToDocxService = textToDocxService as ReturnType<typeof vi.fn>
const mockCreateContractReviewDAO = createContractReviewDAO as ReturnType<typeof vi.fn>
const mockEnqueueRunService = enqueueRunService as ReturnType<typeof vi.fn>
const mockCaseSessionsCreate = (prisma.caseSessions.create as unknown) as ReturnType<typeof vi.fn>
const mockCasesFindFirst = (prisma.cases.findFirst as unknown) as ReturnType<typeof vi.fn>

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// ==================== 默认 mock 设置 ====================

beforeEach(() => {
    vi.resetAllMocks()

    mockFindOssFileByIdDao.mockResolvedValue({
        id: 501,
        userId: 100,
        fileType: DOCX_MIME,
    })
    mockTextToDocxService.mockResolvedValue(Buffer.from('docx-bytes'))
    mockUploadFileService.mockResolvedValue({
        name: 'contract-review/100/abc.docx',
        etag: 'etag-1',
        url: 'https://oss.example.com/abc.docx',
    })
    mockGetDefaultStorageConfigDao.mockResolvedValue({
        id: 1,
        bucket: 'test-bucket',
        type: 'ALIYUN_OSS',
    })
    mockCreateOssFileDao.mockResolvedValue({ id: 777 })
    mockCaseSessionsCreate.mockResolvedValue({
        sessionId: 'mock-session-uuid',
        scope: 'contract',
    })
    mockCreateContractReviewDAO.mockResolvedValue({
        id: 42,
        sessionId: 'mock-session-uuid',
        status: 'pending',
    })
    mockEnqueueRunService.mockResolvedValue({ runId: 'run-001', isNew: true })
})

afterEach(() => {
    vi.clearAllMocks()
})

// ==================== 测试 ====================

describe('createAndStartContractReviewService', () => {
    describe('sourceType=upload 成功路径', () => {
        it('校验 ossFile 归属并返回 { reviewId, sessionId }', async () => {
            const result = await createAndStartContractReviewService({
                userId: 100,
                sourceType: 'upload',
                ossFileId: 501,
            })

            expect(mockFindOssFileByIdDao).toHaveBeenCalledWith(501)
            expect(mockCaseSessionsCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        scope: 'contract',
                        userId: 100,
                    }),
                }),
            )
            expect(mockCreateContractReviewDAO).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 100,
                    originalFileId: 501,
                    status: 'pending',
                }),
            )
            expect(mockEnqueueRunService).toHaveBeenCalled()
            expect(result).toEqual({ reviewId: 42, sessionId: expect.any(String) })
        })
    })

    describe('sourceType=paste 成功路径', () => {
        it('调 textToDocxService 上传并返回 { reviewId, sessionId }', async () => {
            const result = await createAndStartContractReviewService({
                userId: 100,
                sourceType: 'paste',
                text: '甲方：A 公司\n乙方：B 公司\n第一条 ...',
            })

            expect(mockTextToDocxService).toHaveBeenCalledWith('甲方：A 公司\n乙方：B 公司\n第一条 ...')
            expect(mockUploadFileService).toHaveBeenCalled()
            expect(mockCreateOssFileDao).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 100,
                    fileType: DOCX_MIME,
                    bucketName: 'test-bucket',
                }),
            )
            expect(mockCreateContractReviewDAO).toHaveBeenCalledWith(
                expect.objectContaining({
                    originalFileId: 777,
                    status: 'pending',
                }),
            )
            expect(result).toEqual({ reviewId: 42, sessionId: expect.any(String) })
        })
    })

    describe('错误路径', () => {
        it('sourceType=upload 但 ossFile 不属于当前用户 → 403', async () => {
            mockFindOssFileByIdDao.mockResolvedValue({
                id: 501,
                userId: 200, // 非调用者 100
                fileType: DOCX_MIME,
            })

            const result = await createAndStartContractReviewService({
                userId: 100,
                sourceType: 'upload',
                ossFileId: 501,
            })

            expect(result).toEqual({ error: '文件不存在或无权访问', code: 403 })
            expect(mockCreateContractReviewDAO).not.toHaveBeenCalled()
            expect(mockEnqueueRunService).not.toHaveBeenCalled()
        })

        it('sourceType=paste 但 text 超过 50000 字 → 413', async () => {
            const longText = 'a'.repeat(50001)

            const result = await createAndStartContractReviewService({
                userId: 100,
                sourceType: 'paste',
                text: longText,
            })

            expect(result).toEqual({
                error: '粘贴文本长度不能超过 50000 字',
                code: 413,
            })
            expect(mockTextToDocxService).not.toHaveBeenCalled()
            expect(mockCreateContractReviewDAO).not.toHaveBeenCalled()
        })

        it('sourceType=upload 但 MIME 不是 docx → 400', async () => {
            mockFindOssFileByIdDao.mockResolvedValue({
                id: 501,
                userId: 100,
                fileType: 'application/pdf',
            })

            const result = await createAndStartContractReviewService({
                userId: 100,
                sourceType: 'upload',
                ossFileId: 501,
            })

            expect(result).toEqual({
                error: '仅支持 .docx 格式的合同文件',
                code: 400,
            })
            expect(mockCreateContractReviewDAO).not.toHaveBeenCalled()
        })

        it('sourceType=upload 但 ossFileId 缺失 → 400', async () => {
            const result = await createAndStartContractReviewService({
                userId: 100,
                sourceType: 'upload',
            })
            expect(result).toEqual({ error: 'ossFileId 不能为空', code: 400 })
            expect(mockFindOssFileByIdDao).not.toHaveBeenCalled()
        })

        it('sourceType=paste 但 text 为空串 → 400', async () => {
            const result = await createAndStartContractReviewService({
                userId: 100,
                sourceType: 'paste',
                text: '',
            })
            expect(result).toEqual({ error: '粘贴文本不能为空', code: 400 })
            expect(mockTextToDocxService).not.toHaveBeenCalled()
        })

        it('未知 sourceType → 400', async () => {
            const result = await createAndStartContractReviewService({
                userId: 100,
                // 服务层第三路 else 分支安全网（zod 已在 handler 层先拦，这里确保服务自守护）
                sourceType: 'unknown' as unknown as 'upload',
            })
            expect(result).toEqual({ error: '不支持的 sourceType', code: 400 })
        })
    })

    describe('caseId 关联（M6.3）', () => {
        it('传 caseId 且归属当前用户 → 写入 review.caseId', async () => {
            mockCasesFindFirst.mockResolvedValue({ id: 777 })

            const result = await createAndStartContractReviewService({
                userId: 100,
                sourceType: 'upload',
                ossFileId: 501,
                caseId: 777,
            })

            expect(mockCasesFindFirst).toHaveBeenCalledWith({
                where: { id: 777, userId: 100, deletedAt: null },
                select: { id: true },
            })
            expect(mockCreateContractReviewDAO).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 100,
                    originalFileId: 501,
                    status: 'pending',
                    caseId: 777,
                }),
            )
            expect(result).toEqual({ reviewId: 42, sessionId: expect.any(String) })
        })

        it('不传 caseId → 不校验案件、review.caseId 为 undefined', async () => {
            await createAndStartContractReviewService({
                userId: 100,
                sourceType: 'upload',
                ossFileId: 501,
            })

            expect(mockCasesFindFirst).not.toHaveBeenCalled()
            const daoArg = mockCreateContractReviewDAO.mock.calls[0]?.[0]
            expect(daoArg).toBeDefined()
            expect(daoArg.caseId).toBeUndefined()
        })

        it('传 caseId 但案件不存在或不归属当前用户 → 403', async () => {
            mockCasesFindFirst.mockResolvedValue(null)

            const result = await createAndStartContractReviewService({
                userId: 100,
                sourceType: 'upload',
                ossFileId: 501,
                caseId: 999,
            })

            expect(result).toEqual({ error: '案件不存在或无权访问', code: 403 })
            expect(mockCreateContractReviewDAO).not.toHaveBeenCalled()
            expect(mockEnqueueRunService).not.toHaveBeenCalled()
        })
    })
})
