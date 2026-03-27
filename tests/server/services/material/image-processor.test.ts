/**
 * 图片处理服务单元测试
 *
 * **Feature: image-processor**
 * **Validates: downloadImageFromUrl, processAllImagesInMarkdown, processUrlImagesInMarkdown**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============ Mock definitions (hoisted before vi.mock) ============
const mocks = vi.hoisted(() => ({
    // $fetch mock
    ofetch: vi.fn(),
    // uploadFileService mock
    uploadFileService: vi.fn(),
    // prisma mock
    prisma: {
        ossFiles: {
            create: vi.fn(),
        },
    },
    // logger mocks
    loggerInfo: vi.fn(),
    loggerError: vi.fn(),
    loggerDebug: vi.fn(),
    loggerWarn: vi.fn(),
}))

// ============ Mock dependencies ============
// Mock ofetch ($fetch)
vi.mock('ofetch', () => ({
    $fetch: mocks.ofetch,
}))

// Mock storage.service (both relative and absolute paths)
vi.mock('../../../../server/services/storage/storage.service', () => ({
    uploadFileService: mocks.uploadFileService,
}))
vi.mock('~~/server/services/storage/storage.service', () => ({
    uploadFileService: mocks.uploadFileService,
}))

// Mock uuid
vi.mock('uuid', () => ({
    v4: vi.fn(() => 'mock-uuid-v4-1234'),
}))

// ============ Dynamic import in beforeEach to ensure mocks are set up ============
// Using dynamic imports so mocks are fully set up before module loads
let processAllImagesInMarkdown: typeof import('../../../../server/services/material/imageProcessor').processAllImagesInMarkdown
let processUrlImagesInMarkdown: typeof import('../../../../server/services/material/imageProcessor').processUrlImagesInMarkdown

// Helper: valid minimal PNG buffer (1x1 pixel)
const minimalPngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
)
// Valid JPEG buffer
const minimalJpegBuffer = Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMCwsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBEQCEAwEPwABpQAB//9k=',
    'base64'
)
const minimalGifBuffer = Buffer.from('R0lGODlhAQABAIAAAMzMzAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64')
const minimalWebpBuffer = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERgiQIAfgAA//8=', 'base64')

// Runtime config value to return
const TEST_BUCKET = 'lexseek-files'
const TEST_BASE_PATH = '/uploads/'

describe('imageProcessor', () => {
    beforeEach(async () => {
        vi.clearAllMocks()
        // Reset and configure all mocks
        mocks.ofetch.mockReset()
        mocks.uploadFileService.mockReset()
        mocks.prisma.ossFiles.create.mockReset()
        mocks.loggerInfo.mockReset()
        mocks.loggerError.mockReset()
        mocks.loggerDebug.mockReset()
        mocks.loggerWarn.mockReset()

        // Default mock for OSS file creation - return predictable IDs
        mocks.prisma.ossFiles.create
            .mockResolvedValueOnce({ id: 999 })
            .mockResolvedValueOnce({ id: 1000 })
            .mockResolvedValueOnce({ id: 1001 })
        mocks.uploadFileService.mockResolvedValue(undefined)

        // Setup stub globals
        vi.stubGlobal('logger', {
            info: mocks.loggerInfo,
            error: mocks.loggerError,
            debug: mocks.loggerDebug,
            warn: mocks.loggerWarn,
        })
        vi.stubGlobal('prisma', mocks.prisma)
        vi.stubGlobal('useRuntimeConfig', () => ({
            storage: {
                basePath: TEST_BASE_PATH,
                aliyunOss: {
                    bucket: TEST_BUCKET,
                },
            },
        }))

        // Dynamic import AFTER mocks are set up
        if (!processAllImagesInMarkdown) {
            const mod = await import('../../../../server/services/material/imageProcessor')
            processAllImagesInMarkdown = mod.processAllImagesInMarkdown
            processUrlImagesInMarkdown = mod.processUrlImagesInMarkdown
        }
    })

    describe('processAllImagesInMarkdown', () => {
        describe('base64 图片处理', () => {
            it('应该正确处理 base64 PNG 图片并替换为占位符', async () => {
                const markdown = '这是一张图片：![alt text](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==)'
                const result = await processAllImagesInMarkdown(markdown, 1, 'test-doc')

                expect(result).toContain(`{{OSS_IMAGE:${TEST_BUCKET}:999}}`)
                expect(mocks.ofetch).not.toHaveBeenCalled() // base64 不走下载
                expect(mocks.prisma.ossFiles.create).toHaveBeenCalled()
                expect(mocks.uploadFileService).toHaveBeenCalled()
            })

            it('应该正确处理 base64 JPEG 图片', async () => {
                const markdown = '![photo](data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD)'
                const result = await processAllImagesInMarkdown(markdown, 1, 'test-doc')

                expect(result).toContain(`{{OSS_IMAGE:${TEST_BUCKET}:`)
                expect(result).toContain('{{OSS_IMAGE:')
                expect(mocks.prisma.ossFiles.create).toHaveBeenCalled()
            })

            it('应该正确处理 base64 GIF 图片', async () => {
                const markdown = '![gif](data:image/gif;base64,R0lGODlhAQABAIAAAMzMzAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==)'
                const result = await processAllImagesInMarkdown(markdown, 1, 'test-doc')

                expect(result).toContain(`{{OSS_IMAGE:${TEST_BUCKET}:`)
                expect(mocks.prisma.ossFiles.create).toHaveBeenCalled()
            })

            it('应该正确处理 base64 WebP 图片', async () => {
                const markdown = '![webp](data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERgiQIAfgAA)'
                const result = await processAllImagesInMarkdown(markdown, 1, 'test-doc')

                expect(result).toContain(`{{OSS_IMAGE:${TEST_BUCKET}:`)
                expect(mocks.prisma.ossFiles.create).toHaveBeenCalled()
            })

            it('没有 base64 图片时应该保持原内容不变', async () => {
                const markdown = '这是一个没有图片的 markdown'
                const result = await processAllImagesInMarkdown(markdown, 1, 'test-doc')

                expect(result).toBe(markdown)
                expect(mocks.ofetch).not.toHaveBeenCalled()
                expect(mocks.prisma.ossFiles.create).not.toHaveBeenCalled()
            })

            it('应该保留 base64 图片的 alt 文本', async () => {
                const markdown = '![my image alt](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==)'
                const result = await processAllImagesInMarkdown(markdown, 1, 'test-doc')

                expect(result).toContain('[my image alt]')
                expect(result).toContain(`{{OSS_IMAGE:${TEST_BUCKET}:`)
            })

            it('应该保留 base64 图片周围的其他文本', async () => {
                const markdown = '## 标题\n\n这是一张图片：![alt](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==)\n\n段落内容。'
                const result = await processAllImagesInMarkdown(markdown, 1, 'test-doc')

                expect(result).toContain('## 标题')
                expect(result).toContain('段落内容')
                expect(result).toContain('![alt]')
                expect(result).toContain(`{{OSS_IMAGE:${TEST_BUCKET}:`)
            })

            it('应该处理多个 base64 图片', async () => {
                const markdown = '![img1](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==) and ![img2](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==)'
                const result = await processAllImagesInMarkdown(markdown, 1, 'test-doc')

                expect(result).toContain(`{{OSS_IMAGE:${TEST_BUCKET}:999}}`)
                expect(result).toContain(`{{OSS_IMAGE:${TEST_BUCKET}:1000}}`)
            })
        })

        describe('URL 图片处理', () => {
            it('应该正确处理 URL 图片并替换为占位符', async () => {
                mocks.ofetch.mockResolvedValue(minimalPngBuffer)

                const markdown = '![screenshot](https://example.com/image.png)'
                const result = await processAllImagesInMarkdown(markdown, 1, 'test-doc')

                expect(result).toContain(`{{OSS_IMAGE:${TEST_BUCKET}:`)
                expect(mocks.ofetch).toHaveBeenCalledWith('https://example.com/image.png', {
                    responseType: 'arrayBuffer',
                })
            })

            it('应该处理 http 和 https URL', async () => {
                mocks.ofetch.mockResolvedValue(minimalPngBuffer)

                const markdown = '![img](http://example.com/test.png)'
                const result = await processAllImagesInMarkdown(markdown, 1, 'test-doc')

                expect(result).toContain(`{{OSS_IMAGE:${TEST_BUCKET}:`)
            })

            it('不应该重复处理已转换的占位符', async () => {
                mocks.ofetch.mockResolvedValue(minimalPngBuffer)

                const markdown = '![alt]({{OSS_IMAGE:any-bucket:123}})'
                const result = await processAllImagesInMarkdown(markdown, 1, 'test-doc')

                expect(result).toBe(markdown)
                expect(mocks.ofetch).not.toHaveBeenCalled()
            })

            it('URL 图片处理失败时应该保持原内容', async () => {
                mocks.ofetch.mockRejectedValue(new Error('Network error'))

                const markdown = '![img](https://example.com/broken.png)'
                const result = await processAllImagesInMarkdown(markdown, 1, 'test-doc')

                expect(result).toBe(markdown)
            })
        })

        describe('混合场景', () => {
            it('应该同时处理 base64 和 URL 图片', async () => {
                mocks.ofetch.mockResolvedValue(minimalPngBuffer)

                const markdown = '## 材料分析\n\n先看这张截图：![screenshot](https://example.com/screen.png)\n\n再看看手写笔记：![notes](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==)'
                const result = await processAllImagesInMarkdown(markdown, 1, 'test-doc')

                expect(result).toContain(`{{OSS_IMAGE:${TEST_BUCKET}:`)
                expect(result).toContain('## 材料分析')
            })

            it('base64 处理成功时即使 URL 处理失败也保留 base64 结果', async () => {
                mocks.ofetch.mockRejectedValue(new Error('URL download failed'))

                const markdown = '![base64](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==) and ![url](https://example.com/broken.png)'
                const result = await processAllImagesInMarkdown(markdown, 1, 'test-doc')

                // base64 图片应该被成功处理
                expect(result).toContain(`{{OSS_IMAGE:${TEST_BUCKET}:`)
            })
        })
    })

    describe('processUrlImagesInMarkdown', () => {
        it('应该只处理 URL 图片，不处理 base64 图片', async () => {
            mocks.ofetch.mockResolvedValue(minimalPngBuffer)

            const markdown = '![base64](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==) and ![url](https://example.com/img.png)'
            const result = await processUrlImagesInMarkdown(markdown, 1, 'test-doc')

            // base64 图片不应该被替换
            expect(result).toContain('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==')
            // URL 图片应该被替换
            expect(result).toContain(`{{OSS_IMAGE:${TEST_BUCKET}:`)
        })

        it('没有 URL 图片时应该保持原内容不变', async () => {
            mocks.ofetch.mockResolvedValue(minimalPngBuffer)

            const markdown = '![base64 only](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAE=)'
            const result = await processUrlImagesInMarkdown(markdown, 1, 'test-doc')

            expect(result).toBe(markdown)
            expect(mocks.ofetch).not.toHaveBeenCalled()
        })

        it('应该正确处理多个 URL 图片', async () => {
            mocks.ofetch.mockResolvedValue(minimalPngBuffer)

            const markdown = '![img1](https://example.com/1.png) and ![img2](https://example.com/2.png)'
            const result = await processUrlImagesInMarkdown(markdown, 1, 'test-doc')

            expect(result).toContain(`{{OSS_IMAGE:${TEST_BUCKET}:999}}`)
            expect(result).toContain(`{{OSS_IMAGE:${TEST_BUCKET}:1000}}`)
        })

        it('应该处理 URL 图片的 alt 文本', async () => {
            mocks.ofetch.mockResolvedValue(minimalPngBuffer)

            const markdown = '![important screenshot](https://example.com/screen.png)'
            const result = await processUrlImagesInMarkdown(markdown, 1, 'test-doc')

            expect(result).toContain('[important screenshot]')
            expect(result).toContain(`{{OSS_IMAGE:${TEST_BUCKET}:`)
        })

        it('应该保留 URL 图片周围的文本', async () => {
            mocks.ofetch.mockResolvedValue(minimalPngBuffer)

            const markdown = '### 证据截图\n\n如证据图所示：![ev](https://example.com/evidence.png)\n\n请参考上述图片。'
            const result = await processUrlImagesInMarkdown(markdown, 1, 'test-doc')

            expect(result).toContain('### 证据截图')
            expect(result).toContain('如证据图所示：')
            expect(result).toContain('请参考上述图片。')
            expect(result).toContain(`{{OSS_IMAGE:${TEST_BUCKET}:`)
        })

        it('URL 图片处理失败时应该保持原内容', async () => {
            mocks.ofetch.mockRejectedValue(new Error('Network error'))

            const markdown = '![broken](https://example.com/nonexistent.png)'
            const result = await processUrlImagesInMarkdown(markdown, 1, 'test-doc')

            expect(result).toBe(markdown)
        })

        it('不应该处理已转换的占位符', async () => {
            mocks.ofetch.mockResolvedValue(minimalPngBuffer)

            const markdown = '![already processed]({{OSS_IMAGE:my-bucket:456}})'
            const result = await processUrlImagesInMarkdown(markdown, 1, 'test-doc')

            expect(result).toBe(markdown)
            expect(mocks.ofetch).not.toHaveBeenCalled()
        })

        it('应该正确处理带查询参数的 URL', async () => {
            mocks.ofetch.mockResolvedValue(minimalPngBuffer)

            const markdown = '![img](https://example.com/image.png?w=800&h=600)'
            const result = await processUrlImagesInMarkdown(markdown, 1, 'test-doc')

            expect(result).toContain(`{{OSS_IMAGE:${TEST_BUCKET}:`)
            expect(mocks.ofetch).toHaveBeenCalledWith(
                'https://example.com/image.png?w=800&h=600',
                { responseType: 'arrayBuffer' }
            )
        })

        it('应该正确处理带锚点的 URL', async () => {
            mocks.ofetch.mockResolvedValue(minimalPngBuffer)

            const markdown = '![img](https://example.com/image.png#section)'
            const result = await processUrlImagesInMarkdown(markdown, 1, 'test-doc')

            expect(result).toContain(`{{OSS_IMAGE:${TEST_BUCKET}:`)
        })
    })

    describe('MIME 类型推断', () => {
        it('应该根据 URL 后缀推断 PNG', async () => {
            mocks.ofetch.mockResolvedValue(minimalPngBuffer)

            const markdown = '![img](https://example.com/photo.png)'
            await processUrlImagesInMarkdown(markdown, 1, 'test-doc')

            expect(mocks.prisma.ossFiles.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        fileType: 'image/png',
                    }),
                })
            )
        })

        it('应该根据 URL 后缀推断 JPEG', async () => {
            mocks.ofetch.mockResolvedValue(minimalJpegBuffer)

            const markdown = '![img](https://example.com/photo.jpg)'
            await processUrlImagesInMarkdown(markdown, 1, 'test-doc')

            expect(mocks.prisma.ossFiles.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        fileType: 'image/jpeg',
                    }),
                })
            )
        })

        it('应该根据 URL 后缀推断 JPEG (jpeg)', async () => {
            mocks.ofetch.mockResolvedValue(minimalJpegBuffer)

            const markdown = '![img](https://example.com/photo.jpeg)'
            await processUrlImagesInMarkdown(markdown, 1, 'test-doc')

            expect(mocks.prisma.ossFiles.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        fileType: 'image/jpeg',
                    }),
                })
            )
        })

        it('应该根据 URL 后缀推断 GIF', async () => {
            mocks.ofetch.mockResolvedValue(minimalGifBuffer)

            const markdown = '![img](https://example.com/animation.gif)'
            await processUrlImagesInMarkdown(markdown, 1, 'test-doc')

            expect(mocks.prisma.ossFiles.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        fileType: 'image/gif',
                    }),
                })
            )
        })

        it('应该根据 URL 后缀推断 WebP', async () => {
            mocks.ofetch.mockResolvedValue(minimalWebpBuffer)

            const markdown = '![img](https://example.com/photo.webp)'
            await processUrlImagesInMarkdown(markdown, 1, 'test-doc')

            expect(mocks.prisma.ossFiles.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        fileType: 'image/webp',
                    }),
                })
            )
        })

        it('应该根据 URL 后缀推断 SVG', async () => {
            mocks.ofetch.mockResolvedValue(Buffer.from('<svg></svg>'))

            const markdown = '![img](https://example.com/diagram.svg)'
            await processUrlImagesInMarkdown(markdown, 1, 'test-doc')

            expect(mocks.prisma.ossFiles.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        fileType: 'image/svg+xml',
                    }),
                })
            )
        })

        it('应该根据 URL 后缀推断 BMP', async () => {
            mocks.ofetch.mockResolvedValue(Buffer.from('BM'))

            const markdown = '![img](https://example.com/photo.bmp)'
            await processUrlImagesInMarkdown(markdown, 1, 'test-doc')

            expect(mocks.prisma.ossFiles.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        fileType: 'image/bmp',
                    }),
                })
            )
        })

        it('应该根据 URL 后缀推断 ICO', async () => {
            mocks.ofetch.mockResolvedValue(Buffer.from([0, 0, 1, 0]))

            const markdown = '![img](https://example.com/favicon.ico)'
            await processUrlImagesInMarkdown(markdown, 1, 'test-doc')

            expect(mocks.prisma.ossFiles.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        fileType: 'image/x-icon',
                    }),
                })
            )
        })

        it('URL 后缀未知时应该默认为 PNG', async () => {
            mocks.ofetch.mockResolvedValue(minimalPngBuffer)

            const markdown = '![img](https://example.com/unknown.xyz)'
            await processUrlImagesInMarkdown(markdown, 1, 'test-doc')

            expect(mocks.prisma.ossFiles.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        fileType: 'image/png',
                    }),
                })
            )
        })

        it('base64 图片应该使用声明的 MIME 类型', async () => {
            const markdown = '![jpeg](data:image/jpeg;base64,/9j/4AAQSkZJRgA)'
            await processAllImagesInMarkdown(markdown, 1, 'test-doc')

            expect(mocks.prisma.ossFiles.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        fileType: 'image/jpeg',
                    }),
                })
            )
        })

        it('URL 大小写不敏感：正确识别 .JPG', async () => {
            mocks.ofetch.mockResolvedValue(minimalJpegBuffer)

            const markdown = '![img](https://example.com/photo.JPG)'
            await processUrlImagesInMarkdown(markdown, 1, 'test-doc')

            expect(mocks.prisma.ossFiles.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        fileType: 'image/jpeg',
                    }),
                })
            )
        })
    })
})
