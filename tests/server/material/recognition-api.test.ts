/**
 * 统一识别入口 API 测试
 *
 * **Feature: unified-recognition-api**
 * **Validates: 统一识别入口 API 功能**
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { CaseMaterialType } from '../../../shared/types/case'

// 使用 vi.hoisted 创建所有需要用于 mock 的对象
const mocks = vi.hoisted(() => {
    return {
        // 工具函数
        detectFileTypeService: vi.fn(),
        // 识别服务
        createImageRecognitionService: vi.fn(),
        transcribeAudioService: vi.fn(),
        convertPdfService: vi.fn(),
        // Prisma
        prisma: {
            ossFiles: {
                findMany: vi.fn(),
            },
        },
        // Logger mocks
        loggerInfo: vi.fn(),
        loggerError: vi.fn(),
    }
})

// Mock 用户
const mockUser = {
    id: 1,
    username: 'testuser',
}

// Setup global mocks
vi.stubGlobal('defineEventHandler', (handler: any) => handler)
vi.stubGlobal('readBody', vi.fn())
vi.stubGlobal('resError', (event: any, code: number, msg: string) => ({ code, message: msg, success: false }))
vi.stubGlobal('resSuccess', (event: any, msg: string, data: any) => ({ code: 0, message: msg, data, success: true }))
vi.stubGlobal('logger', {
    info: mocks.loggerInfo,
    error: mocks.loggerError,
})
// Stub global prisma because the handler uses auto-imported prisma
vi.stubGlobal('prisma', mocks.prisma)
// Stub global createImageRecognitionService (auto-imported in server)
vi.stubGlobal('createImageRecognitionService', mocks.createImageRecognitionService)

// Mock fileDetect.service.ts
vi.mock('../../../server/services/material/fileDetect.service', () => ({
    detectFileTypeService: mocks.detectFileTypeService,
}))
vi.mock('~~/server/services/material/fileDetect.service', () => ({
    detectFileTypeService: mocks.detectFileTypeService,
}))

// Mock ocr.service.ts
vi.mock('../../../server/services/material/ocr.service', () => ({
    createImageRecognitionService: mocks.createImageRecognitionService,
}))
vi.mock('~~/server/services/material/ocr.service', () => ({
    createImageRecognitionService: mocks.createImageRecognitionService,
}))

// Mock asr.service.ts
vi.mock('../../../server/services/material/asr.service', () => ({
    transcribeAudioService: mocks.transcribeAudioService,
}))
vi.mock('~~/server/services/material/asr.service', () => ({
    transcribeAudioService: mocks.transcribeAudioService,
}))

// Mock mineru.service.ts
vi.mock('../../../server/services/material/mineru.service', () => ({
    convertPdfService: mocks.convertPdfService,
}))
vi.mock('~~/server/services/material/mineru.service', () => ({
    convertPdfService: mocks.convertPdfService,
}))

describe('统一识别入口 API', () => {
    let startHandler: any
    let event: any

    beforeAll(async () => {
        // Import the handler
        const handlerModule = await import('../../../server/api/v1/recognition/start.post')
        startHandler = handlerModule.default
    })

    beforeEach(() => {
        vi.clearAllMocks()
        event = {
            context: {
                auth: {
                    user: mockUser
                }
            }
        }
    })

    describe('未登录场景', () => {
        it('应该在未登录时返回 401', async () => {
            // Arrange
            event.context.auth = undefined

            // Act
            const result = await startHandler(event)

            // Assert
            expect(result.code).toBe(401)
            expect(result.message).toBe('请先登录')
        })
    })

    describe('参数验证', () => {
        it('应该在 ossFileIds 为空数组时返回 400', async () => {
            // Arrange
            const mockReadBody = vi.fn().mockResolvedValue({ ossFileIds: [] })
            vi.stubGlobal('readBody', mockReadBody)

            // Act
            const result = await startHandler(event)

            // Assert
            expect(result.code).toBe(400)
        })

        it('应该在 ossFileIds 缺失时返回 400', async () => {
            // Arrange
            vi.mocked(vi.fn()).mockResolvedValue({})

            // Act
            const result = await startHandler(event)

            // Assert
            expect(result.code).toBe(400)
        })
    })

    describe('文件不存在场景', () => {
        it('应该在文件不存在时返回失败结果', async () => {
            // Arrange
            const mockReadBody = vi.fn().mockResolvedValue({ ossFileIds: [999] })
            vi.stubGlobal('readBody', mockReadBody)

            mocks.prisma.ossFiles.findMany.mockResolvedValue([])

            // Act
            const result = await startHandler(event)

            // Assert
            expect(result.success).toBe(true)
            expect(result.data.results).toHaveLength(1)
            expect(result.data.results[0]).toEqual({
                ossFileId: 999,
                status: 'failed',
                error: '文件不存在'
            })
        })
    })

    describe('文件类型处理', () => {
        it('应该正确处理图片类型文件', async () => {
            // Arrange
            const mockReadBody = vi.fn().mockResolvedValue({ ossFileIds: [123] })
            vi.stubGlobal('readBody', mockReadBody)

            mocks.prisma.ossFiles.findMany.mockResolvedValue([{
                id: 123,
                userId: 1,
                fileName: 'test.jpg',
                filePath: 'test.jpg',
            }])

            mocks.detectFileTypeService.mockReturnValue(CaseMaterialType.IMAGE)
            mocks.createImageRecognitionService.mockResolvedValue({
                success: true,
                record: { id: 1 }
            })

            // Act
            const result = await startHandler(event)

            // Assert
            expect(result.success).toBe(true)
            expect(result.data.results[0].status).toBe('processing')
            expect(mocks.createImageRecognitionService).toHaveBeenCalledWith(123, 1)
        })

        it('应该正确处理音频类型文件', async () => {
            // Arrange
            const mockReadBody = vi.fn().mockResolvedValue({ ossFileIds: [124] })
            vi.stubGlobal('readBody', mockReadBody)

            mocks.prisma.ossFiles.findMany.mockResolvedValue([{
                id: 124,
                userId: 1,
                fileName: 'test.mp3',
                filePath: 'test.mp3',
            }])

            mocks.detectFileTypeService.mockReturnValue(CaseMaterialType.AUDIO)
            mocks.transcribeAudioService.mockResolvedValue({
                success: true,
                record: { id: 2 }
            })

            // Act
            const result = await startHandler(event)

            // Assert
            expect(result.success).toBe(true)
            expect(result.data.results[0].status).toBe('processing')
            expect(mocks.transcribeAudioService).toHaveBeenCalledWith(124, 1)
        })

        it('应该正确处理文档类型文件（PDF）', async () => {
            // Arrange
            const mockReadBody = vi.fn().mockResolvedValue({ ossFileIds: [125] })
            vi.stubGlobal('readBody', mockReadBody)

            mocks.prisma.ossFiles.findMany.mockResolvedValue([{
                id: 125,
                userId: 1,
                fileName: 'test.pdf',
                filePath: 'test.pdf',
            }])

            mocks.detectFileTypeService.mockReturnValue(CaseMaterialType.DOCUMENT)
            mocks.convertPdfService.mockResolvedValue({
                success: true,
                record: { id: 3 }
            })

            // Act
            const result = await startHandler(event)

            // Assert
            expect(result.success).toBe(true)
            expect(result.data.results[0].status).toBe('processing')
            expect(mocks.convertPdfService).toHaveBeenCalledWith(125, 1)
        })
    })

    describe('识别失败场景', () => {
        it('应该在识别失败时返回失败状态', async () => {
            // Arrange
            const mockReadBody = vi.fn().mockResolvedValue({ ossFileIds: [126] })
            vi.stubGlobal('readBody', mockReadBody)

            mocks.prisma.ossFiles.findMany.mockResolvedValue([{
                id: 126,
                userId: 1,
                fileName: 'test.jpg',
                filePath: 'test.jpg',
            }])

            mocks.detectFileTypeService.mockReturnValue(CaseMaterialType.IMAGE)
            mocks.createImageRecognitionService.mockResolvedValue({
                success: false,
                error: 'OCR 识别失败'
            })

            // Act
            const result = await startHandler(event)

            // Assert
            expect(result.success).toBe(true)
            expect(result.data.results[0].status).toBe('failed')
            expect(result.data.results[0].error).toBe('OCR 识别失败')
        })
    })
})
