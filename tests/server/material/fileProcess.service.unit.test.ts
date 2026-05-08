/**
 * 文件粒度识别服务测试
 *
 * 覆盖 fileProcess.service.ts：
 * - processFileMaterials: 批量文件处理、已有记录复用、触发识别
 * - buildRecordMap: 状态过滤
 * - processOneFile: 文件不存在、已有内容、识别失败
 * - findExistingContent: 各类型查找
 * - recognizeFile: 图片/音频/文档处理
 *
 * **Feature: file-process-coverage**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CaseMaterialType } from '#shared/types/case'

// Mock Nuxt 自动导入
vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

vi.stubGlobal('prisma', {
    ossFiles: { findMany: vi.fn() },
    docRecognitionRecords: { findMany: vi.fn() },
    imageRecognitionRecords: { findMany: vi.fn() },
    asrRecords: { findMany: vi.fn(), findFirst: vi.fn() },
})

// Mock 依赖服务
const mockCreateImageConversionService = vi.fn()
vi.mock('~~/server/services/material/ocr.service', () => ({
    createImageConversionService: (...args: any[]) => mockCreateImageConversionService(...args),
}))

const mockConvertPdfService = vi.fn()
const mockGetDocRecognitionByOssFileIdService = vi.fn()
vi.mock('~~/server/services/material/mineru.service', () => ({
    convertPdfService: (...args: any[]) => mockConvertPdfService(...args),
    getDocRecognitionByOssFileIdService: (...args: any[]) => mockGetDocRecognitionByOssFileIdService(...args),
}))

const mockTranscribeAudioService = vi.fn()
vi.mock('~~/server/services/material/asr.service', () => ({
    transcribeAudioService: (...args: any[]) => mockTranscribeAudioService(...args),
}))

// Mock getMaterialTypeFromMime（控制文件类型判断）
vi.mock('#shared/types/case', async () => {
    const actual = await vi.importActual('#shared/types/case')
    return {
        ...actual,
        getMaterialTypeFromMime: vi.fn((mime: string) => {
            if (!mime) return CaseMaterialType.DOCUMENT
            if (mime.startsWith('image/')) return CaseMaterialType.IMAGE
            if (mime.startsWith('audio/')) return CaseMaterialType.AUDIO
            return CaseMaterialType.DOCUMENT
        }),
    }
})

// Mock materialPipeline.service（extractTextFromAsrResult）
vi.mock('~~/server/services/material/materialPipeline.service', () => ({
    extractTextFromAsrResult: (result: any) => {
        if (!result) return null
        if (result.sentences) return result.sentences.map((s: any) => s.text).join('\n')
        return null
    },
}))

import { processFileMaterials } from '~~/server/services/material/fileProcess.service'

describe('文件粒度识别服务', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('processFileMaterials', () => {
        it('成功处理已有识别记录的文档文件', async () => {
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([
                { id: 100, fileName: 'doc.pdf', fileType: 'application/pdf', filePath: '/path' },
            ])
            ;(prisma.docRecognitionRecords.findMany as any).mockResolvedValue([
                { ossFileId: 100, status: 2, markdownContent: '已识别内容' },
            ])
            ;(prisma.imageRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.asrRecords.findMany as any).mockResolvedValue([])

            const results = await processFileMaterials([100], 1)

            expect(results).toHaveLength(1)
            expect(results[0].recognitionStatus).toBe('success')
            expect(results[0].content).toBe('已识别内容')
        })

        it('成功处理已有识别记录的图片文件', async () => {
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([
                { id: 200, fileName: 'img.jpg', fileType: 'image/jpeg', filePath: '/path' },
            ])
            ;(prisma.docRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.imageRecognitionRecords.findMany as any).mockResolvedValue([
                { ossFileId: 200, status: 2, markdownContent: '图像OCR内容' },
            ])
            ;(prisma.asrRecords.findMany as any).mockResolvedValue([])

            const results = await processFileMaterials([200], 1)

            expect(results).toHaveLength(1)
            expect(results[0].recognitionStatus).toBe('success')
            expect(results[0].content).toBe('图像OCR内容')
        })

        it('成功处理已有识别记录的音频文件（summary 优先）', async () => {
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([
                { id: 300, fileName: 'audio.mp3', fileType: 'audio/mpeg', filePath: '/path' },
            ])
            ;(prisma.docRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.imageRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.asrRecords.findMany as any).mockResolvedValue([
                { ossFileId: 300, status: 2, summary: '音频摘要', result: null },
            ])

            const results = await processFileMaterials([300], 1)

            expect(results).toHaveLength(1)
            expect(results[0].recognitionStatus).toBe('success')
            expect(results[0].content).toBe('音频摘要')
        })

        it('文件不存在时返回 failed', async () => {
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([])
            ;(prisma.docRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.imageRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.asrRecords.findMany as any).mockResolvedValue([])

            const results = await processFileMaterials([999], 1)

            expect(results).toHaveLength(1)
            expect(results[0].recognitionStatus).toBe('failed')
            expect(results[0].error).toBe('文件不存在')
        })

        it('无已有记录时触发图片 OCR 识别', async () => {
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([
                { id: 200, fileName: 'new.jpg', fileType: 'image/jpeg', filePath: '/path' },
            ])
            ;(prisma.docRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.imageRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.asrRecords.findMany as any).mockResolvedValue([])
            mockCreateImageConversionService.mockResolvedValue({
                success: true,
                record: { markdownContent: 'OCR结果' },
            })

            const results = await processFileMaterials([200], 1)

            expect(results).toHaveLength(1)
            expect(results[0].recognitionStatus).toBe('success')
            expect(results[0].content).toBe('OCR结果')
        })

        it('图片 OCR 失败时返回 failed', async () => {
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([
                { id: 200, fileName: 'bad.jpg', fileType: 'image/jpeg', filePath: '/path' },
            ])
            ;(prisma.docRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.imageRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.asrRecords.findMany as any).mockResolvedValue([])
            mockCreateImageConversionService.mockResolvedValue({
                success: false,
                error: 'OCR 失败',
            })

            const results = await processFileMaterials([200], 1)

            expect(results).toHaveLength(1)
            expect(results[0].recognitionStatus).toBe('failed')
            expect(results[0].error).toContain('OCR 失败')
        })

        it('无已有记录时触发文档转换（已有 existing 结果）', async () => {
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([
                { id: 100, fileName: 'doc.pdf', fileType: 'application/pdf', filePath: '/path' },
            ])
            ;(prisma.docRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.imageRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.asrRecords.findMany as any).mockResolvedValue([])
            mockConvertPdfService.mockResolvedValue({
                success: true,
                task: { taskId: 'existing' },
            })
            mockGetDocRecognitionByOssFileIdService.mockResolvedValue({
                markdownContent: 'PDF内容',
            })

            const results = await processFileMaterials([100], 1)

            expect(results).toHaveLength(1)
            expect(results[0].recognitionStatus).toBe('success')
            expect(results[0].content).toBe('PDF内容')
        })

        it('批量处理多个文件', async () => {
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([
                { id: 100, fileName: 'doc.pdf', fileType: 'application/pdf', filePath: '/path' },
                { id: 200, fileName: 'img.jpg', fileType: 'image/jpeg', filePath: '/path' },
            ])
            ;(prisma.docRecognitionRecords.findMany as any).mockResolvedValue([
                { ossFileId: 100, status: 2, markdownContent: 'PDF内容' },
            ])
            ;(prisma.imageRecognitionRecords.findMany as any).mockResolvedValue([
                { ossFileId: 200, status: 2, markdownContent: '图片内容' },
            ])
            ;(prisma.asrRecords.findMany as any).mockResolvedValue([])

            const results = await processFileMaterials([100, 200], 1)

            expect(results).toHaveLength(2)
            expect(results.every(r => r.recognitionStatus === 'success')).toBe(true)
        })

        it('空文件列表返回空数组', async () => {
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([])
            ;(prisma.docRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.imageRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.asrRecords.findMany as any).mockResolvedValue([])

            const results = await processFileMaterials([], 1)

            expect(results).toHaveLength(0)
        })

        it('Promise.allSettled 异常时返回 failed', async () => {
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([
                { id: 100, fileName: 'doc.pdf', fileType: 'application/pdf', filePath: '/path' },
            ])
            ;(prisma.docRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.imageRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.asrRecords.findMany as any).mockResolvedValue([])
            mockConvertPdfService.mockRejectedValue(new Error('服务崩溃'))

            const results = await processFileMaterials([100], 1)

            expect(results).toHaveLength(1)
            expect(results[0].recognitionStatus).toBe('failed')
        })
    })
})
