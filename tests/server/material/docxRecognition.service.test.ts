/**
 * DOCX 文件识别服务测试
 *
 * **Feature: docx-recognition**
 * **Validates: docx 文件使用 mammoth 识别功能**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// 使用 vi.hoisted 创建所有需要用于 mock 的对象
const mocks = vi.hoisted(() => {
    return {
        // Mock mammoth 结果
        mammothResult: {
            value: '# Test Document\n\nThis is test content.',
            messages: []
        },
        // Mock 函数
        findOssFileByIdDao: vi.fn(),
        findOssFileByIdIncludeDeletedDao: vi.fn(),
        findDocRecognitionByOssFileIdDao: vi.fn(),
        createDocRecognitionRecordDao: vi.fn(),
        updateDocRecognitionRecordDao: vi.fn(),
        downloadFileService: vi.fn(),
        embedDocumentService: vi.fn(),
        // Logger mocks
        loggerInfo: vi.fn(),
        loggerError: vi.fn(),
        loggerWarn: vi.fn(),
    }
})

// Setup global mocks
vi.stubGlobal('logger', {
    info: mocks.loggerInfo,
    error: mocks.loggerError,
    warn: mocks.loggerWarn,
})

// Mock mammoth
vi.mock('mammoth', () => ({
    default: {
        convertToMarkdown: vi.fn().mockResolvedValue({
            value: '# Test Document\n\nThis is test content.',
            messages: []
        })
    }
}))

// Mock marked
vi.mock('marked', () => ({
    marked: {
        parse: vi.fn().mockResolvedValue('<h1>Test Document</h1><p>This is test content.</p>'),
        setOptions: vi.fn()
    }
}))

// Mock mineru.dao
vi.mock('../../../server/services/material/mineru.dao', () => ({
    createDocRecognitionRecordDao: mocks.createDocRecognitionRecordDao,
    findDocRecognitionByOssFileIdDao: mocks.findDocRecognitionByOssFileIdDao,
    updateDocRecognitionRecordDao: mocks.updateDocRecognitionRecordDao,
}))
vi.mock('~~/server/services/material/mineru.dao', () => ({
    createDocRecognitionRecordDao: mocks.createDocRecognitionRecordDao,
    findDocRecognitionByOssFileIdDao: mocks.findDocRecognitionByOssFileIdDao,
    updateDocRecognitionRecordDao: mocks.updateDocRecognitionRecordDao,
}))

// Mock storage.service
vi.mock('../../../server/services/storage/storage.service', () => ({
    downloadFileService: mocks.downloadFileService,
}))
vi.mock('~~/server/services/storage/storage.service', () => ({
    downloadFileService: mocks.downloadFileService,
}))

// Mock ossFiles.dao
vi.mock('../../../server/services/files/ossFiles.dao', () => ({
    findOssFileByIdDao: mocks.findOssFileByIdDao,
    findOssFileByIdIncludeDeletedDao: mocks.findOssFileByIdIncludeDeletedDao,
}))
vi.mock('~~/server/services/files/ossFiles.dao', () => ({
    findOssFileByIdDao: mocks.findOssFileByIdDao,
    findOssFileByIdIncludeDeletedDao: mocks.findOssFileByIdIncludeDeletedDao,
}))

// Mock materialEmbedding.service
vi.mock('../../../server/services/material/materialEmbedding.service', () => ({
    embedDocumentService: mocks.embedDocumentService,
}))
vi.mock('~~/server/services/material/materialEmbedding.service', () => ({
    embedDocumentService: mocks.embedDocumentService,
}))

// Mock caseMaterial.dao
vi.mock('../../../server/services/case/caseMaterial.dao', () => ({
    findMaterialsByOssFileIdDAO: vi.fn().mockResolvedValue([]),
    updateMaterialEmbeddingStatusDAO: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('~~/server/services/case/caseMaterial.dao', () => ({
    findMaterialsByOssFileIdDAO: vi.fn().mockResolvedValue([]),
    updateMaterialEmbeddingStatusDAO: vi.fn().mockResolvedValue(undefined),
}))

describe('DOCX 文件识别服务', () => {
    let recognizeDocxService: any

    beforeEach(async () => {
        vi.clearAllMocks()

        // 重新导入服务以确保使用 mock
        const module = await import('../../../server/services/material/docxRecognition.service')
        recognizeDocxService = module.recognizeDocxService
    })

    describe('基本功能测试', () => {
        it('应该返回文件不存在错误当 OSS 文件不存在时', async () => {
            mocks.findOssFileByIdDao.mockResolvedValue(null)

            const result = await recognizeDocxService(1, 1)

            expect(result.success).toBe(false)
            expect(result.error).toBe('文件不存在')
        })

        it('应该返回文件路径不存在错误当文件路径为空时', async () => {
            mocks.findOssFileByIdDao.mockResolvedValue({
                id: 1,
                fileName: 'test.docx',
                filePath: null
            })

            const result = await recognizeDocxService(1, 1)

            expect(result.success).toBe(false)
            expect(result.error).toBe('文件路径不存在')
        })
    })

    describe('已有识别记录测试', () => {
        it('应该直接返回已有成功记录当存在时', async () => {
            const existingRecord = {
                id: 1,
                ossFileId: 1,
                status: 2, // SUCCESS
                markdownContent: '# Existing',
                htmlContent: '<h1>Existing</h1>'
            }

            mocks.findOssFileByIdDao.mockResolvedValue({
                id: 1,
                fileName: 'test.docx',
                filePath: 'uploads/test.docx'
            })
            mocks.findDocRecognitionByOssFileIdDao.mockResolvedValue(existingRecord)

            const result = await recognizeDocxService(1, 1)

            expect(result.success).toBe(true)
            expect(result.record).toEqual(existingRecord)
            expect(mocks.downloadFileService).not.toHaveBeenCalled()
        })
    })

    describe('正常识别测试', () => {
        it('应该成功识别 DOCX 文件内容', async () => {
            const ossFile = {
                id: 1,
                fileName: 'test.docx',
                filePath: 'uploads/test.docx'
            }

            mocks.findOssFileByIdDao.mockResolvedValue(ossFile)
            mocks.findDocRecognitionByOssFileIdDao.mockResolvedValue(null)
            mocks.downloadFileService.mockResolvedValue(Buffer.from('mock docx data'))
            mocks.createDocRecognitionRecordDao.mockResolvedValue({
                id: 1,
                ossFileId: 1,
                status: 2,
                markdownContent: '# Test Document\n\nThis is test content.',
                htmlContent: '<h1>Test Document</h1><p>This is test content.</p>'
            })
            mocks.findOssFileByIdIncludeDeletedDao.mockResolvedValue(ossFile)
            mocks.embedDocumentService.mockResolvedValue({
                ids: ['vec1', 'vec2'],
                chunkCount: 2,
                lastEmbeddingAt: new Date()
            })

            const result = await recognizeDocxService(1, 1)

            expect(result.success).toBe(true)
            expect(mocks.downloadFileService).toHaveBeenCalledWith('uploads/test.docx')
            expect(mocks.createDocRecognitionRecordDao).toHaveBeenCalled()
        })
    })

    describe('错误处理测试', () => {
        it('应该正确处理 OSS 下载失败', async () => {
            const ossFile = {
                id: 1,
                fileName: 'test.docx',
                filePath: 'uploads/test.docx'
            }

            mocks.findOssFileByIdDao.mockResolvedValue(ossFile)
            mocks.findDocRecognitionByOssFileIdDao.mockResolvedValue(null)
            mocks.downloadFileService.mockRejectedValue(new Error('Network error'))

            const result = await recognizeDocxService(1, 1)

            expect(result.success).toBe(false)
            expect(result.error).toBe('Network error')
        })
    })
})
