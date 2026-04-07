import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock 所有外部依赖，对齐项目 vi.hoisted() 模式
const mocks = vi.hoisted(() => ({
    createImageConversionService: vi.fn(),
    convertPdfService: vi.fn(),
    getDocRecognitionByOssFileIdService: vi.fn(),
    transcribeAudioService: vi.fn(),
    extractTextFromAsrResult: vi.fn((r: any) => r?.text ?? ''),
}))

vi.mock('../../../../server/services/material/ocr.service', () => ({
    createImageConversionService: mocks.createImageConversionService,
}))
vi.mock('~~/server/services/material/ocr.service', () => ({
    createImageConversionService: mocks.createImageConversionService,
}))

vi.mock('../../../../server/services/material/mineru.service', () => ({
    convertPdfService: mocks.convertPdfService,
    getDocRecognitionByOssFileIdService: mocks.getDocRecognitionByOssFileIdService,
}))
vi.mock('~~/server/services/material/mineru.service', () => ({
    convertPdfService: mocks.convertPdfService,
    getDocRecognitionByOssFileIdService: mocks.getDocRecognitionByOssFileIdService,
}))

vi.mock('../../../../server/services/material/asr.service', () => ({
    transcribeAudioService: mocks.transcribeAudioService,
}))
vi.mock('~~/server/services/material/asr.service', () => ({
    transcribeAudioService: mocks.transcribeAudioService,
}))

vi.mock('../../../../server/services/material/materialPipeline.service', () => ({
    extractTextFromAsrResult: mocks.extractTextFromAsrResult,
}))
vi.mock('~~/server/services/material/materialPipeline.service', () => ({
    extractTextFromAsrResult: mocks.extractTextFromAsrResult,
}))

// prisma 和 logger 是自动导入的全局变量，必须用 vi.stubGlobal 来 mock
const mockPrisma = {
    ossFiles: { findMany: vi.fn() },
    docRecognitionRecords: { findMany: vi.fn() },
    imageRecognitionRecords: { findMany: vi.fn() },
    asrRecords: { findMany: vi.fn(), findFirst: vi.fn() },
}
const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

import { processFileMaterials } from '../../../../server/services/material/fileProcess.service'

describe('processFileMaterials', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // 每次测试前重新 stub 全局变量
        vi.stubGlobal('prisma', mockPrisma)
        vi.stubGlobal('logger', mockLogger)
    })

    it('应返回 FileProcessContext 数组', async () => {
        mockPrisma.ossFiles.findMany.mockResolvedValue([
            { id: 1, fileName: 'test.pdf', fileType: 'application/pdf', filePath: '/path', deletedAt: null },
        ])
        mockPrisma.docRecognitionRecords.findMany.mockResolvedValue([])
        mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([])
        mockPrisma.asrRecords.findMany.mockResolvedValue([])
        mocks.convertPdfService.mockResolvedValue({ success: false, error: '识别失败' })

        const result = await processFileMaterials([1], 1)
        expect(Array.isArray(result)).toBe(true)
        expect(result[0]).toHaveProperty('ossFileId')
        expect(result[0]).toHaveProperty('recognitionStatus')
    })

    it('文件不存在时应返回 failed 状态', async () => {
        mockPrisma.ossFiles.findMany.mockResolvedValue([])
        mockPrisma.docRecognitionRecords.findMany.mockResolvedValue([])
        mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([])
        mockPrisma.asrRecords.findMany.mockResolvedValue([])

        const result = await processFileMaterials([999], 1)
        expect(result[0].recognitionStatus).toBe('failed')
        expect(result[0].error).toBe('文件不存在')
    })

    it('已有识别记录时应直接返回内容', async () => {
        mockPrisma.ossFiles.findMany.mockResolvedValue([
            { id: 1, fileName: 'test.pdf', fileType: 'application/pdf', filePath: '/path', deletedAt: null },
        ])
        mockPrisma.docRecognitionRecords.findMany.mockResolvedValue([
            { ossFileId: 1, status: 2, markdownContent: '已识别的内容', deletedAt: null },
        ])
        mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([])
        mockPrisma.asrRecords.findMany.mockResolvedValue([])

        const result = await processFileMaterials([1], 1)
        expect(result[0].recognitionStatus).toBe('success')
        expect(result[0].content).toBe('已识别的内容')
    })

    it('图片文件已有识别记录时应直接返回内容', async () => {
        mockPrisma.ossFiles.findMany.mockResolvedValue([
            { id: 2, fileName: 'test.jpg', fileType: 'image/jpeg', filePath: '/path', deletedAt: null },
        ])
        mockPrisma.docRecognitionRecords.findMany.mockResolvedValue([])
        mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([
            { ossFileId: 2, status: 2, markdownContent: '图片识别内容', deletedAt: null },
        ])
        mockPrisma.asrRecords.findMany.mockResolvedValue([])

        const result = await processFileMaterials([2], 1)
        expect(result[0].recognitionStatus).toBe('success')
        expect(result[0].content).toBe('图片识别内容')
    })

    it('音频文件已有识别记录时应直接返回内容', async () => {
        mocks.extractTextFromAsrResult.mockReturnValue('音频转写内容')
        mockPrisma.ossFiles.findMany.mockResolvedValue([
            { id: 3, fileName: 'test.mp3', fileType: 'audio/mpeg', filePath: '/path', deletedAt: null },
        ])
        mockPrisma.docRecognitionRecords.findMany.mockResolvedValue([])
        mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([])
        mockPrisma.asrRecords.findMany.mockResolvedValue([
            { ossFileId: 3, status: 2, summary: '音频摘要', result: { text: '音频转写内容' }, deletedAt: null },
        ])

        const result = await processFileMaterials([3], 1)
        expect(result[0].recognitionStatus).toBe('success')
        // summary 优先
        expect(result[0].content).toBe('音频摘要')
    })

    it('图片识别成功时应返回识别内容', async () => {
        mockPrisma.ossFiles.findMany.mockResolvedValue([
            { id: 4, fileName: 'photo.png', fileType: 'image/png', filePath: '/path', deletedAt: null },
        ])
        mockPrisma.docRecognitionRecords.findMany.mockResolvedValue([])
        mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([])
        mockPrisma.asrRecords.findMany.mockResolvedValue([])
        mocks.createImageConversionService.mockResolvedValue({
            success: true,
            record: { markdownContent: 'OCR识别内容' },
        })

        const result = await processFileMaterials([4], 1)
        expect(result[0].recognitionStatus).toBe('success')
        expect(result[0].content).toBe('OCR识别内容')
    })

    it('图片识别失败时应返回 failed 状态', async () => {
        mockPrisma.ossFiles.findMany.mockResolvedValue([
            { id: 5, fileName: 'photo.png', fileType: 'image/png', filePath: '/path', deletedAt: null },
        ])
        mockPrisma.docRecognitionRecords.findMany.mockResolvedValue([])
        mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([])
        mockPrisma.asrRecords.findMany.mockResolvedValue([])
        mocks.createImageConversionService.mockResolvedValue({
            success: false,
            error: 'OCR服务不可用',
        })

        const result = await processFileMaterials([5], 1)
        expect(result[0].recognitionStatus).toBe('failed')
        expect(result[0].error).toBe('OCR服务不可用')
    })

    it('多文件混合处理应正确返回各自结果', async () => {
        mockPrisma.ossFiles.findMany.mockResolvedValue([
            { id: 10, fileName: 'doc.pdf', fileType: 'application/pdf', filePath: '/path', deletedAt: null },
            { id: 11, fileName: 'img.jpg', fileType: 'image/jpeg', filePath: '/path', deletedAt: null },
        ])
        mockPrisma.docRecognitionRecords.findMany.mockResolvedValue([
            { ossFileId: 10, status: 2, markdownContent: 'PDF已识别', deletedAt: null },
        ])
        mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([])
        mockPrisma.asrRecords.findMany.mockResolvedValue([])
        mocks.createImageConversionService.mockResolvedValue({
            success: true,
            record: { markdownContent: '图片识别' },
        })

        const result = await processFileMaterials([10, 11], 1)
        expect(result).toHaveLength(2)
        expect(result[0].ossFileId).toBe(10)
        expect(result[0].recognitionStatus).toBe('success')
        expect(result[0].content).toBe('PDF已识别')
        expect(result[1].ossFileId).toBe(11)
        expect(result[1].recognitionStatus).toBe('success')
        expect(result[1].content).toBe('图片识别')
    })
})
