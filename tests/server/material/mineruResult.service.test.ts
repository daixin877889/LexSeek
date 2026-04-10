/**
 * MinerU 识别结果处理服务测试
 *
 * **Feature: mineru-result-service**
 * **Validates: Requirements 6.1-6.5**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock globals
vi.stubGlobal('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })

const mockPrisma = {
    docRecognitionRecords: { create: vi.fn() },
    ossFiles: { create: vi.fn(), findUnique: vi.fn() },
}
vi.stubGlobal('prisma', mockPrisma)

// Mock dependencies
vi.mock('ofetch', () => ({
    $fetch: vi.fn(),
}))

vi.mock('jszip', () => {
    return {
        default: {
            loadAsync: vi.fn(),
        },
    }
})

vi.mock('marked', () => ({
    marked: {
        setOptions: vi.fn(),
        parse: vi.fn((md: string) => `<p>${md}</p>`),
    },
}))

vi.mock('uuid', () => ({
    v7: vi.fn(() => 'mock-uuid-v7'),
}))

vi.mock('~~/server/services/material/mineru.dao', () => ({
    findDocRecognitionByOssFileIdDao: vi.fn(),
    updateDocRecognitionRecordDao: vi.fn(),
}))

vi.mock('~~/server/services/material/materialEmbedding.service', () => ({
    embedDocumentService: vi.fn(),
}))

// Mock auto-imported generatePostSignatureService
vi.stubGlobal('generatePostSignatureService', vi.fn())

// Mock useRuntimeConfig
vi.stubGlobal('useRuntimeConfig', vi.fn(() => ({
    storage: {
        aliyunOss: { bucket: 'test-bucket' },
        basePath: 'test/',
        callbackUrl: 'https://callback.example.com',
    },
})))

import { $fetch } from 'ofetch'
import JSZip from 'jszip'
import {
    downloadMineruZipService,
    extractMineruZipService,
    replaceImagePathsService,
    markdownToHtmlService,
    uploadImagesToOssService,
} from '~~/server/services/material/mineruResult.service'

describe('MinerU 识别结果处理服务', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ==================== downloadMineruZipService ====================
    describe('downloadMineruZipService', () => {
        it('应下载 ZIP 文件并返回 Buffer', async () => {
            const mockArrayBuffer = new ArrayBuffer(16)
            vi.mocked($fetch).mockResolvedValue(mockArrayBuffer)

            const result = await downloadMineruZipService('https://example.com/result.zip')

            expect(result).toBeInstanceOf(Buffer)
            expect(result.length).toBe(16)
            expect($fetch).toHaveBeenCalledWith('https://example.com/result.zip', expect.objectContaining({
                method: 'GET',
                responseType: 'arrayBuffer',
                timeout: 60000,
            }))
        })

        it('下载失败时应抛出错误', async () => {
            vi.mocked($fetch).mockRejectedValue(new Error('Network error'))

            await expect(downloadMineruZipService('https://bad-url.com')).rejects.toThrow('Network error')
        })
    })

    // ==================== extractMineruZipService ====================
    describe('extractMineruZipService', () => {
        it('应提取 markdown 和图片', async () => {
            const mockZip = {
                files: {
                    'output/full.md': {
                        dir: false,
                        async: vi.fn().mockResolvedValue('# Hello World'),
                    },
                    'output/images/img1.png': {
                        dir: false,
                        async: vi.fn().mockResolvedValue(Buffer.from('png-data')),
                    },
                    'output/images/': {
                        dir: true,
                    },
                },
            }
            vi.mocked(JSZip.loadAsync).mockResolvedValue(mockZip as any)

            const result = await extractMineruZipService(Buffer.from('zip-data'))

            expect(result.markdown).toBe('# Hello World')
            expect(result.images).toHaveLength(1)
            expect(result.images[0]!.fileName).toBe('img1.png')
        })

        it('未找到 full.md 时应抛出错误', async () => {
            const mockZip = {
                files: {
                    'output/images/img1.png': {
                        dir: false,
                        async: vi.fn().mockResolvedValue(Buffer.from('png-data')),
                    },
                },
            }
            vi.mocked(JSZip.loadAsync).mockResolvedValue(mockZip as any)

            await expect(extractMineruZipService(Buffer.from('zip-data'))).rejects.toThrow(
                'ZIP 文件中未找到 full.md 文件',
            )
        })

        it('空 ZIP 文件应抛出错误', async () => {
            const mockZip = { files: {} }
            vi.mocked(JSZip.loadAsync).mockResolvedValue(mockZip as any)

            await expect(extractMineruZipService(Buffer.from('empty'))).rejects.toThrow(
                'ZIP 文件中未找到 full.md 文件',
            )
        })
    })

    // ==================== replaceImagePathsService ====================
    describe('replaceImagePathsService', () => {
        it('应替换图片路径为 OSS 占位符', () => {
            const markdown = '![alt](images/img1.png)'
            const imageMap = new Map([
                ['images/img1.png', { bucket: 'test-bucket', ossFileId: 42 }],
            ])

            const result = replaceImagePathsService(markdown, imageMap)

            expect(result).toBe('![alt]({{OSS_IMAGE:test-bucket:42}})')
        })

        it('应通过文件名模糊匹配', () => {
            const markdown = '![](img1.png)'
            const imageMap = new Map([
                ['output/images/img1.png', { bucket: 'b', ossFileId: 1 }],
            ])

            const result = replaceImagePathsService(markdown, imageMap)

            expect(result).toBe('![]({{OSS_IMAGE:b:1}})')
        })

        it('未匹配的图片应保持原样', () => {
            const markdown = '![alt](images/unknown.png)'
            const imageMap = new Map<string, any>()

            const result = replaceImagePathsService(markdown, imageMap)

            expect(result).toBe('![alt](images/unknown.png)')
        })

        it('无图片的 markdown 应原样返回', () => {
            const markdown = '# Hello\n\nNo images here.'
            const imageMap = new Map<string, any>()

            const result = replaceImagePathsService(markdown, imageMap)
            expect(result).toBe(markdown)
        })

        it('应处理多个图片', () => {
            const markdown = '![a](images/1.png)\n![b](images/2.jpg)'
            const imageMap = new Map([
                ['images/1.png', { bucket: 'b', ossFileId: 1 }],
                ['images/2.jpg', { bucket: 'b', ossFileId: 2 }],
            ])

            const result = replaceImagePathsService(markdown, imageMap)

            expect(result).toContain('{{OSS_IMAGE:b:1}}')
            expect(result).toContain('{{OSS_IMAGE:b:2}}')
        })
    })

    // ==================== markdownToHtmlService ====================
    describe('markdownToHtmlService', () => {
        it('应将 markdown 转换为 HTML', async () => {
            const result = await markdownToHtmlService('# Hello')
            expect(result).toContain('Hello')
        })

        it('空字符串应返回 HTML', async () => {
            const result = await markdownToHtmlService('')
            expect(typeof result).toBe('string')
        })
    })

    // ==================== uploadImagesToOssService ====================
    describe('uploadImagesToOssService', () => {
        it('空图片数组应返回空 Map', async () => {
            const result = await uploadImagesToOssService([], 1)
            expect(result.size).toBe(0)
        })
    })
})
