/**
 * reviewResultPersistenceMiddleware 单元测试（M6.1 子期 2 改造后）
 *
 * 说明：risks 由 runAnalyzeLoop 在 agent resume 分支直接写 DB；
 * middleware.afterAgent 只负责"读 DB → 调 runAnnotateAndUpload"兜底路径。
 *
 * 完整注入链路（原始文件 + injectComments + OSS 上传）由 m3Integration.test.ts
 * 用真实 DB 覆盖；本单测只验证中间件对 DB 状态分支的路由逻辑。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('~~/server/services/assistant/contract/contractReview.dao', () => ({
    getContractReviewDAO: vi.fn(),
    updateContractReviewDAO: vi.fn(),
}))
vi.mock('~~/server/services/assistant/contract/contractAnnotation.dao', () => ({
    listAnnotationsForExportDAO: vi.fn().mockResolvedValue([{
        id: 'a1',
        riskId: '00000000-0000-4000-8000-000000000001',
        authorType: 'system',
        authorName: 'system',
        content: 'mock annotation',
        parentAnnotationId: null,
        wordCommentRef: 1,
        createdAt: new Date(),
        risk: {
            anchorQuote: 'q',
            anchorParagraphIndex: 0,
            orphaned: false,
        },
    }]),
}))
vi.mock('~~/server/services/assistant/contract/contractAnnotation.service', () => ({
    isAnnotationExportable: vi.fn().mockReturnValue(true),
}))
vi.mock('~~/server/services/assistant/contract/utils/uploadAndRegisterOssFile', () => ({
    uploadAndRegisterOssFile: vi.fn().mockResolvedValue({ ossFileId: 200, name: 'reviewed.docx' }),
}))
vi.mock('~~/server/services/assistant/contract/docx', () => ({
    injectAnnotations: vi.fn(),
}))
vi.mock('~~/server/services/storage/storage.service', () => ({
    downloadFileService: vi.fn(),
    uploadFileService: vi.fn(),
}))
vi.mock('~~/server/services/storage/storageConfig.dao', () => ({
    getDefaultStorageConfigDao: vi.fn(),
}))
vi.mock('~~/server/services/files/ossFiles.dao', () => ({
    findOssFileByIdDao: vi.fn(),
    createOssFileDao: vi.fn(),
}))

import { reviewResultPersistenceMiddleware } from '~~/server/services/workflow/middleware/reviewResultPersistence.middleware'
import {
    getContractReviewDAO,
    updateContractReviewDAO,
} from '~~/server/services/assistant/contract/contractReview.dao'
import { injectAnnotations } from '~~/server/services/assistant/contract/docx'
import {
    downloadFileService,
} from '~~/server/services/storage/storage.service'
import {
    findOssFileByIdDao,
} from '~~/server/services/files/ossFiles.dao'

function getHooks(mw: any) {
    // createMiddleware 返回的对象形状：mw.beforeAgent.hook / mw.afterAgent.hook
    // 若运行时直接把 hook 函数挂在 mw.beforeAgent / mw.afterAgent 上也兼容
    return {
        before: mw.beforeAgent?.hook ?? mw.beforeAgent,
        after: mw.afterAgent?.hook ?? mw.afterAgent,
    }
}

describe('reviewResultPersistenceMiddleware (M6.1 子期 2 改造后)', () => {
    const opts = { reviewId: 42, sessionId: 's1' }

    function makeRisk(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
        return {
            id: '00000000-0000-4000-8000-000000000001',
            clauseIndex: 0,
            clauseText: '原文段落',
            level: 'low',
            category: '其他',
            problem: '问题描述',
            analysis: '条款分析',
            risk: '法律风险',
            suggestion: '修改建议',
            ...overrides,
        }
    }

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('beforeAgent 置 status=reviewing', async () => {
        const mw = reviewResultPersistenceMiddleware(opts)
        const { before } = getHooks(mw)
        await before({})
        expect(updateContractReviewDAO).toHaveBeenCalledWith(42, { status: 'reviewing' })
    })

    it('afterAgent：DB risks 有值 → runAnnotateAndUpload 被调（完整注入+上传链路触发）', async () => {
        const risk = makeRisk()
        // 第一次 getContractReviewDAO：afterAgent 自己读 DB 判断 status/risks
        // 第二次 getContractReviewDAO：runAnnotateAndUpload 内部再读一遍取完整 review 对象
        ;(getContractReviewDAO as any)
            .mockResolvedValueOnce({
                id: 42, userId: 7, originalFileId: 99, status: 'reviewing', risks: [risk],
            })
            .mockResolvedValueOnce({
                id: 42, userId: 7, originalFileId: 99, status: 'reviewing', risks: [risk],
            })
        ;(findOssFileByIdDao as any).mockResolvedValueOnce({ id: 99, filePath: 'orig.docx' })
        ;(downloadFileService as any).mockResolvedValueOnce(Buffer.from('orig'))
        ;(injectAnnotations as any).mockResolvedValueOnce({
            buffer: Buffer.from('reviewed'),
            validAnnotations: [{ id: 'a1' }],
            skippedIndices: [],
            refsByAnnotationId: new Map([['a1', 1]]),
        })
        ;(updateContractReviewDAO as any).mockResolvedValue({})

        const mw = reviewResultPersistenceMiddleware(opts)
        const { after } = getHooks(mw)
        await after({})

        // 注入链路被触发
        expect(injectAnnotations).toHaveBeenCalled()
        // 终局 update：status=completed + reviewedFileId
        expect(updateContractReviewDAO).toHaveBeenLastCalledWith(42, {
            reviewedFileId: 200, status: 'completed',
        })
    })

    it('afterAgent：DB risks 为空 → status=failed，不调 injectComments', async () => {
        ;(getContractReviewDAO as any).mockResolvedValueOnce({
            id: 42, userId: 7, originalFileId: 99, status: 'reviewing', risks: [],
        })
        ;(updateContractReviewDAO as any).mockResolvedValue({})

        const mw = reviewResultPersistenceMiddleware(opts)
        const { after } = getHooks(mw)
        await after({})

        expect(updateContractReviewDAO).toHaveBeenCalledWith(42, { status: 'failed' })
        expect(injectAnnotations).not.toHaveBeenCalled()
    })

    it('afterAgent：review.status=completed → 跳过（幂等，主流程已处理）', async () => {
        ;(getContractReviewDAO as any).mockResolvedValueOnce({
            id: 42, userId: 7, originalFileId: 99, status: 'completed', risks: [makeRisk()],
        })

        const mw = reviewResultPersistenceMiddleware(opts)
        const { after } = getHooks(mw)
        await after({})

        // 已 completed：不应再次触发 updateContractReviewDAO，也不应触发注入链路
        expect(updateContractReviewDAO).not.toHaveBeenCalled()
        expect(injectAnnotations).not.toHaveBeenCalled()
    })
})
