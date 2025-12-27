/**
 * 存储错误类测试
 *
 * 测试存储适配器中定义的各种错误类和错误转换工具
 *
 * **Feature: storage-system**
 * **Validates: Requirements 10.4**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
    StorageErrorCode,
    StorageError,
    StorageConfigError,
    StorageNotFoundError,
    StoragePermissionError,
    StorageNetworkError,
    StorageUploadError,
    StorageDownloadError,
    StorageDeleteError,
    StorageSignatureError,
    StorageStsError,
    convertAliyunError,
    convertQiniuError,
    convertTencentError,
    isStorageError,
    isStorageConfigError,
    isStorageNotFoundError,
    isStoragePermissionError,
    isStorageNetworkError
} from '../../../server/lib/storage/errors'

describe('存储错误码枚举', () => {
    it('应包含所有预定义的错误码', () => {
        expect(StorageErrorCode.CONFIG_ERROR).toBe('STORAGE_CONFIG_ERROR')
        expect(StorageErrorCode.NOT_FOUND).toBe('STORAGE_NOT_FOUND')
        expect(StorageErrorCode.PERMISSION_DENIED).toBe('STORAGE_PERMISSION_DENIED')
        expect(StorageErrorCode.NETWORK_ERROR).toBe('STORAGE_NETWORK_ERROR')
        expect(StorageErrorCode.UPLOAD_ERROR).toBe('STORAGE_UPLOAD_ERROR')
        expect(StorageErrorCode.DOWNLOAD_ERROR).toBe('STORAGE_DOWNLOAD_ERROR')
        expect(StorageErrorCode.DELETE_ERROR).toBe('STORAGE_DELETE_ERROR')
        expect(StorageErrorCode.SIGNATURE_ERROR).toBe('STORAGE_SIGNATURE_ERROR')
        expect(StorageErrorCode.STS_ERROR).toBe('STORAGE_STS_ERROR')
        expect(StorageErrorCode.UNKNOWN_ERROR).toBe('STORAGE_UNKNOWN_ERROR')
    })
})

describe('StorageError 基类', () => {
    it('应正确设置错误属性', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 100 }),
                (message) => {
                    const error = new StorageError(message, StorageErrorCode.UNKNOWN_ERROR)
                    expect(error.name).toBe('StorageError')
                    expect(error.message).toBe(message)
                    expect(error.code).toBe(StorageErrorCode.UNKNOWN_ERROR)
                    expect(error).toBeInstanceOf(Error)
                    return true
                }
            ),
            { numRuns: 100 }
        )
    })

    it('应正确保存原始错误', () => {
        const cause = new Error('原始错误')
        const error = new StorageError('包装错误', StorageErrorCode.UNKNOWN_ERROR, cause)
        expect(error.cause).toBe(cause)
    })

    it('toJSON 应返回正确的对象', () => {
        const cause = new Error('原始错误')
        const error = new StorageError('测试错误', StorageErrorCode.UNKNOWN_ERROR, cause)
        const json = error.toJSON()

        expect(json.name).toBe('StorageError')
        expect(json.code).toBe(StorageErrorCode.UNKNOWN_ERROR)
        expect(json.message).toBe('测试错误')
        expect(json.cause).toBe('原始错误')
    })
})

describe('StorageConfigError', () => {
    it('应正确设置错误属性', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 100 }),
                (message) => {
                    const error = new StorageConfigError(message)
                    expect(error.name).toBe('StorageConfigError')
                    expect(error.code).toBe(StorageErrorCode.CONFIG_ERROR)
                    expect(error.message).toBe(message)
                    expect(error).toBeInstanceOf(StorageError)
                    return true
                }
            ),
            { numRuns: 100 }
        )
    })
})

describe('StorageNotFoundError', () => {
    it('应正确设置错误属性和路径', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 100 }),
                (path) => {
                    const error = new StorageNotFoundError(path)
                    expect(error.name).toBe('StorageNotFoundError')
                    expect(error.code).toBe(StorageErrorCode.NOT_FOUND)
                    expect(error.message).toBe(`文件不存在: ${path}`)
                    expect(error.path).toBe(path)
                    expect(error).toBeInstanceOf(StorageError)
                    return true
                }
            ),
            { numRuns: 100 }
        )
    })

    it('toJSON 应包含路径信息', () => {
        const error = new StorageNotFoundError('/test/file.txt')
        const json = error.toJSON()
        expect(json.path).toBe('/test/file.txt')
    })
})

describe('StoragePermissionError', () => {
    it('应正确设置错误属性', () => {
        const error = new StoragePermissionError('权限不足')
        expect(error.name).toBe('StoragePermissionError')
        expect(error.code).toBe(StorageErrorCode.PERMISSION_DENIED)
    })
})

describe('StorageNetworkError', () => {
    it('应正确设置错误属性', () => {
        const error = new StorageNetworkError('网络连接失败')
        expect(error.name).toBe('StorageNetworkError')
        expect(error.code).toBe(StorageErrorCode.NETWORK_ERROR)
    })
})

describe('StorageUploadError', () => {
    it('应正确设置错误属性', () => {
        const error = new StorageUploadError('上传失败')
        expect(error.name).toBe('StorageUploadError')
        expect(error.code).toBe(StorageErrorCode.UPLOAD_ERROR)
    })
})

describe('StorageDownloadError', () => {
    it('应正确设置错误属性', () => {
        const error = new StorageDownloadError('下载失败')
        expect(error.name).toBe('StorageDownloadError')
        expect(error.code).toBe(StorageErrorCode.DOWNLOAD_ERROR)
    })
})

describe('StorageDeleteError', () => {
    it('应正确设置错误属性', () => {
        const error = new StorageDeleteError('删除失败')
        expect(error.name).toBe('StorageDeleteError')
        expect(error.code).toBe(StorageErrorCode.DELETE_ERROR)
    })
})

describe('StorageSignatureError', () => {
    it('应正确设置错误属性', () => {
        const error = new StorageSignatureError('签名生成失败')
        expect(error.name).toBe('StorageSignatureError')
        expect(error.code).toBe(StorageErrorCode.SIGNATURE_ERROR)
    })
})

describe('StorageStsError', () => {
    it('应正确设置错误属性', () => {
        const error = new StorageStsError('STS 凭证获取失败')
        expect(error.name).toBe('StorageStsError')
        expect(error.code).toBe(StorageErrorCode.STS_ERROR)
    })
})

describe('阿里云错误转换', () => {
    it('NoSuchKey 应转换为 StorageNotFoundError', () => {
        const error = convertAliyunError({ code: 'NoSuchKey', message: '文件不存在' })
        expect(error).toBeInstanceOf(StorageNotFoundError)
    })

    it('AccessDenied 应转换为 StoragePermissionError', () => {
        const error = convertAliyunError({ code: 'AccessDenied', message: '权限不足' })
        expect(error).toBeInstanceOf(StoragePermissionError)
    })

    it('InvalidAccessKeyId 应转换为 StorageConfigError', () => {
        const error = convertAliyunError({ code: 'InvalidAccessKeyId', message: '无效的 AccessKeyId' })
        expect(error).toBeInstanceOf(StorageConfigError)
    })

    it('SignatureDoesNotMatch 应转换为 StorageConfigError', () => {
        const error = convertAliyunError({ code: 'SignatureDoesNotMatch', message: '签名不匹配' })
        expect(error).toBeInstanceOf(StorageConfigError)
    })

    it('NetworkError 应转换为 StorageNetworkError', () => {
        const error = convertAliyunError({ code: 'NetworkError', message: '网络错误' })
        expect(error).toBeInstanceOf(StorageNetworkError)
    })

    it('ConnectionTimeoutError 应转换为 StorageNetworkError', () => {
        const error = convertAliyunError({ code: 'ConnectionTimeoutError', message: '连接超时' })
        expect(error).toBeInstanceOf(StorageNetworkError)
    })

    it('未知错误应使用默认错误类型', () => {
        const error = convertAliyunError({ code: 'UnknownError', message: '未知错误' })
        expect(error).toBeInstanceOf(StorageNetworkError)
    })

    it('可以指定默认错误类型', () => {
        const error = convertAliyunError(
            { code: 'UnknownError', message: '未知错误' },
            StorageUploadError
        )
        expect(error).toBeInstanceOf(StorageUploadError)
    })
})

describe('七牛云错误转换', () => {
    it('612 应转换为 StorageNotFoundError', () => {
        const error = convertQiniuError({ statusCode: 612, message: '文件不存在' })
        expect(error).toBeInstanceOf(StorageNotFoundError)
    })

    it('401 应转换为 StoragePermissionError', () => {
        const error = convertQiniuError({ statusCode: 401, message: '未授权' })
        expect(error).toBeInstanceOf(StoragePermissionError)
    })

    it('403 应转换为 StoragePermissionError', () => {
        const error = convertQiniuError({ statusCode: 403, message: '禁止访问' })
        expect(error).toBeInstanceOf(StoragePermissionError)
    })

    it('未知错误应使用默认错误类型', () => {
        const error = convertQiniuError({ statusCode: 500, message: '服务器错误' })
        expect(error).toBeInstanceOf(StorageNetworkError)
    })
})

describe('腾讯云错误转换', () => {
    it('NoSuchKey 应转换为 StorageNotFoundError', () => {
        const error = convertTencentError({ code: 'NoSuchKey', message: '文件不存在' })
        expect(error).toBeInstanceOf(StorageNotFoundError)
    })

    it('AccessDenied 应转换为 StoragePermissionError', () => {
        const error = convertTencentError({ code: 'AccessDenied', message: '权限不足' })
        expect(error).toBeInstanceOf(StoragePermissionError)
    })

    it('InvalidAccessKeyId 应转换为 StorageConfigError', () => {
        const error = convertTencentError({ code: 'InvalidAccessKeyId', message: '无效的密钥' })
        expect(error).toBeInstanceOf(StorageConfigError)
    })

    it('SignatureDoesNotMatch 应转换为 StorageConfigError', () => {
        const error = convertTencentError({ code: 'SignatureDoesNotMatch', message: '签名不匹配' })
        expect(error).toBeInstanceOf(StorageConfigError)
    })

    it('使用 Code 字段也应正确转换', () => {
        const error = convertTencentError({ Code: 'NoSuchKey', message: '文件不存在' })
        expect(error).toBeInstanceOf(StorageNotFoundError)
    })
})

describe('错误类型判断函数', () => {
    it('isStorageError 应正确判断', () => {
        expect(isStorageError(new StorageError('test', StorageErrorCode.UNKNOWN_ERROR))).toBe(true)
        expect(isStorageError(new StorageConfigError('test'))).toBe(true)
        expect(isStorageError(new Error('test'))).toBe(false)
        expect(isStorageError('test')).toBe(false)
        expect(isStorageError(null)).toBe(false)
    })

    it('isStorageConfigError 应正确判断', () => {
        expect(isStorageConfigError(new StorageConfigError('test'))).toBe(true)
        expect(isStorageConfigError(new StorageError('test', StorageErrorCode.CONFIG_ERROR))).toBe(false)
        expect(isStorageConfigError(new Error('test'))).toBe(false)
    })

    it('isStorageNotFoundError 应正确判断', () => {
        expect(isStorageNotFoundError(new StorageNotFoundError('/path'))).toBe(true)
        expect(isStorageNotFoundError(new StorageError('test', StorageErrorCode.NOT_FOUND))).toBe(false)
        expect(isStorageNotFoundError(new Error('test'))).toBe(false)
    })

    it('isStoragePermissionError 应正确判断', () => {
        expect(isStoragePermissionError(new StoragePermissionError('test'))).toBe(true)
        expect(isStoragePermissionError(new StorageError('test', StorageErrorCode.PERMISSION_DENIED))).toBe(false)
        expect(isStoragePermissionError(new Error('test'))).toBe(false)
    })

    it('isStorageNetworkError 应正确判断', () => {
        expect(isStorageNetworkError(new StorageNetworkError('test'))).toBe(true)
        expect(isStorageNetworkError(new StorageError('test', StorageErrorCode.NETWORK_ERROR))).toBe(false)
        expect(isStorageNetworkError(new Error('test'))).toBe(false)
    })
})

describe('错误继承关系', () => {
    it('所有错误子类都应继承自 StorageError', () => {
        const errors = [
            new StorageConfigError('test'),
            new StorageNotFoundError('/path'),
            new StoragePermissionError('test'),
            new StorageNetworkError('test'),
            new StorageUploadError('test'),
            new StorageDownloadError('test'),
            new StorageDeleteError('test'),
            new StorageSignatureError('test'),
            new StorageStsError('test')
        ]

        for (const error of errors) {
            expect(error).toBeInstanceOf(StorageError)
            expect(error).toBeInstanceOf(Error)
        }
    })
})
