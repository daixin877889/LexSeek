/**
 * 存储基类辅助方法测试
 *
 * 测试 BaseStorageAdapter 中的辅助方法和错误转换逻辑
 *
 * **Feature: storage-system**
 * **Validates: Requirements 10.1, 10.4**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import type { Readable } from 'stream'
import type {
    StorageConfig,
    StorageProviderType,
    UploadOptions,
    UploadResult,
    DownloadOptions,
    DeleteResult,
    SignedUrlOptions,
    PostSignatureOptions,
    PostSignatureResult
} from '../../../server/lib/storage/types'
import { BaseStorageAdapter } from '../../../server/lib/storage/base'
import {
    StorageError,
    StorageErrorCode,
    StorageConfigError,
    StorageNotFoundError,
    StoragePermissionError,
    StorageNetworkError,
    StorageUploadError,
    StorageDownloadError,
    StorageDeleteError,
    StorageSignatureError
} from '../../../server/lib/storage/errors'

/**
 * 测试用的具体适配器实现
 * 用于测试 BaseStorageAdapter 的 protected 方法
 */
class TestStorageAdapter extends BaseStorageAdapter {
    readonly type = 'test' as StorageProviderType

    constructor(config: StorageConfig) {
        super(config)
    }

    // 暴露 protected 方法用于测试
    public testGetExtension(filename: string): string {
        return this.getExtension(filename)
    }

    public testGenerateFileName(
        originalFileName: string,
        strategy: 'uuid' | 'timestamp' | 'original' | 'custom' = 'uuid',
        customFileName?: string
    ): string {
        return this.generateFileName(originalFileName, strategy, customFileName)
    }

    public testBuildFilePath(dir: string, fileName: string): string {
        return this.buildFilePath(dir, fileName)
    }

    public testWrapUploadError(error: unknown): StorageUploadError {
        return this.wrapUploadError(error)
    }

    public testWrapDownloadError(error: unknown): StorageDownloadError {
        return this.wrapDownloadError(error)
    }

    public testWrapDeleteError(error: unknown): StorageDeleteError {
        return this.wrapDeleteError(error)
    }

    public testWrapSignatureError(error: unknown): StorageSignatureError {
        return this.wrapSignatureError(error)
    }

    public testIsNotFoundError(error: unknown): boolean {
        return this.isNotFoundError(error)
    }

    public testIsPermissionError(error: unknown): boolean {
        return this.isPermissionError(error)
    }

    public testIsConfigError(error: unknown): boolean {
        return this.isConfigError(error)
    }

    public testIsNetworkError(error: unknown): boolean {
        return this.isNetworkError(error)
    }

    public testConvertError(error: unknown, defaultMessage: string): StorageError {
        return this.convertError(error, defaultMessage)
    }

    // 实现抽象方法（测试中不使用）
    protected getHost(): string {
        return 'https://test.example.com'
    }

    async upload(): Promise<UploadResult> {
        throw new Error('Not implemented')
    }

    async download(): Promise<Buffer> {
        throw new Error('Not implemented')
    }

    async downloadStream(): Promise<Readable> {
        throw new Error('Not implemented')
    }

    async delete(): Promise<DeleteResult> {
        throw new Error('Not implemented')
    }

    async generateSignedUrl(): Promise<string> {
        throw new Error('Not implemented')
    }

    async generatePostSignature(): Promise<PostSignatureResult> {
        throw new Error('Not implemented')
    }

    async testConnection(): Promise<boolean> {
        return true
    }
}

// 创建测试适配器实例
const createTestAdapter = () => {
    return new TestStorageAdapter({
        bucket: 'test-bucket',
        region: 'test-region'
    })
}

describe('BaseStorageAdapter 辅助方法', () => {
    describe('getExtension - 获取文件扩展名', () => {
        it('应正确提取常见文件扩展名', () => {
            const adapter = createTestAdapter()
            expect(adapter.testGetExtension('file.txt')).toBe('txt')
            expect(adapter.testGetExtension('image.PNG')).toBe('png')
            expect(adapter.testGetExtension('document.PDF')).toBe('pdf')
            expect(adapter.testGetExtension('archive.tar.gz')).toBe('gz')
        })

        it('没有扩展名时应返回空字符串', () => {
            const adapter = createTestAdapter()
            expect(adapter.testGetExtension('filename')).toBe('')
            expect(adapter.testGetExtension('noext')).toBe('')
        })

        it('Property: 扩展名应为小写', () => {
            const adapter = createTestAdapter()
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-zA-Z0-9]+$/.test(s)),
                    fc.string({ minLength: 1, maxLength: 5 }).filter(s => /^[a-zA-Z]+$/.test(s)),
                    (name, ext) => {
                        const filename = `${name}.${ext.toUpperCase()}`
                        const result = adapter.testGetExtension(filename)
                        expect(result).toBe(ext.toLowerCase())
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('generateFileName - 生成文件名', () => {
        it('uuid 策略应生成 UUID 格式文件名', () => {
            const adapter = createTestAdapter()
            const result = adapter.testGenerateFileName('test.txt', 'uuid')
            expect(result).toMatch(/^[0-9a-f-]{36}\.txt$/)
        })

        it('timestamp 策略应生成时间戳文件名', () => {
            const adapter = createTestAdapter()
            const before = Date.now()
            const result = adapter.testGenerateFileName('test.txt', 'timestamp')
            const after = Date.now()

            const timestamp = parseInt(result.replace('.txt', ''))
            expect(timestamp).toBeGreaterThanOrEqual(before)
            expect(timestamp).toBeLessThanOrEqual(after)
        })

        it('original 策略应保留原始文件名', () => {
            const adapter = createTestAdapter()
            const result = adapter.testGenerateFileName('original-file.txt', 'original')
            expect(result).toBe('original-file.txt')
        })

        it('custom 策略应使用自定义文件名', () => {
            const adapter = createTestAdapter()
            const result = adapter.testGenerateFileName('test.txt', 'custom', 'custom-name.txt')
            expect(result).toBe('custom-name.txt')
        })

        it('custom 策略没有自定义名称时应使用原始文件名', () => {
            const adapter = createTestAdapter()
            const result = adapter.testGenerateFileName('fallback.txt', 'custom')
            expect(result).toBe('fallback.txt')
        })

        it('没有扩展名的文件应正确处理', () => {
            const adapter = createTestAdapter()
            const uuidResult = adapter.testGenerateFileName('noext', 'uuid')
            expect(uuidResult).toMatch(/^[0-9a-f-]{36}$/)

            const timestampResult = adapter.testGenerateFileName('noext', 'timestamp')
            expect(timestampResult).toMatch(/^\d+$/)
        })

        it('默认策略应为 uuid', () => {
            const adapter = createTestAdapter()
            const result = adapter.testGenerateFileName('test.txt')
            expect(result).toMatch(/^[0-9a-f-]{36}\.txt$/)
        })
    })

    describe('buildFilePath - 构建文件路径', () => {
        it('应正确拼接目录和文件名', () => {
            const adapter = createTestAdapter()
            expect(adapter.testBuildFilePath('uploads/', 'file.txt')).toBe('uploads/file.txt')
            expect(adapter.testBuildFilePath('uploads', 'file.txt')).toBe('uploads/file.txt')
        })

        it('应移除文件名开头的斜杠', () => {
            const adapter = createTestAdapter()
            expect(adapter.testBuildFilePath('uploads/', '/file.txt')).toBe('uploads/file.txt')
        })

        it('Property: 路径应包含目录和文件名', () => {
            const adapter = createTestAdapter()
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-z0-9-]+$/.test(s)),
                    fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-z0-9.-]+$/.test(s)),
                    (dir, file) => {
                        const result = adapter.testBuildFilePath(dir, file)
                        expect(result).toContain(dir)
                        expect(result).toContain(file)
                        expect(result).toMatch(/^[^/].*\/[^/]+$/)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})

describe('BaseStorageAdapter 错误转换', () => {
    describe('wrapUploadError - 上传错误转换', () => {
        it('应将普通 Error 转换为 StorageUploadError', () => {
            const adapter = createTestAdapter()
            const error = new Error('Upload failed')
            const result = adapter.testWrapUploadError(error)

            expect(result).toBeInstanceOf(StorageUploadError)
            expect(result.message).toBe('Upload failed')
            expect(result.cause).toBe(error)
        })

        it('应保留 StorageError 的消息', () => {
            const adapter = createTestAdapter()
            const error = new StorageConfigError('Config error')
            const result = adapter.testWrapUploadError(error)

            expect(result).toBeInstanceOf(StorageUploadError)
            expect(result.message).toBe('Config error')
        })

        it('非 Error 对象应使用默认消息', () => {
            const adapter = createTestAdapter()
            const result = adapter.testWrapUploadError('string error')

            expect(result).toBeInstanceOf(StorageUploadError)
            expect(result.message).toBe('上传失败')
        })
    })

    describe('wrapDownloadError - 下载错误转换', () => {
        it('应将普通 Error 转换为 StorageDownloadError', () => {
            const adapter = createTestAdapter()
            const error = new Error('Download failed')
            const result = adapter.testWrapDownloadError(error)

            expect(result).toBeInstanceOf(StorageDownloadError)
            expect(result.message).toBe('Download failed')
        })

        it('非 Error 对象应使用默认消息', () => {
            const adapter = createTestAdapter()
            const result = adapter.testWrapDownloadError(null)

            expect(result).toBeInstanceOf(StorageDownloadError)
            expect(result.message).toBe('下载失败')
        })
    })

    describe('wrapDeleteError - 删除错误转换', () => {
        it('应将普通 Error 转换为 StorageDeleteError', () => {
            const adapter = createTestAdapter()
            const error = new Error('Delete failed')
            const result = adapter.testWrapDeleteError(error)

            expect(result).toBeInstanceOf(StorageDeleteError)
            expect(result.message).toBe('Delete failed')
        })

        it('非 Error 对象应使用默认消息', () => {
            const adapter = createTestAdapter()
            const result = adapter.testWrapDeleteError(undefined)

            expect(result).toBeInstanceOf(StorageDeleteError)
            expect(result.message).toBe('删除失败')
        })
    })

    describe('wrapSignatureError - 签名错误转换', () => {
        it('应将普通 Error 转换为 StorageSignatureError', () => {
            const adapter = createTestAdapter()
            const error = new Error('Signature failed')
            const result = adapter.testWrapSignatureError(error)

            expect(result).toBeInstanceOf(StorageSignatureError)
            expect(result.message).toBe('Signature failed')
        })

        it('非 Error 对象应使用默认消息', () => {
            const adapter = createTestAdapter()
            const result = adapter.testWrapSignatureError({})

            expect(result).toBeInstanceOf(StorageSignatureError)
            expect(result.message).toBe('签名生成失败')
        })
    })
})

describe('BaseStorageAdapter 错误类型检测', () => {
    describe('isNotFoundError - 文件不存在错误检测', () => {
        it('应识别 StorageNotFoundError', () => {
            const adapter = createTestAdapter()
            const error = new StorageNotFoundError('file.txt')
            expect(adapter.testIsNotFoundError(error)).toBe(true)
        })

        it('应识别 NoSuchKey 错误码', () => {
            const adapter = createTestAdapter()
            expect(adapter.testIsNotFoundError({ code: 'NoSuchKey' })).toBe(true)
        })

        it('应识别 404 状态码', () => {
            const adapter = createTestAdapter()
            expect(adapter.testIsNotFoundError({ status: 404 })).toBe(true)
        })

        it('其他错误应返回 false', () => {
            const adapter = createTestAdapter()
            expect(adapter.testIsNotFoundError(new Error('other'))).toBe(false)
            expect(adapter.testIsNotFoundError({ code: 'OtherError' })).toBe(false)
        })
    })

    describe('isPermissionError - 权限错误检测', () => {
        it('应识别 StoragePermissionError', () => {
            const adapter = createTestAdapter()
            const error = new StoragePermissionError('Access denied')
            expect(adapter.testIsPermissionError(error)).toBe(true)
        })

        it('应识别 AccessDenied 错误码', () => {
            const adapter = createTestAdapter()
            expect(adapter.testIsPermissionError({ code: 'AccessDenied' })).toBe(true)
        })

        it('应识别 403 状态码', () => {
            const adapter = createTestAdapter()
            expect(adapter.testIsPermissionError({ status: 403 })).toBe(true)
        })
    })

    describe('isConfigError - 配置错误检测', () => {
        it('应识别 StorageConfigError', () => {
            const adapter = createTestAdapter()
            const error = new StorageConfigError('Invalid config')
            expect(adapter.testIsConfigError(error)).toBe(true)
        })

        it('应识别 InvalidAccessKeyId 错误码', () => {
            const adapter = createTestAdapter()
            expect(adapter.testIsConfigError({ code: 'InvalidAccessKeyId' })).toBe(true)
        })

        it('应识别 SignatureDoesNotMatch 错误码', () => {
            const adapter = createTestAdapter()
            expect(adapter.testIsConfigError({ code: 'SignatureDoesNotMatch' })).toBe(true)
        })
    })

    describe('isNetworkError - 网络错误检测', () => {
        it('应识别 StorageNetworkError', () => {
            const adapter = createTestAdapter()
            const error = new StorageNetworkError('Network error')
            expect(adapter.testIsNetworkError(error)).toBe(true)
        })

        it('应识别各种网络错误码', () => {
            const adapter = createTestAdapter()
            expect(adapter.testIsNetworkError({ code: 'NetworkError' })).toBe(true)
            expect(adapter.testIsNetworkError({ code: 'ConnectionTimeoutError' })).toBe(true)
            expect(adapter.testIsNetworkError({ code: 'ECONNREFUSED' })).toBe(true)
            expect(adapter.testIsNetworkError({ code: 'ETIMEDOUT' })).toBe(true)
        })
    })
})

describe('BaseStorageAdapter convertError - 通用错误转换', () => {
    it('已经是 StorageError 时应直接返回', () => {
        const adapter = createTestAdapter()
        const error = new StorageConfigError('Config error')
        const result = adapter.testConvertError(error, 'default')

        expect(result).toBe(error)
    })

    it('文件不存在错误应转换为 StorageNotFoundError', () => {
        const adapter = createTestAdapter()
        const error = { code: 'NoSuchKey', key: 'test.txt' }
        const result = adapter.testConvertError(error, 'default')

        expect(result).toBeInstanceOf(StorageNotFoundError)
        expect(result.message).toContain('test.txt')
    })

    it('权限错误应转换为 StoragePermissionError', () => {
        const adapter = createTestAdapter()
        const error = { code: 'AccessDenied', message: 'Access denied' }
        const result = adapter.testConvertError(error, 'default')

        expect(result).toBeInstanceOf(StoragePermissionError)
    })

    it('配置错误应转换为 StorageConfigError', () => {
        const adapter = createTestAdapter()
        const error = { code: 'InvalidAccessKeyId', message: 'Invalid key' }
        const result = adapter.testConvertError(error, 'default')

        expect(result).toBeInstanceOf(StorageConfigError)
    })

    it('网络错误应转换为 StorageNetworkError', () => {
        const adapter = createTestAdapter()
        const error = { code: 'ECONNREFUSED', message: 'Connection refused' }
        const result = adapter.testConvertError(error, 'default')

        expect(result).toBeInstanceOf(StorageNetworkError)
    })

    it('未知错误应返回通用 StorageError', () => {
        const adapter = createTestAdapter()
        const error = { code: 'UnknownError', message: 'Unknown' }
        const result = adapter.testConvertError(error, 'default message')

        expect(result).toBeInstanceOf(StorageError)
        expect(result.code).toBe(StorageErrorCode.UNKNOWN_ERROR)
    })

    it('无消息的错误应使用默认消息', () => {
        const adapter = createTestAdapter()
        const result = adapter.testConvertError({}, 'default message')

        expect(result.message).toBe('default message')
    })
})

describe('BaseStorageAdapter 配置验证', () => {
    it('缺少 bucket 应抛出 StorageConfigError', () => {
        expect(() => {
            new TestStorageAdapter({
                bucket: '',
                region: 'test-region'
            })
        }).toThrow(StorageConfigError)
    })

    it('缺少 region 应抛出 StorageConfigError', () => {
        expect(() => {
            new TestStorageAdapter({
                bucket: 'test-bucket',
                region: ''
            })
        }).toThrow(StorageConfigError)
    })
})
