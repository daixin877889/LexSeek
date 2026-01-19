/**
 * 图片识别服务属性测试
 *
 * 使用 fast-check 进行基于属性的测试
 *
 * **Feature: 案件分析系统**
 * **Validates: Requirements 10.1, 10.2, 10.4, 10.5, 10.6, 10.7, 10.9**
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'
import { ImageRecognitionStatus } from '../../../../shared/types/recognition'

// Mock dependencies
const TEST_USER_ID = 1

// Define mocks using vi.hoisted to avoid reference errors
const mocks = vi.hoisted(() => ({
    createChatModel: vi.fn(),
    embedImageService: vi.fn(),
    getNodeConfigService: vi.fn(),
    generateSignedUrlService: vi.fn(),
    prisma: {
        ossFiles: {
            create: vi.fn(),
            findFirst: vi.fn(),
            deleteMany: vi.fn(),
        },
        imageRecognitionRecords: {
            create: vi.fn(),
            findMany: vi.fn(),
            findUnique: vi.fn(),
            update: vi.fn(),
            deleteMany: vi.fn(),
        },
        $queryRaw: vi.fn(),
        $disconnect: vi.fn(),
    }
}))

// Setup global mocks
vi.stubGlobal('logger', {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
})

// Mock services using relative paths
vi.mock('../../../../server/services/node/chatModelFactory', () => ({
    createChatModel: mocks.createChatModel,
}))

vi.mock('../../../../server/services/material/materialEmbedding.service', () => ({
    embedImageService: mocks.embedImageService,
}))

vi.mock('../../../../server/services/node/node.service', () => ({
    getNodeConfigService: mocks.getNodeConfigService,
}))

vi.mock('../../../../server/services/storage/storage.service', () => ({
    generateSignedUrlService: mocks.generateSignedUrlService,
}))

// Mock Prisma
vi.mock('../../../../server/utils/db', () => ({
    prisma: mocks.prisma,
}))

// Import service after mocking
import { createImageRecognitionByBase64Service } from '../../../../server/services/material/ocr.service'
import { prisma } from '../../../../server/utils/db'

// 有效的 20x20 像素 PNG 图片 base64 (满足最小尺寸要求 > 14px)
const VALID_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAAXNSR0IArs4c6QAAAEFJREFUOE9jZKAyYKSyeQyjYfQwjIbxwWEYDZfRwzAlGEbD6GEYDaOHYTQMHobRMHoYRsPoYRgNg4dhNAwehtEwQAQA76YB9WjQ/YoAAAAASUVORK5CYII='

// 支持的图片类型
const SUPPORTED_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
]

// 不支持的图片类型
const UNSUPPORTED_MIME_TYPES = [
    'image/bmp',
    'image/tiff',
    'image/svg+xml',
    'application/pdf',
    'text/plain',
]

describe('图片识别服务属性测试', () => {
    beforeAll(async () => {
        // Setup default mock behaviors
        mocks.createChatModel.mockReturnValue({
            withStructuredOutput: vi.fn(() => ({
                invoke: vi.fn(async () => ({
                    imgType: 'doc',
                    imageInfo: '# Mocked Content\n\nThis is mocked OCR content.',
                })),
            })),
        })

        mocks.embedImageService.mockResolvedValue({
            ids: ['vec_1', 'vec_2'],
            chunkCount: 2,
            lastEmbeddingAt: new Date(),
        })

        mocks.getNodeConfigService.mockResolvedValue({
            name: 'extractImageInfo',
            modelName: 'gpt-4o',
            modelSdkType: 'openai',
            modelProviderBaseUrl: 'https://api.openai.com/v1',
            modelApiKeys: [{ apiKey: 'sk-mock-key' }],
            prompts: [{ type: 'system', content: 'You are an OCR assistant.' }],
        })

        mocks.generateSignedUrlService.mockResolvedValue('https://mock-storage.com/signed-url')

        // Mock prisma $queryRaw for db check
        mocks.prisma.$queryRaw.mockResolvedValue([1])
    })

    beforeEach(() => {
        vi.clearAllMocks()
        // Reset default mocks if needed, but they are static for property tests
    })

    describe('10.3.1 属性 1：识别成功时创建完整记录', () => {
        it('Property 1: 识别成功时创建完整记录', async () => {
            // 使用 fast-check 生成随机测试数据
            await fc.assert(
                fc.asyncProperty(
                    fc.constantFrom(...SUPPORTED_MIME_TYPES), // 随机选择支持的 MIME 类型
                    fc.string({ minLength: 5, maxLength: 50 }), // 随机文件名
                    async (mimeType, fileName) => {
                        // Reset mocks for this run
                        mocks.prisma.ossFiles.findFirst.mockReset()
                        mocks.prisma.imageRecognitionRecords.findMany.mockReset()
                        mocks.prisma.imageRecognitionRecords.create.mockReset()
                        mocks.prisma.imageRecognitionRecords.update.mockReset()

                        const mockOssFileId = Math.floor(Math.random() * 1000) + 1

                        // Mock finding OSS file
                        mocks.prisma.ossFiles.findFirst.mockResolvedValue({
                            id: mockOssFileId,
                            userId: TEST_USER_ID,
                            bucketName: 'test-bucket',
                            fileName: `${fileName}.${mimeType.split('/')[1]}`,
                            filePath: `test/ocr/${Date.now()}/${fileName}`,
                            fileType: mimeType,
                            fileSize: 1024,
                            status: 1,
                        })

                        // Mock finding existing record (none)
                        mocks.prisma.imageRecognitionRecords.findMany.mockResolvedValue([])

                        // Mock create record
                        const mockRecordId = Math.floor(Math.random() * 1000) + 1
                        mocks.prisma.imageRecognitionRecords.create.mockResolvedValue({
                            id: mockRecordId,
                            ossFileId: mockOssFileId,
                            userId: TEST_USER_ID,
                            status: ImageRecognitionStatus.COMPLETED,
                            imageType: 'doc',
                            markdownContent: '# Mocked Content\n\nThis is mocked OCR content.',
                            htmlContent: '<h1>Mocked Content</h1><p>This is mocked OCR content.</p>',
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        })

                        // Act: 调用业务方法进行识别
                        const result = await createImageRecognitionByBase64Service(
                            VALID_IMAGE_BASE64,
                            mimeType,
                            mockOssFileId,
                            TEST_USER_ID
                        )

                        // Assert: 验证识别成功
                        expect(result.success).toBe(true)
                        expect(result.record).toBeDefined()
                        expect(result.record.id).toBe(mockRecordId)
                        expect(result.record.status).toBe(ImageRecognitionStatus.COMPLETED)
                        expect(result.record.markdownContent).toBeDefined()
                        expect(result.record.htmlContent).toBeDefined()
                        expect(result.error).toBeUndefined()
                    }
                ),
                {
                    numRuns: 20,
                    verbose: true,
                }
            )
        })
    })

    describe('10.3.2 属性 2：识别失败时不创建记录', () => {
        it('Property 2: 识别失败时不创建记录', async () => {
            // 使用 fast-check 生成随机的无效数据
            await fc.assert(
                fc.asyncProperty(
                    fc.constantFrom(...UNSUPPORTED_MIME_TYPES), // 随机选择不支持的 MIME 类型
                    fc.string({ minLength: 5, maxLength: 50 }), // 随机文件名
                    async (mimeType, fileName) => {
                         // Reset mocks
                        mocks.prisma.ossFiles.findFirst.mockReset()
                        mocks.prisma.imageRecognitionRecords.findMany.mockReset()

                        const mockOssFileId = Math.floor(Math.random() * 1000) + 1

                        // Mock finding OSS file
                        mocks.prisma.ossFiles.findFirst.mockResolvedValue({
                            id: mockOssFileId,
                            userId: TEST_USER_ID,
                            fileType: mimeType,
                        })

                        // Act: 调用业务方法进行识别
                        const result = await createImageRecognitionByBase64Service(
                            VALID_IMAGE_BASE64,
                            mimeType,
                            mockOssFileId,
                            TEST_USER_ID
                        )

                        // Assert: 验证识别失败且不创建记录
                        expect(result.success).toBe(false)
                        expect(result.error).toBeDefined()
                        expect(result.error).toContain('不支持识别')
                        expect(result.record).toBeNull()

                        // Verify create was not called
                        expect(mocks.prisma.imageRecognitionRecords.create).not.toHaveBeenCalled()
                    }
                ),
                {
                    numRuns: 20,
                    verbose: true,
                }
            )
        })
    })

    describe('10.3.3 属性 3：重复识别的幂等性', () => {
        it('Property 3: 重复识别的幂等性', async () => {
            // 使用 fast-check 生成随机图片数据
            await fc.assert(
                fc.asyncProperty(
                    fc.constantFrom(...SUPPORTED_MIME_TYPES), // 随机选择支持的 MIME 类型
                    fc.string({ minLength: 5, maxLength: 50 }), // 随机文件名
                    fc.integer({ min: 2, max: 3 }), // 随机重复次数
                    async (mimeType, fileName, repeatCount) => {
                        // Reset mocks
                        mocks.prisma.ossFiles.findFirst.mockReset()
                        mocks.prisma.imageRecognitionRecords.findMany.mockReset()
                        mocks.prisma.imageRecognitionRecords.create.mockReset()

                        const mockOssFileId = Math.floor(Math.random() * 1000) + 1
                        const mockRecordId = Math.floor(Math.random() * 1000) + 1

                        // Mock OSS file found
                        mocks.prisma.ossFiles.findFirst.mockResolvedValue({
                            id: mockOssFileId,
                            userId: TEST_USER_ID,
                            fileType: mimeType,
                            fileName: fileName
                        })

                        // First call: record doesn't exist
                        mocks.prisma.imageRecognitionRecords.findMany.mockResolvedValueOnce([])

                        // Mock create
                        const mockRecord = {
                            id: mockRecordId,
                            ossFileId: mockOssFileId,
                            userId: TEST_USER_ID,
                            status: ImageRecognitionStatus.COMPLETED,
                            imageType: 'doc',
                            markdownContent: 'content',
                            htmlContent: 'content'
                        }
                        mocks.prisma.imageRecognitionRecords.create.mockResolvedValue(mockRecord)

                        // Act: First call
                        const result1 = await createImageRecognitionByBase64Service(
                            VALID_IMAGE_BASE64,
                            mimeType,
                            mockOssFileId,
                            TEST_USER_ID
                        )

                        // Assert first call
                        expect(result1.success).toBe(true)
                        expect(result1.record.id).toBe(mockRecordId)

                        // Second call: record exists
                        mocks.prisma.ossFiles.findFirst.mockResolvedValue({
                            id: mockOssFileId,
                            userId: TEST_USER_ID,
                            fileType: mimeType,
                            fileName: fileName
                        })
                        // Mock findMany to return existing record
                        mocks.prisma.imageRecognitionRecords.findMany.mockResolvedValue([mockRecord])

                        // Act: Second call
                        const result2 = await createImageRecognitionByBase64Service(
                            VALID_IMAGE_BASE64,
                            mimeType,
                            mockOssFileId,
                            TEST_USER_ID
                        )

                        // Assert second call
                        expect(result2.success).toBe(true)
                        expect(result2.record.id).toBe(mockRecordId)
                    }
                ),
                {
                    numRuns: 20,
                    verbose: true,
                }
            )
        })
    })

    describe('10.3.4 属性 4：失败记录的重试机制', () => {
        it('Property 4: 失败记录的重试机制', async () => {
            // 使用 fast-check 生成随机图片数据
            await fc.assert(
                fc.asyncProperty(
                    fc.constantFrom(...SUPPORTED_MIME_TYPES), // 随机选择支持的 MIME 类型
                    fc.string({ minLength: 5, maxLength: 50 }), // 随机文件名
                    async (mimeType, fileName) => {
                        // Reset mocks
                        mocks.prisma.ossFiles.findFirst.mockReset()
                        mocks.prisma.imageRecognitionRecords.findMany.mockReset()
                        mocks.prisma.imageRecognitionRecords.create.mockReset()
                        mocks.prisma.imageRecognitionRecords.update.mockReset()
                        mocks.prisma.imageRecognitionRecords.findUnique.mockReset()

                        const mockOssFileId = Math.floor(Math.random() * 1000) + 1
                        const failedRecordId = Math.floor(Math.random() * 1000) + 1
                        const newRecordId = failedRecordId + 1

                        // Mock OSS file
                        mocks.prisma.ossFiles.findFirst.mockResolvedValue({
                            id: mockOssFileId,
                            userId: TEST_USER_ID,
                            fileType: mimeType,
                            fileName: fileName
                        })

                        // Mock existing FAILED record
                        const failedRecord = {
                            id: failedRecordId,
                            ossFileId: mockOssFileId,
                            status: 3, // FAILED
                        }
                        mocks.prisma.imageRecognitionRecords.findMany.mockResolvedValue([failedRecord])

                        // Mock create new record
                        const newRecord = {
                            id: newRecordId,
                            ossFileId: mockOssFileId,
                            status: ImageRecognitionStatus.COMPLETED,
                            imageType: 'doc',
                            markdownContent: 'content',
                            htmlContent: 'content'
                        }
                        mocks.prisma.imageRecognitionRecords.create.mockResolvedValue(newRecord)

                        // Act
                        const result = await createImageRecognitionByBase64Service(
                            VALID_IMAGE_BASE64,
                            mimeType,
                            mockOssFileId,
                            TEST_USER_ID
                        )

                        // Assert
                        expect(result.success).toBe(true)
                        expect(result.record.id).toBe(newRecordId)

                        // Verify soft delete of old record
                        expect(mocks.prisma.imageRecognitionRecords.update).toHaveBeenCalledWith(
                            expect.objectContaining({
                                where: { id: failedRecordId },
                                data: { deletedAt: expect.any(Date) }
                            })
                        )
                    }
                ),
                {
                    numRuns: 20,
                    verbose: true,
                }
            )
        })
    })
})
