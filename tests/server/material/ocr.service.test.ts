/**
 * OCR 服务 - 工具函数测试
 *
 * 测试 validateImageType 和 SUPPORTED_IMAGE_TYPES 导出
 *
 * **Feature: ocr-service**
 * **Validates: Requirements 3.3.1, 3.3.2**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'
import {
    validateImageType,
    SUPPORTED_IMAGE_TYPES,
} from '~~/server/services/material/ocr.service'

describe('OCR 服务 - 工具函数', () => {
    describe('SUPPORTED_IMAGE_TYPES', () => {
        it('应包含 6 种支持的图片类型', () => {
            expect(SUPPORTED_IMAGE_TYPES).toHaveLength(6)
        })

        it('应包含 JPEG 类型', () => {
            expect(SUPPORTED_IMAGE_TYPES).toContain('image/jpeg')
        })

        it('应包含 PNG 类型', () => {
            expect(SUPPORTED_IMAGE_TYPES).toContain('image/png')
        })

        it('应包含 GIF 类型', () => {
            expect(SUPPORTED_IMAGE_TYPES).toContain('image/gif')
        })

        it('应包含 WebP 类型', () => {
            expect(SUPPORTED_IMAGE_TYPES).toContain('image/webp')
        })

        it('应包含 HEIC 类型', () => {
            expect(SUPPORTED_IMAGE_TYPES).toContain('image/heic')
        })

        it('应包含 HEIF 类型', () => {
            expect(SUPPORTED_IMAGE_TYPES).toContain('image/heif')
        })

        it('所有类型应以 image/ 前缀开头', () => {
            for (const type of SUPPORTED_IMAGE_TYPES) {
                expect(type).toMatch(/^image\//)
            }
        })

        it('所有类型应为小写', () => {
            for (const type of SUPPORTED_IMAGE_TYPES) {
                expect(type).toBe(type.toLowerCase())
            }
        })

        it('不应包含重复类型', () => {
            const unique = new Set(SUPPORTED_IMAGE_TYPES)
            expect(unique.size).toBe(SUPPORTED_IMAGE_TYPES.length)
        })
    })

    describe('validateImageType', () => {
        // 快乐路径 - 支持的类型
        it('应接受 image/jpeg', () => {
            expect(validateImageType('image/jpeg')).toBe(true)
        })

        it('应接受 image/png', () => {
            expect(validateImageType('image/png')).toBe(true)
        })

        it('应接受 image/gif', () => {
            expect(validateImageType('image/gif')).toBe(true)
        })

        it('应接受 image/webp', () => {
            expect(validateImageType('image/webp')).toBe(true)
        })

        it('应接受 image/heic', () => {
            expect(validateImageType('image/heic')).toBe(true)
        })

        it('应接受 image/heif', () => {
            expect(validateImageType('image/heif')).toBe(true)
        })

        // 大小写不敏感
        it('应忽略大小写 - IMAGE/JPEG', () => {
            expect(validateImageType('IMAGE/JPEG')).toBe(true)
        })

        it('应忽略大小写 - Image/Png', () => {
            expect(validateImageType('Image/Png')).toBe(true)
        })

        it('应忽略大小写 - IMAGE/WEBP', () => {
            expect(validateImageType('IMAGE/WEBP')).toBe(true)
        })

        it('应忽略大小写 - Image/Heic', () => {
            expect(validateImageType('Image/Heic')).toBe(true)
        })

        it('应忽略大小写 - iMaGe/GiF', () => {
            expect(validateImageType('iMaGe/GiF')).toBe(true)
        })

        // 不支持的类型
        it('应拒绝 image/bmp', () => {
            expect(validateImageType('image/bmp')).toBe(false)
        })

        it('应拒绝 image/tiff', () => {
            expect(validateImageType('image/tiff')).toBe(false)
        })

        it('应拒绝 image/svg+xml', () => {
            expect(validateImageType('image/svg+xml')).toBe(false)
        })

        it('应拒绝 application/pdf', () => {
            expect(validateImageType('application/pdf')).toBe(false)
        })

        it('应拒绝 text/plain', () => {
            expect(validateImageType('text/plain')).toBe(false)
        })

        it('应拒绝 video/mp4', () => {
            expect(validateImageType('video/mp4')).toBe(false)
        })

        it('应拒绝 audio/mpeg', () => {
            expect(validateImageType('audio/mpeg')).toBe(false)
        })

        // 边缘情况
        it('应拒绝空字符串', () => {
            expect(validateImageType('')).toBe(false)
        })

        it('应拒绝带空格的 MIME 类型', () => {
            expect(validateImageType(' image/jpeg ')).toBe(false)
        })

        it('应拒绝不完整的 MIME 类型', () => {
            expect(validateImageType('image/')).toBe(false)
        })

        it('应拒绝仅有前缀的 MIME 类型', () => {
            expect(validateImageType('image')).toBe(false)
        })

        it('应拒绝带额外参数的 MIME 类型', () => {
            expect(validateImageType('image/jpeg; charset=utf-8')).toBe(false)
        })

        // Property: SUPPORTED_IMAGE_TYPES 中的所有类型都应通过验证
        it('Property: 所有已声明的支持类型均应通过验证', () => {
            for (const supportedType of SUPPORTED_IMAGE_TYPES) {
                expect(validateImageType(supportedType)).toBe(true)
            }
        })

        // Property: 大写形式的支持类型也应通过验证
        it('Property: 大写形式的支持类型也应通过验证', () => {
            for (const supportedType of SUPPORTED_IMAGE_TYPES) {
                expect(validateImageType(supportedType.toUpperCase())).toBe(true)
            }
        })

        // Property: 随机生成的非图片 MIME 类型应被拒绝
        it('Property: 随机非图片 MIME 类型应被拒绝', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 30 }),
                    (mimeType) => {
                        // 排除恰好命中支持类型的情况
                        const lower = mimeType.toLowerCase()
                        if (SUPPORTED_IMAGE_TYPES.includes(lower)) return true
                        return validateImageType(mimeType) === false
                    }
                ),
                { numRuns: 100 }
            )
        })

        // Property: validateImageType 的结果与手动检查一致
        it('Property: 验证结果应与 includes 检查一致', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(
                        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
                        'image/heic', 'image/heif', 'image/bmp', 'image/tiff',
                        'image/svg+xml', 'application/pdf', 'text/plain',
                        'video/mp4', 'audio/mpeg', '', 'image/', 'image'
                    ),
                    (mimeType) => {
                        const expected = SUPPORTED_IMAGE_TYPES.includes(mimeType.toLowerCase())
                        return validateImageType(mimeType) === expected
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})

// ==================== 服务层函数测试 ====================

// 模拟全局自动导入
const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}
;(globalThis as any).logger = mockLogger

;(globalThis as any).prisma = {
    ossFiles: {
        findFirst: vi.fn(),
    },
    imageRecognitionRecords: {
        update: vi.fn(),
    },
}

;(globalThis as any).useRuntimeConfig = vi.fn().mockReturnValue({
    storage: {
        aliyunOss: { bucket: 'test-bucket' },
    },
})

// 模拟全局枚举
;(globalThis as any).ImageRecognitionStatus = {
    PENDING: 0,
    PROCESSING: 1,
    COMPLETED: 2,
    FAILED: 3,
}
;(globalThis as any).ImageType = {
    DOC: 'doc',
    PHOTO: 'photo',
}

// 模拟依赖模块
vi.mock('~~/server/services/material/ocr.dao', () => ({
    createImageRecognitionRecordDao: vi.fn(),
    findImageRecognitionByOssFileIdDao: vi.fn(),
    findImageRecognitionByIdDao: vi.fn(),
    updateImageRecognitionRecordDao: vi.fn(),
    findImageRecognitionsByOssFileIdsDao: vi.fn().mockResolvedValue([]),
}))

vi.mock('~~/server/services/storage/storage.service', () => ({
    generateSignedUrlService: vi.fn().mockResolvedValue('https://example.com/signed-image.jpg'),
}))

vi.mock('~~/server/services/node/node.service', () => ({
    getValidNodeConfig: vi.fn(),
    getNodeConfigService: vi.fn(),
}))

vi.mock('~~/server/services/node/chatModelFactory', () => ({
    createChatModel: vi.fn().mockReturnValue({
        withStructuredOutput: vi.fn().mockReturnValue({
            invoke: vi.fn(),
        }),
    }),
}))

vi.mock('~~/server/services/material/materialEmbedding.service', () => ({
    embedImageService: vi.fn().mockResolvedValue({
        ids: ['vec-1'],
        lastEmbeddingAt: new Date().toISOString(),
        chunkCount: 1,
    }),
}))

vi.mock('~~/server/services/material/mineruResult.service', () => ({
    markdownToHtmlService: vi.fn().mockImplementation((md: string) => Promise.resolve(`<p>${md}</p>`)),
}))

// 模拟图片压缩（动态导入路径需要匹配实际的相对路径）
vi.mock('~~/server/utils/imageCompression', () => ({
    compressImageFromUrl: vi.fn().mockResolvedValue({
        buffer: Buffer.from('compressed'),
        mimeType: 'image/jpeg',
    }),
    compressImageFromBase64: vi.fn().mockResolvedValue({
        base64Data: 'compressed-base64',
        mimeType: 'image/jpeg',
    }),
}))

// 由于 extractImageInfo 使用 dynamic import ('../../utils/imageCompression')
// 也需要 mock 这个相对路径解析到的实际模块
vi.mock('/Users/daixin/work/dev/LexSeek/LexSeek/server/utils/imageCompression', () => ({
    compressImageFromUrl: vi.fn().mockResolvedValue({
        buffer: Buffer.from('compressed'),
        mimeType: 'image/jpeg',
    }),
    compressImageFromBase64: vi.fn().mockResolvedValue({
        base64Data: 'compressed-base64',
        mimeType: 'image/jpeg',
    }),
}))

vi.mock('@langchain/core/messages', () => ({
    HumanMessage: class HumanMessage { constructor(public content: any) {} },
    SystemMessage: class SystemMessage { constructor(public content: any) {} },
}))

describe('OCR 服务 - 服务层函数', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ==================== createImageConversionService ====================
    describe('createImageConversionService', () => {
        it('OSS 文件不存在时应返回失败', async () => {
            ;(globalThis as any).prisma.ossFiles.findFirst = vi.fn().mockResolvedValue(null)

            const { createImageConversionService } = await import('~~/server/services/material/ocr.service')
            const result = await createImageConversionService(999, 1)

            expect(result.success).toBe(false)
            expect(result.error).toContain('不存在')
        })

        it('已存在成功识别记录时应直接返回', async () => {
            ;(globalThis as any).prisma.ossFiles.findFirst = vi.fn().mockResolvedValue({
                id: 1,
                filePath: 'images/test.jpg',
                fileType: 'image/jpeg',
            })

            const { findImageRecognitionByOssFileIdDao } = await import('~~/server/services/material/ocr.dao')
            vi.mocked(findImageRecognitionByOssFileIdDao).mockResolvedValue({
                id: 10,
                ossFileId: 1,
                status: 2, // ImageRecognitionStatus.COMPLETED
            } as any)

            const { createImageConversionService } = await import('~~/server/services/material/ocr.service')
            const result = await createImageConversionService(1, 1)

            expect(result.success).toBe(true)
            expect(result.task?.taskId).toBe('existing')
        })

        it('已存在非成功识别记录时应返回失败', async () => {
            ;(globalThis as any).prisma.ossFiles.findFirst = vi.fn().mockResolvedValue({
                id: 1,
                filePath: 'images/test.jpg',
                fileType: 'image/jpeg',
            })

            const { findImageRecognitionByOssFileIdDao } = await import('~~/server/services/material/ocr.dao')
            vi.mocked(findImageRecognitionByOssFileIdDao).mockResolvedValue({
                id: 10,
                ossFileId: 1,
                status: 1, // PROCESSING
            } as any)

            const { createImageConversionService } = await import('~~/server/services/material/ocr.service')
            const result = await createImageConversionService(1, 1)

            expect(result.success).toBe(false)
            expect(result.error).toContain('重复创建')
        })

        it('不支持的图片类型应返回失败', async () => {
            ;(globalThis as any).prisma.ossFiles.findFirst = vi.fn().mockResolvedValue({
                id: 1,
                filePath: 'images/test.bmp',
                fileType: 'image/bmp',
            })

            const { findImageRecognitionByOssFileIdDao } = await import('~~/server/services/material/ocr.dao')
            vi.mocked(findImageRecognitionByOssFileIdDao).mockResolvedValue(null)

            const { createImageConversionService } = await import('~~/server/services/material/ocr.service')
            const result = await createImageConversionService(1, 1)

            expect(result.success).toBe(false)
            expect(result.error).toContain('不支持')
        })

        it('AI 识别成功时应创建记录并返回', async () => {
            ;(globalThis as any).prisma.ossFiles.findFirst = vi.fn().mockResolvedValue({
                id: 1,
                filePath: 'images/test.jpg',
                fileType: 'image/jpeg',
            })

            const { findImageRecognitionByOssFileIdDao, createImageRecognitionRecordDao } = await import('~~/server/services/material/ocr.dao')
            vi.mocked(findImageRecognitionByOssFileIdDao).mockResolvedValue(null)

            const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
            vi.mocked(getValidNodeConfig).mockResolvedValue({
                modelApiKeys: [{ apiKey: 'test-key' }],
                modelName: 'gpt-4o',
                modelProviderBaseUrl: 'https://api.openai.com/v1',
                modelSdkType: 'openai',
                name: 'extractImageInfo',
                prompts: [{ type: 'system', content: '你是图片识别助手', status: 1 }],
            } as any)

            const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
            const mockInvoke = vi.fn().mockResolvedValue({
                imgType: 'doc',
                imageInfo: '# 文档内容\n\n这是一份合同',
            })
            vi.mocked(createChatModel).mockReturnValue({
                withStructuredOutput: vi.fn().mockReturnValue({
                    invoke: mockInvoke,
                }),
            } as any)

            const mockRecord = { id: 20, ossFileId: 1, status: 2 }
            vi.mocked(createImageRecognitionRecordDao).mockResolvedValue(mockRecord as any)

            const { createImageConversionService } = await import('~~/server/services/material/ocr.service')
            const result = await createImageConversionService(1, 1)

            expect(result.success).toBe(true)
            expect(result.record).toEqual(mockRecord)
            expect(createImageRecognitionRecordDao).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 1,
                    ossFileId: 1,
                    status: 2, // COMPLETED
                    imageType: 'doc',
                }),
                undefined
            )
        })

        it('AI 识别失败时应返回错误但不创建记录', async () => {
            ;(globalThis as any).prisma.ossFiles.findFirst = vi.fn().mockResolvedValue({
                id: 1,
                filePath: 'images/test.jpg',
                fileType: 'image/jpeg',
            })

            const { findImageRecognitionByOssFileIdDao, createImageRecognitionRecordDao } = await import('~~/server/services/material/ocr.dao')
            vi.mocked(findImageRecognitionByOssFileIdDao).mockResolvedValue(null)

            const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
            vi.mocked(getValidNodeConfig).mockRejectedValue(new Error('OCR 节点未配置'))

            const { createImageConversionService } = await import('~~/server/services/material/ocr.service')
            const result = await createImageConversionService(1, 1)

            expect(result.success).toBe(false)
            expect(createImageRecognitionRecordDao).not.toHaveBeenCalled()
        })
    })

    // ==================== createImageRecognitionService ====================
    describe('createImageRecognitionService', () => {
        it('基础识别失败时应直接返回失败', async () => {
            ;(globalThis as any).prisma.ossFiles.findFirst = vi.fn().mockResolvedValue(null)

            const { createImageRecognitionService } = await import('~~/server/services/material/ocr.service')
            const result = await createImageRecognitionService(999, 1)

            expect(result.success).toBe(false)
        })

        it('已有成功记录（existing）时应跳过向量化', async () => {
            ;(globalThis as any).prisma.ossFiles.findFirst = vi.fn().mockResolvedValue({
                id: 1,
                filePath: 'images/test.jpg',
                fileType: 'image/jpeg',
            })

            const { findImageRecognitionByOssFileIdDao } = await import('~~/server/services/material/ocr.dao')
            vi.mocked(findImageRecognitionByOssFileIdDao).mockResolvedValue({
                id: 10,
                ossFileId: 1,
                status: 2, // COMPLETED
            } as any)

            const { embedImageService } = await import('~~/server/services/material/materialEmbedding.service')

            const { createImageRecognitionService } = await import('~~/server/services/material/ocr.service')
            const result = await createImageRecognitionService(1, 1)

            expect(result.success).toBe(true)
            expect(embedImageService).not.toHaveBeenCalled()
        })

        it('向量化失败不应影响识别结果', async () => {
            ;(globalThis as any).prisma.ossFiles.findFirst = vi.fn().mockResolvedValue({
                id: 1,
                filePath: 'images/test.jpg',
                fileType: 'image/jpeg',
            })

            const { findImageRecognitionByOssFileIdDao, createImageRecognitionRecordDao } = await import('~~/server/services/material/ocr.dao')
            vi.mocked(findImageRecognitionByOssFileIdDao).mockResolvedValue(null)

            const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
            vi.mocked(getValidNodeConfig).mockResolvedValue({
                modelApiKeys: [{ apiKey: 'test-key' }],
                modelName: 'gpt-4o',
                modelProviderBaseUrl: 'https://api.openai.com/v1',
                modelSdkType: 'openai',
                name: 'extractImageInfo',
                prompts: [{ type: 'system', content: '识别图片', status: 1 }],
            } as any)

            const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
            vi.mocked(createChatModel).mockReturnValue({
                withStructuredOutput: vi.fn().mockReturnValue({
                    invoke: vi.fn().mockResolvedValue({
                        imgType: 'photo',
                        imageInfo: '一张照片',
                    }),
                }),
            } as any)

            vi.mocked(createImageRecognitionRecordDao).mockResolvedValue({
                id: 20, ossFileId: 1, markdownContent: '一张照片',
            } as any)

            const { embedImageService } = await import('~~/server/services/material/materialEmbedding.service')
            vi.mocked(embedImageService).mockRejectedValue(new Error('向量化服务不可用'))

            const { createImageRecognitionService } = await import('~~/server/services/material/ocr.service')
            const result = await createImageRecognitionService(1, 1)

            // 识别仍然成功
            expect(result.success).toBe(true)
        })
    })

    // ==================== updateImageRecognitionService ====================
    describe('updateImageRecognitionService', () => {
        it('记录不存在时应抛出错误', async () => {
            const { findImageRecognitionByIdDao } = await import('~~/server/services/material/ocr.dao')
            vi.mocked(findImageRecognitionByIdDao).mockResolvedValue(null)

            const { updateImageRecognitionService } = await import('~~/server/services/material/ocr.service')

            await expect(updateImageRecognitionService(999, '新内容', 1)).rejects.toThrow('不存在')
        })

        it('非记录所有者编辑时应抛出权限错误', async () => {
            const { findImageRecognitionByIdDao } = await import('~~/server/services/material/ocr.dao')
            vi.mocked(findImageRecognitionByIdDao).mockResolvedValue({
                id: 1,
                userId: 2, // 不是当前用户
            } as any)

            const { updateImageRecognitionService } = await import('~~/server/services/material/ocr.service')

            await expect(updateImageRecognitionService(1, '新内容', 1)).rejects.toThrow('无权限')
        })

        it('成功更新时应转换 markdown 为 HTML 并保存', async () => {
            const { findImageRecognitionByIdDao, updateImageRecognitionRecordDao } = await import('~~/server/services/material/ocr.dao')
            vi.mocked(findImageRecognitionByIdDao).mockResolvedValue({
                id: 1,
                userId: 1,
            } as any)

            const updatedRecord = { id: 1, markdownContent: '# 更新内容', htmlContent: '<p># 更新内容</p>' }
            vi.mocked(updateImageRecognitionRecordDao).mockResolvedValue(updatedRecord as any)

            const { updateImageRecognitionService } = await import('~~/server/services/material/ocr.service')
            const result = await updateImageRecognitionService(1, '# 更新内容', 1)

            expect(result).toEqual(updatedRecord)
            expect(updateImageRecognitionRecordDao).toHaveBeenCalledWith(
                1,
                expect.objectContaining({
                    markdownContent: '# 更新内容',
                    htmlContent: expect.any(String),
                }),
                undefined
            )
        })
    })

    // ==================== 查询函数 ====================
    describe('查询函数', () => {
        it('findByOssFileIdService 应委托给 DAO', async () => {
            const { findImageRecognitionByOssFileIdDao } = await import('~~/server/services/material/ocr.dao')
            const mockRecord = { id: 1, ossFileId: 10 } as any
            vi.mocked(findImageRecognitionByOssFileIdDao).mockResolvedValue(mockRecord)

            const { findByOssFileIdService } = await import('~~/server/services/material/ocr.service')
            const result = await findByOssFileIdService(10)

            expect(result).toEqual(mockRecord)
        })

        it('findByOssFileIdsService 应委托给 DAO', async () => {
            const { findImageRecognitionsByOssFileIdsDao } = await import('~~/server/services/material/ocr.dao')
            const mockRecords = [{ id: 1 }, { id: 2 }] as any[]
            vi.mocked(findImageRecognitionsByOssFileIdsDao).mockResolvedValue(mockRecords)

            const { findByOssFileIdsService } = await import('~~/server/services/material/ocr.service')
            const result = await findByOssFileIdsService([10, 20])

            expect(result).toEqual(mockRecords)
        })

        it('findByIdService 应委托给 DAO', async () => {
            const { findImageRecognitionByIdDao } = await import('~~/server/services/material/ocr.dao')
            const mockRecord = { id: 1 } as any
            vi.mocked(findImageRecognitionByIdDao).mockResolvedValue(mockRecord)

            const { findByIdService } = await import('~~/server/services/material/ocr.service')
            const result = await findByIdService(1)

            expect(result).toEqual(mockRecord)
        })
    })
})
