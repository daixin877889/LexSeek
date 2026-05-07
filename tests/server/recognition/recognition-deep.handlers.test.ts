/**
 * Recognition handler 深度 happy path 覆盖
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../_helpers/handler-test'
import { makeEvent, expectSuccess, expectError } from '../_helpers/handler-test'

vi.mock('~~/server/services/material/ocr.dao', () => ({
    findImageRecognitionByOssFileIdDao: vi.fn(),
}))
vi.mock('~~/server/services/material/mineru.dao', () => ({
    findDocRecognitionByOssFileIdDao: vi.fn(),
    createDocRecognitionRecordDao: vi.fn(),
    updateDocRecognitionRecordDao: vi.fn(),
}))
vi.mock('~~/server/services/material/mineruTask.service', () => ({
    createMineruTaskService: vi.fn(),
    getMineruTaskByOssFileIdService: vi.fn(),
}))
vi.mock('~~/server/services/material/mineruToken.service', () => ({
    pickTokenForNewTaskService: vi.fn(async () => ({ id: 1, token: 'tk' })),
}))
vi.mock('~~/server/services/material/materialEmbedding.service', () => ({
    embedDocumentService: vi.fn(),
}))
vi.mock('~~/server/services/files/files.service', () => ({
    generateOssDownloadSignaturesService: vi.fn(async () => []),
}))
vi.mock('ofetch', () => ({
    $fetch: vi.fn(async () => ({ code: 0, data: { batch_id: 'B', file_urls: ['https://upload.url/1'] } })),
}))

;(globalThis as any).prisma = {
    ossFiles: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => ({ id: 1, fileName: 'a.docx', userId: 100 })),
    },
}

import { findDocRecognitionByOssFileIdDao, createDocRecognitionRecordDao, updateDocRecognitionRecordDao } from '~~/server/services/material/mineru.dao'
import { findImageRecognitionByOssFileIdDao } from '~~/server/services/material/ocr.dao'
import { embedDocumentService } from '~~/server/services/material/materialEmbedding.service'
import { generateOssDownloadSignaturesService } from '~~/server/services/files/files.service'
import { createMineruTaskService } from '~~/server/services/material/mineruTask.service'

const { default: docStatusHandler } = await import('../../../server/api/v1/recognition/doc/status/[ossFileId].get')
const { default: docSaveHandler } = await import('../../../server/api/v1/recognition/doc/save.post')
const { default: mineruUploadUrlHandler } = await import('../../../server/api/v1/recognition/mineru/upload-url.post')

beforeEach(() => vi.clearAllMocks())

describe('GET /api/v1/recognition/doc/status/:ossFileId deep', () => {
    it('docRecord 不存在但 imageRecord 命中', async () => {
        ;(findDocRecognitionByOssFileIdDao as any).mockResolvedValue(null)
        ;(findImageRecognitionByOssFileIdDao as any).mockResolvedValue({
            id: 1, status: 2, imageType: 'photo',
            htmlContent: '<p>X</p>', markdownContent: 'X',
            vectorIds: [], lastEmbeddingAt: null,
        })
        const res: any = await docStatusHandler(makeEvent({ userId: 100, params: { ossFileId: '1' } }) as any)
        expectSuccess(res, d => {
            expect(d.recognized).toBe(true)
            expect(d.recordType).toBe('image')
        })
    })

    it('docRecord 命中但 status 非成功', async () => {
        ;(findDocRecognitionByOssFileIdDao as any).mockResolvedValue({
            id: 1, status: 1, htmlContent: null, markdownContent: null, vectorIds: [], lastEmbeddingAt: null,
        })
        const res: any = await docStatusHandler(makeEvent({ userId: 100, params: { ossFileId: '1' } }) as any)
        expectSuccess(res, d => expect(d.recognized).toBe(false))
    })

    it('docRecord 命中且包含图片占位符 → 替换为签名 URL', async () => {
        ;(findDocRecognitionByOssFileIdDao as any).mockResolvedValue({
            id: 1, status: 2,
            htmlContent: '<img src="{{OSS_IMAGE:bucket-1:99}}">',
            markdownContent: '![](`{{OSS_IMAGE:bucket-1:99}}`)',
            vectorIds: [],
            lastEmbeddingAt: new Date('2026-04-01'),
        })
        ;(globalThis as any).prisma.ossFiles.findMany.mockResolvedValue([
            { id: 99, bucketName: 'bucket-1' },
        ])
        ;(generateOssDownloadSignaturesService as any).mockResolvedValue([
            { ossFileId: 99, downloadUrl: 'https://signed/99' },
        ])
        const res: any = await docStatusHandler(makeEvent({ userId: 100, params: { ossFileId: '1' } }) as any)
        expectSuccess(res, d => {
            expect(d.record.htmlContent).toContain('signed/99')
        })
    })

    it('两种记录都不存在 → recognized=false', async () => {
        ;(findDocRecognitionByOssFileIdDao as any).mockResolvedValue(null)
        ;(findImageRecognitionByOssFileIdDao as any).mockResolvedValue(null)
        const res: any = await docStatusHandler(makeEvent({ userId: 100, params: { ossFileId: '1' } }) as any)
        expectSuccess(res, d => expect(d.recognized).toBe(false))
    })
})

describe('POST /api/v1/recognition/doc/save deep', () => {
    it('happy path - 新记录', async () => {
        ;(findDocRecognitionByOssFileIdDao as any).mockResolvedValue(null)
        ;(createDocRecognitionRecordDao as any).mockResolvedValue({ id: 1 })
        ;(embedDocumentService as any).mockResolvedValue({ vectorIds: ['v1'], lastEmbeddingAt: new Date() })
        ;(updateDocRecognitionRecordDao as any).mockResolvedValue({ id: 1, vectorIds: ['v1'], lastEmbeddingAt: new Date() })
        const res: any = await docSaveHandler(makeEvent({
            userId: 100,
            body: {
                ossFileId: 1,
                htmlContent: '<p>X</p>',
                markdownContent: 'X',
                fileName: 'a.docx',
            },
        }) as any)
        expectSuccess(res)
    })

    it('happy path - 已存在记录则更新', async () => {
        ;(findDocRecognitionByOssFileIdDao as any).mockResolvedValue({ id: 1 })
        ;(updateDocRecognitionRecordDao as any).mockResolvedValue({ id: 1, vectorIds: ['v1'], lastEmbeddingAt: new Date() })
        ;(embedDocumentService as any).mockResolvedValue({ vectorIds: ['v1'], lastEmbeddingAt: new Date() })
        const res: any = await docSaveHandler(makeEvent({
            userId: 100,
            body: {
                ossFileId: 1,
                htmlContent: '<p>X</p>',
                markdownContent: 'X',
            },
        }) as any)
        expectSuccess(res)
    })

    it('embed 失败 → 仍 success（向量嵌入容错）', async () => {
        ;(findDocRecognitionByOssFileIdDao as any).mockResolvedValue(null)
        ;(createDocRecognitionRecordDao as any).mockResolvedValue({ id: 1 })
        ;(updateDocRecognitionRecordDao as any).mockResolvedValue({ id: 1 })
        ;(embedDocumentService as any).mockRejectedValue(new Error('embed fail'))
        const res: any = await docSaveHandler(makeEvent({
            userId: 100,
            body: {
                ossFileId: 1,
                htmlContent: '<p>X</p>',
                markdownContent: 'X',
            },
        }) as any)
        // embed 失败不影响主流程，handler 走完返回 success
        expectSuccess(res)
    })

    it('文件不存在 → 404', async () => {
        ;(globalThis as any).prisma.ossFiles.findFirst.mockResolvedValueOnce(null)
        const res: any = await docSaveHandler(makeEvent({
            userId: 100,
            body: {
                ossFileId: 1,
                htmlContent: '<p>X</p>',
                markdownContent: 'X',
            },
        }) as any)
        expectError(res, 404)
    })
})

describe('POST /api/v1/recognition/mineru/upload-url deep', () => {
    it('happy path（文件全部存在）', async () => {
        ;(globalThis as any).prisma.ossFiles.findMany.mockResolvedValue([
            { id: 1, fileName: 'a.pdf', userId: 100 },
        ])
        ;(findDocRecognitionByOssFileIdDao as any).mockResolvedValue(null)
        ;(createDocRecognitionRecordDao as any).mockResolvedValue({ id: 1 })
        ;(createMineruTaskService as any).mockResolvedValue({ id: 1 })
        const res: any = await mineruUploadUrlHandler(makeEvent({
            userId: 100,
            body: { files: [{ ossFileId: 1, fileName: 'a.pdf' }] },
        }) as any)
        expectSuccess(res, d => {
            expect(d.batchId).toBe('B')
            expect(d.files).toHaveLength(1)
        })
    })

    it('MinerU 返回非 0 code → 500', async () => {
        ;(globalThis as any).prisma.ossFiles.findMany.mockResolvedValue([
            { id: 1, fileName: 'a.pdf', userId: 100 },
        ])
        const { $fetch } = await import('ofetch')
        ;($fetch as any).mockResolvedValueOnce({ code: 1, msg: 'API 错' })
        const res: any = await mineruUploadUrlHandler(makeEvent({
            userId: 100,
            body: { files: [{ ossFileId: 1, fileName: 'a.pdf' }] },
        }) as any)
        expectError(res, 500)
    })

    it('返回链接数量不匹配 → 500', async () => {
        ;(globalThis as any).prisma.ossFiles.findMany.mockResolvedValue([
            { id: 1, fileName: 'a.pdf', userId: 100 },
            { id: 2, fileName: 'b.pdf', userId: 100 },
        ])
        const { $fetch } = await import('ofetch')
        ;($fetch as any).mockResolvedValueOnce({ code: 0, data: { batch_id: 'B', file_urls: ['url1'] } })
        const res: any = await mineruUploadUrlHandler(makeEvent({
            userId: 100,
            body: { files: [
                { ossFileId: 1, fileName: 'a.pdf' },
                { ossFileId: 2, fileName: 'b.pdf' },
            ] },
        }) as any)
        expectError(res, 500)
    })
})
