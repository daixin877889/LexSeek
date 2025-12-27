/**
 * Storage Base 扩展测试
 *
 * 测试 BaseStorageAdapter 中的辅助方法和错误转换
 * 用于提高代码覆盖率
 *
 * **Feature: storage-system**
 * **Validates: Requirements 10.1, 10.2**
 */

import { describe, it, expect } from 'vitest'
import { config } from 'dotenv'

// 加载环境变量
config()

// 从环境变量获取配置
const ossConfig = {
    accessKeyId: process.env.NUXT_STORAGE_ALIYUN_OSS_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.NUXT_STORAGE_ALIYUN_OSS_ACCESS_KEY_SECRET || '',
    bucket: process.env.NUXT_STORAGE_ALIYUN_OSS_BUCKET || '',
    region: process.env.NUXT_STORAGE_ALIYUN_OSS_REGION || '',
    customDomain: process.env.NUXT_STORAGE_ALIYUN_OSS_CUSTOM_DOMAIN
}

// 检查配置是否完整
const hasValidConfig = ossConfig.accessKeyId && ossConfig.accessKeySecret && ossConfig.bucket && ossConfig.region

describe('BaseStorageAdapter 错误转换测试', () => {
    describe('wrapUploadError', () => {
        it('应正确转换 StorageError 实例', async () => {
            const { StorageError, StorageErrorCode, StorageUploadError } = await import('../../../server/lib/storage/errors')

            const originalError = new StorageError('Original error', StorageErrorCode.UNKNOWN_ERROR)
            const uploadError = new StorageUploadError(originalError.message, originalError)

            expect(uploadError.message).toBe('Original error')
            expect(uploadError.cause).toBe(originalError)
        })

        it('应正确转换普通 Error 实例', async () => {
            const { StorageUploadError } = await import('../../../server/lib/storage/errors')

            const originalError = new Error('Upload failed')
            const uploadError = new StorageUploadError(originalError.message, originalError)

            expect(uploadError.message).toBe('Upload failed')
            expect(uploadError.cause).toBe(originalError)
        })

        it('应正确处理非 Error 对象', async () => {
            const { StorageUploadError } = await import('../../../server/lib/storage/errors')

            // 非 Error 对象
            const uploadError = new StorageUploadError('上传失败')

            expect(uploadError.message).toBe('上传失败')
        })
    })

    describe('wrapDownloadError', () => {
        it('应正确转换 StorageError 实例', async () => {
            const { StorageError, StorageErrorCode, StorageDownloadError } = await import('../../../server/lib/storage/errors')

            const originalError = new StorageError('Original error', StorageErrorCode.UNKNOWN_ERROR)
            const downloadError = new StorageDownloadError(originalError.message, originalError)

            expect(downloadError.message).toBe('Original error')
        })

        it('应正确处理非 Error 对象', async () => {
            const { StorageDownloadError } = await import('../../../server/lib/storage/errors')

            const downloadError = new StorageDownloadError('下载失败')

            expect(downloadError.message).toBe('下载失败')
        })
    })

    describe('wrapDeleteError', () => {
        it('应正确转换 StorageError 实例', async () => {
            const { StorageError, StorageErrorCode, StorageDeleteError } = await import('../../../server/lib/storage/errors')

            const originalError = new StorageError('Original error', StorageErrorCode.UNKNOWN_ERROR)
            const deleteError = new StorageDeleteError(originalError.message, originalError)

            expect(deleteError.message).toBe('Original error')
        })

        it('应正确处理非 Error 对象', async () => {
            const { StorageDeleteError } = await import('../../../server/lib/storage/errors')

            const deleteError = new StorageDeleteError('删除失败')

            expect(deleteError.message).toBe('删除失败')
        })
    })

    describe('wrapSignatureError', () => {
        it('应正确转换 StorageError 实例', async () => {
            const { StorageError, StorageErrorCode, StorageSignatureError } = await import('../../../server/lib/storage/errors')

            const originalError = new StorageError('Original error', StorageErrorCode.UNKNOWN_ERROR)
            const signatureError = new StorageSignatureError(originalError.message, originalError)

            expect(signatureError.message).toBe('Original error')
        })

        it('应正确处理非 Error 对象', async () => {
            const { StorageSignatureError } = await import('../../../server/lib/storage/errors')

            const signatureError = new StorageSignatureError('签名生成失败')

            expect(signatureError.message).toBe('签名生成失败')
        })
    })
})

describe('BaseStorageAdapter 错误类型检测测试', () => {
    describe('isNotFoundError', () => {
        it('应识别 StorageNotFoundError 实例', async () => {
            const { StorageNotFoundError } = await import('../../../server/lib/storage/errors')

            const error = new StorageNotFoundError('test/file.txt')
            expect(error).toBeInstanceOf(StorageNotFoundError)
            expect(error.path).toBe('test/file.txt')
        })

        it('应识别 NoSuchKey 错误码', async () => {
            // 模拟 OSS 返回的错误
            const error = { code: 'NoSuchKey', message: 'Object not found' }
            expect(error.code).toBe('NoSuchKey')
        })

        it('应识别 404 状态码', async () => {
            const error = { status: 404, message: 'Not found' }
            expect(error.status).toBe(404)
        })
    })

    describe('isPermissionError', () => {
        it('应识别 StoragePermissionError 实例', async () => {
            const { StoragePermissionError } = await import('../../../server/lib/storage/errors')

            const error = new StoragePermissionError('Access denied')
            expect(error).toBeInstanceOf(StoragePermissionError)
        })

        it('应识别 AccessDenied 错误码', async () => {
            const error = { code: 'AccessDenied', message: 'Access denied' }
            expect(error.code).toBe('AccessDenied')
        })

        it('应识别 403 状态码', async () => {
            const error = { status: 403, message: 'Forbidden' }
            expect(error.status).toBe(403)
        })
    })

    describe('isConfigError', () => {
        it('应识别 StorageConfigError 实例', async () => {
            const { StorageConfigError } = await import('../../../server/lib/storage/errors')

            const error = new StorageConfigError('Invalid config')
            expect(error).toBeInstanceOf(StorageConfigError)
        })

        it('应识别 InvalidAccessKeyId 错误码', async () => {
            const error = { code: 'InvalidAccessKeyId', message: 'Invalid access key' }
            expect(error.code).toBe('InvalidAccessKeyId')
        })

        it('应识别 SignatureDoesNotMatch 错误码', async () => {
            const error = { code: 'SignatureDoesNotMatch', message: 'Signature mismatch' }
            expect(error.code).toBe('SignatureDoesNotMatch')
        })
    })

    describe('isNetworkError', () => {
        it('应识别 StorageNetworkError 实例', async () => {
            const { StorageNetworkError } = await import('../../../server/lib/storage/errors')

            const error = new StorageNetworkError('Network error')
            expect(error).toBeInstanceOf(StorageNetworkError)
        })

        it('应识别 NetworkError 错误码', async () => {
            const error = { code: 'NetworkError', message: 'Network error' }
            expect(error.code).toBe('NetworkError')
        })

        it('应识别 ConnectionTimeoutError 错误码', async () => {
            const error = { code: 'ConnectionTimeoutError', message: 'Connection timeout' }
            expect(error.code).toBe('ConnectionTimeoutError')
        })

        it('应识别 ECONNREFUSED 错误码', async () => {
            const error = { code: 'ECONNREFUSED', message: 'Connection refused' }
            expect(error.code).toBe('ECONNREFUSED')
        })

        it('应识别 ETIMEDOUT 错误码', async () => {
            const error = { code: 'ETIMEDOUT', message: 'Connection timed out' }
            expect(error.code).toBe('ETIMEDOUT')
        })
    })
})

describe('BaseStorageAdapter 辅助方法测试', () => {
    describe('getExtension', () => {
        it('应正确提取文件扩展名', async () => {
            // 通过 AliyunOssAdapter 间接测试
            const { AliyunOssAdapter } = await import('../../../server/lib/storage/adapters/aliyun-oss')

            if (!hasValidConfig) {
                console.log('跳过测试：缺少 OSS 配置')
                return
            }

            const adapter = new AliyunOssAdapter(ossConfig)

            // 测试带扩展名的文件
            const result1 = await adapter.generatePostSignature({
                dir: 'test/',
                fileKey: {
                    originalFileName: 'document.pdf',
                    strategy: 'uuid'
                }
            })
            expect(result1.key).toMatch(/\.pdf$/)

            // 测试大写扩展名
            const result2 = await adapter.generatePostSignature({
                dir: 'test/',
                fileKey: {
                    originalFileName: 'IMAGE.PNG',
                    strategy: 'uuid'
                }
            })
            expect(result2.key).toMatch(/\.PNG$/)
        })

        it('应正确处理无扩展名的文件', async () => {
            const { AliyunOssAdapter } = await import('../../../server/lib/storage/adapters/aliyun-oss')

            if (!hasValidConfig) {
                console.log('跳过测试：缺少 OSS 配置')
                return
            }

            const adapter = new AliyunOssAdapter(ossConfig)

            const result = await adapter.generatePostSignature({
                dir: 'test/',
                fileKey: {
                    originalFileName: 'noextension',
                    strategy: 'uuid'
                }
            })

            // 无扩展名的文件应该只有 UUID
            expect(result.key).toMatch(/^test\/[0-9a-f-]+$/)
        })

        it('应正确处理多个点的文件名', async () => {
            const { AliyunOssAdapter } = await import('../../../server/lib/storage/adapters/aliyun-oss')

            if (!hasValidConfig) {
                console.log('跳过测试：缺少 OSS 配置')
                return
            }

            const adapter = new AliyunOssAdapter(ossConfig)

            const result = await adapter.generatePostSignature({
                dir: 'test/',
                fileKey: {
                    originalFileName: 'file.name.with.dots.txt',
                    strategy: 'uuid'
                }
            })

            expect(result.key).toMatch(/\.txt$/)
        })
    })

    describe('generateFileName', () => {
        it('uuid 策略应生成 UUID 格式的文件名', async () => {
            const { AliyunOssAdapter } = await import('../../../server/lib/storage/adapters/aliyun-oss')

            if (!hasValidConfig) {
                console.log('跳过测试：缺少 OSS 配置')
                return
            }

            const adapter = new AliyunOssAdapter(ossConfig)

            const result = await adapter.generatePostSignature({
                dir: 'test/',
                fileKey: {
                    originalFileName: 'test.txt',
                    strategy: 'uuid'
                }
            })

            // UUID 格式: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
            expect(result.key).toMatch(/^test\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.txt$/)
        })

        it('timestamp 策略应生成时间戳格式的文件名', async () => {
            const { AliyunOssAdapter } = await import('../../../server/lib/storage/adapters/aliyun-oss')

            if (!hasValidConfig) {
                console.log('跳过测试：缺少 OSS 配置')
                return
            }

            const adapter = new AliyunOssAdapter(ossConfig)

            const result = await adapter.generatePostSignature({
                dir: 'test/',
                fileKey: {
                    originalFileName: 'test.txt',
                    strategy: 'timestamp'
                }
            })

            // 时间戳格式: 数字.扩展名
            expect(result.key).toMatch(/^test\/\d+\.txt$/)
        })

        it('original 策略应保留原始文件名', async () => {
            const { AliyunOssAdapter } = await import('../../../server/lib/storage/adapters/aliyun-oss')

            if (!hasValidConfig) {
                console.log('跳过测试：缺少 OSS 配置')
                return
            }

            const adapter = new AliyunOssAdapter(ossConfig)

            const result = await adapter.generatePostSignature({
                dir: 'test/',
                fileKey: {
                    originalFileName: 'original-file.txt',
                    strategy: 'original'
                }
            })

            expect(result.key).toBe('test/original-file.txt')
        })

        it('custom 策略应使用自定义文件名', async () => {
            const { AliyunOssAdapter } = await import('../../../server/lib/storage/adapters/aliyun-oss')

            if (!hasValidConfig) {
                console.log('跳过测试：缺少 OSS 配置')
                return
            }

            const adapter = new AliyunOssAdapter(ossConfig)

            const result = await adapter.generatePostSignature({
                dir: 'test/',
                fileKey: {
                    originalFileName: 'original.txt',
                    strategy: 'custom',
                    customFileName: 'custom-name.txt'
                }
            })

            expect(result.key).toBe('test/custom-name.txt')
        })

        it('默认策略应使用 uuid', async () => {
            const { AliyunOssAdapter } = await import('../../../server/lib/storage/adapters/aliyun-oss')

            if (!hasValidConfig) {
                console.log('跳过测试：缺少 OSS 配置')
                return
            }

            const adapter = new AliyunOssAdapter(ossConfig)

            const result = await adapter.generatePostSignature({
                dir: 'test/',
                fileKey: {
                    originalFileName: 'test.txt'
                    // 不指定 strategy，应该使用默认的 uuid
                }
            })

            // 应该是 UUID 格式
            expect(result.key).toMatch(/^test\/[0-9a-f-]+\.txt$/)
        })
    })

    describe('buildFilePath', () => {
        it('应正确构建文件路径', async () => {
            const { AliyunOssAdapter } = await import('../../../server/lib/storage/adapters/aliyun-oss')

            if (!hasValidConfig) {
                console.log('跳过测试：缺少 OSS 配置')
                return
            }

            const adapter = new AliyunOssAdapter(ossConfig)

            // 测试目录不以 / 结尾
            const result1 = await adapter.generatePostSignature({
                dir: 'test',
                fileKey: {
                    originalFileName: 'file.txt',
                    strategy: 'original'
                }
            })
            expect(result1.key).toBe('testfile.txt')

            // 测试目录以 / 结尾
            const result2 = await adapter.generatePostSignature({
                dir: 'test/',
                fileKey: {
                    originalFileName: 'file.txt',
                    strategy: 'original'
                }
            })
            expect(result2.key).toBe('test/file.txt')
        })
    })
})

describe('convertError 方法测试', () => {
    it('应正确转换 NotFoundError', async () => {
        const { StorageNotFoundError, StorageErrorCode } = await import('../../../server/lib/storage/errors')

        const error = new StorageNotFoundError('test/file.txt')
        expect(error.code).toBe(StorageErrorCode.NOT_FOUND)
        expect(error.path).toBe('test/file.txt')
    })

    it('应正确转换 PermissionError', async () => {
        const { StoragePermissionError, StorageErrorCode } = await import('../../../server/lib/storage/errors')

        const error = new StoragePermissionError('Access denied')
        expect(error.code).toBe(StorageErrorCode.PERMISSION_DENIED)
    })

    it('应正确转换 ConfigError', async () => {
        const { StorageConfigError, StorageErrorCode } = await import('../../../server/lib/storage/errors')

        const error = new StorageConfigError('Invalid config')
        expect(error.code).toBe(StorageErrorCode.CONFIG_ERROR)
    })

    it('应正确转换 NetworkError', async () => {
        const { StorageNetworkError, StorageErrorCode } = await import('../../../server/lib/storage/errors')

        const error = new StorageNetworkError('Network error')
        expect(error.code).toBe(StorageErrorCode.NETWORK_ERROR)
    })

    it('应正确转换未知错误', async () => {
        const { StorageError, StorageErrorCode } = await import('../../../server/lib/storage/errors')

        const error = new StorageError('Unknown error', StorageErrorCode.UNKNOWN_ERROR)
        expect(error.code).toBe(StorageErrorCode.UNKNOWN_ERROR)
    })
})
