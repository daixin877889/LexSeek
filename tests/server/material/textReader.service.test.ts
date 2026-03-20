/**
 * 文本文件读取服务测试
 *
 * **Feature: text-file-reading**
 * **Validates: md/txt 文件直接读取功能**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// 使用 vi.hoisted 创建所有需要用于 mock 的对象
const mocks = vi.hoisted(() => {
    return {
        // 模拟的文本内容
        mockMarkdownContent: '# Test\n\nThis is a test content.',
        mockHtmlContent: '<!DOCTYPE html>\n<html>\n<head>\n    <meta charset="UTF-8">\n    <title>test.md</title>\n</head>\n<body>\n<h1>Test</h1>\n<p>This is a test content.</p>\n</body>\n</html>',
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

describe('文本文件读取服务', () => {
    let readTextFileService: any

    beforeEach(async () => {
        vi.clearAllMocks()

        // 重新导入服务以确保使用 mock
        const module = await import('../../../server/services/material/textReader.service')
        readTextFileService = module.readTextFileService
    })

    describe('基本功能测试', () => {
        it('应该返回文件不存在错误当 OSS 文件不存在时', async () => {
            mocks.findOssFileByIdDao.mockResolvedValue(null)

            const result = await readTextFileService(1, 1)

            expect(result.success).toBe(false)
            expect(result.error).toBe('文件不存在')
        })

        it('应该返回文件路径不存在错误当文件路径为空时', async () => {
            mocks.findOssFileByIdDao.mockResolvedValue({
                id: 1,
                fileName: 'test.md',
                filePath: null
            })

            const result = await readTextFileService(1, 1)

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
                fileName: 'test.md',
                filePath: 'uploads/test.md'
            })
            mocks.findDocRecognitionByOssFileIdDao.mockResolvedValue(existingRecord)

            const result = await readTextFileService(1, 1)

            expect(result.success).toBe(true)
            expect(result.record).toEqual(existingRecord)
            expect(mocks.downloadFileService).not.toHaveBeenCalled()
        })
    })

    describe('正常读取测试', () => {
        it('应该成功读取 Markdown 文件内容', async () => {
            const ossFile = {
                id: 1,
                fileName: 'test.md',
                filePath: 'uploads/test.md'
            }

            mocks.findOssFileByIdDao.mockResolvedValue(ossFile)
            mocks.findDocRecognitionByOssFileIdDao.mockResolvedValue(null)
            mocks.downloadFileService.mockResolvedValue(Buffer.from('# Test Content\n\nHello World'))
            mocks.createDocRecognitionRecordDao.mockResolvedValue({
                id: 1,
                ossFileId: 1,
                status: 2,
                markdownContent: '# Test Content\n\nHello World',
                htmlContent: '<h1>Test Content</h1><p>Hello World</p>'
            })
            mocks.findOssFileByIdIncludeDeletedDao.mockResolvedValue(ossFile)
            mocks.embedDocumentService.mockResolvedValue({
                ids: ['vec1', 'vec2'],
                chunkCount: 2,
                lastEmbeddingAt: new Date()
            })

            const result = await readTextFileService(1, 1)

            expect(result.success).toBe(true)
            expect(mocks.downloadFileService).toHaveBeenCalledWith('uploads/test.md')
            expect(mocks.createDocRecognitionRecordDao).toHaveBeenCalled()
        })

        it('应该成功读取 TXT 文件内容', async () => {
            const ossFile = {
                id: 2,
                fileName: 'notes.txt',
                filePath: 'uploads/notes.txt'
            }

            mocks.findOssFileByIdDao.mockResolvedValue(ossFile)
            mocks.findDocRecognitionByOssFileIdDao.mockResolvedValue(null)
            mocks.downloadFileService.mockResolvedValue(Buffer.from('Plain text content'))
            mocks.createDocRecognitionRecordDao.mockResolvedValue({
                id: 2,
                ossFileId: 2,
                status: 2,
                markdownContent: '# notes.txt\n\nPlain text content',
                htmlContent: '<h1>notes.txt</h1><p>Plain text content</p>'
            })
            mocks.findOssFileByIdIncludeDeletedDao.mockResolvedValue(ossFile)
            mocks.embedDocumentService.mockResolvedValue({
                ids: ['vec1'],
                chunkCount: 1,
                lastEmbeddingAt: new Date()
            })

            const result = await readTextFileService(2, 1)

            expect(result.success).toBe(true)
            expect(mocks.downloadFileService).toHaveBeenCalledWith('uploads/notes.txt')
            // TXT 文件内容应该被包装为 Markdown 格式
            expect(mocks.createDocRecognitionRecordDao).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 1,
                    ossFileId: 2,
                    status: 2
                })
            )
        })
    })

    describe('错误处理测试', () => {
        it('应该正确处理 OSS 下载失败', async () => {
            const ossFile = {
                id: 1,
                fileName: 'test.md',
                filePath: 'uploads/test.md'
            }

            mocks.findOssFileByIdDao.mockResolvedValue(ossFile)
            mocks.findDocRecognitionByOssFileIdDao.mockResolvedValue(null)
            mocks.downloadFileService.mockRejectedValue(new Error('Network error'))

            const result = await readTextFileService(1, 1)

            expect(result.success).toBe(false)
            expect(result.error).toBe('Network error')
        })

        it('应该正确处理嵌入失败但仍返回成功', async () => {
            const ossFile = {
                id: 1,
                fileName: 'test.md',
                filePath: 'uploads/test.md'
            }

            mocks.findOssFileByIdDao.mockResolvedValue(ossFile)
            mocks.findDocRecognitionByOssFileIdDao.mockResolvedValue(null)
            mocks.downloadFileService.mockResolvedValue(Buffer.from('# Test'))
            mocks.createDocRecognitionRecordDao.mockResolvedValue({
                id: 1,
                ossFileId: 1,
                status: 2
            })
            mocks.findOssFileByIdIncludeDeletedDao.mockResolvedValue(ossFile)
            mocks.embedDocumentService.mockRejectedValue(new Error('Embedding failed'))

            const result = await readTextFileService(1, 1)

            // 嵌入失败不影响主流程
            expect(result.success).toBe(true)
        })
    })
})
