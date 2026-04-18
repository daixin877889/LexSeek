import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('~~/server/services/assistant/contract/contractReview.dao', () => ({
    getContractReviewDAO: vi.fn(),
    updateContractReviewDAO: vi.fn(),
}))
vi.mock('~~/server/services/assistant/contract/docx', () => ({
    injectComments: vi.fn(),
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
import { injectComments } from '~~/server/services/assistant/contract/docx'
import {
    downloadFileService,
    uploadFileService,
} from '~~/server/services/storage/storage.service'
import { getDefaultStorageConfigDao } from '~~/server/services/storage/storageConfig.dao'
import {
    findOssFileByIdDao,
    createOssFileDao,
} from '~~/server/services/files/ossFiles.dao'

function getHooks(mw: any) {
    // createMiddleware 返回的对象形状：mw.beforeAgent.hook / mw.afterAgent.hook
    // 若运行时直接把 hook 函数挂在 mw.beforeAgent / mw.afterAgent 上也兼容
    return {
        before: mw.beforeAgent?.hook ?? mw.beforeAgent,
        after: mw.afterAgent?.hook ?? mw.afterAgent,
    }
}

describe('reviewResultPersistenceMiddleware', () => {
    const opts = { reviewId: 42, sessionId: 's1' }

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('beforeAgent 置 status=reviewing', async () => {
        const mw = reviewResultPersistenceMiddleware(opts)
        const { before } = getHooks(mw)
        await before({})
        expect(updateContractReviewDAO).toHaveBeenCalledWith(42, { status: 'reviewing' })
    })

    it('afterAgent happy path：写 risks/summary → 注入 → 上传 → 写 ossFile → status=completed', async () => {
        ;(getContractReviewDAO as any).mockResolvedValueOnce({
            id: 42, userId: 7, originalFileId: 99,
        })
        ;(findOssFileByIdDao as any).mockResolvedValueOnce({ id: 99, filePath: 'orig.docx' })
        ;(downloadFileService as any).mockResolvedValueOnce(Buffer.from('orig'))
        ;(injectComments as any).mockResolvedValueOnce(Buffer.from('reviewed'))
        ;(uploadFileService as any).mockResolvedValueOnce({ name: 'users/7/contract-review/reviewed-42.docx' })
        ;(getDefaultStorageConfigDao as any).mockResolvedValueOnce({ bucket: 'test-bucket' })
        ;(createOssFileDao as any).mockResolvedValueOnce({ id: 200 })
        ;(updateContractReviewDAO as any).mockResolvedValue({})

        const mw = reviewResultPersistenceMiddleware(opts)
        const { after } = getHooks(mw)
        await after({
            structuredResponse: {
                risks: [{ id: 'r1', clauseIndex: 0, level: 'low' }],
                summary: 'ok',
            },
        })
        expect(updateContractReviewDAO).toHaveBeenNthCalledWith(1, 42, {
            risks: [{ id: 'r1', clauseIndex: 0, level: 'low' }],
            summary: 'ok',
        })
        expect(injectComments).toHaveBeenCalled()
        expect(updateContractReviewDAO).toHaveBeenLastCalledWith(42, {
            reviewedFileId: 200, status: 'completed',
        })
    })

    it('structuredResponse 缺失 → status=failed，不调 injectComments', async () => {
        const mw = reviewResultPersistenceMiddleware(opts)
        const { after } = getHooks(mw)
        await after({})
        expect(updateContractReviewDAO).toHaveBeenCalledWith(42, { status: 'failed' })
        expect(injectComments).not.toHaveBeenCalled()
    })

    it('injectComments 抛错 → risks/summary 已写库 + status=failed', async () => {
        ;(getContractReviewDAO as any).mockResolvedValueOnce({
            id: 42, userId: 7, originalFileId: 99,
        })
        ;(findOssFileByIdDao as any).mockResolvedValueOnce({ id: 99, filePath: 'orig.docx' })
        ;(downloadFileService as any).mockResolvedValueOnce(Buffer.from('orig'))
        ;(injectComments as any).mockRejectedValueOnce(new Error('xml parse fail'))
        ;(updateContractReviewDAO as any).mockResolvedValue({})

        const mw = reviewResultPersistenceMiddleware(opts)
        const { after } = getHooks(mw)
        await after({
            structuredResponse: {
                risks: [{ id: 'r1', clauseIndex: 0, level: 'low' }],
                summary: 'ok',
            },
        })
        // 第一次：写 risks/summary（可 rebuild 恢复的关键）
        expect(updateContractReviewDAO).toHaveBeenNthCalledWith(1, 42, {
            risks: [{ id: 'r1', clauseIndex: 0, level: 'low' }],
            summary: 'ok',
        })
        // 最后一次：status=failed
        expect(updateContractReviewDAO).toHaveBeenLastCalledWith(42, { status: 'failed' })
    })
})
