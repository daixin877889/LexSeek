/**
 * 存储适配器错误处理属性测试
 *
 * 使用 fast-check 进行属性测试，验证统一错误处理机制
 * Feature: storage-adapter, Property 3: 统一错误处理
 * Validates: Requirements 1.7, 8.1, 8.2, 8.3
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
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

/**
 * Property 3: 统一错误处理
 * 对于任意适配器在操作失败时，必须抛出继承自 StorageError 的错误类型，
 * 且错误对象必须包含 code、message 和 cause 属性
 */
describe('Property 3: 统一错误处理', () => {
    /**
     * 所有错误类型列表
     */
    const errorClasses = [
        { Class: StorageError, code: StorageErrorCode.UNKNOWN_ERROR },
        { Class: StorageConfigError, code: StorageErrorCode.CONFIG_ERROR },
        { Class: StorageNotFoundError, code: StorageErrorCode.NOT_FOUND, needsPath: true },
        { Class: StoragePermissionError, code: StorageErrorCode.PERMISSION_DENIED },
        { Class: StorageNetworkError, code: StorageErrorCode.NETWORK_ERROR },
        { Class: StorageUploadError, code: StorageErrorCode.UPLOAD_ERROR },
        { Class: StorageDownloadError, code: StorageErrorCode.DOWNLOAD_ERROR },
        { Class: StorageDeleteError, code: StorageErrorCode.DELETE_ERROR },
        { Class: StorageSignatureError, code: StorageErrorCode.SIGNATURE_ERROR },
        { Class: StorageStsError, code: StorageErrorCode.STS_ERROR }
    ]

    describe('错误基类属性', () => {
        it('所有错误类型都应继承自 StorageError', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (message) => {
                        for (const { Class, needsPath } of errorClasses) {
                            let error: StorageError
                            if (needsPath) {
                                error = new (Class as typeof StorageNotFoundError)(message)
                            } else if (Class === StorageError) {
                                error = new Class(message, StorageErrorCode.UNKNOWN_ERROR)
                            } else {
                                error = new (Class as typeof StorageConfigError)(message)
                            }
                            expect(error).toBeInstanceOf(StorageError)
                            expect(error).toBeInstanceOf(Error)
                        }
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('所有错误对象都应包含 code 属性', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (message) => {
                        for (const { Class, code, needsPath } of errorClasses) {
                            let error: StorageError
                            if (needsPath) {
                                error = new (Class as typeof StorageNotFoundError)(message)
                            } else if (Class === StorageError) {
                                error = new Class(message, code)
                            } else {
                                error = new (Class as typeof StorageConfigError)(message)
                            }
                            expect(error.code).toBeDefined()
                            expect(typeof error.code).toBe('string')
                            expect(Object.values(StorageErrorCode)).toContain(error.code)
                        }
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('所有错误对象都应包含 message 属性', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (message) => {
                        for (const { Class, needsPath } of errorClasses) {
                            let error: StorageError
                            if (needsPath) {
                                error = new (Class as typeof StorageNotFoundError)(message)
                            } else if (Class === StorageError) {
                                error = new Class(message, StorageErrorCode.UNKNOWN_ERROR)
                            } else {
                                error = new (Class as typeof StorageConfigError)(message)
                            }
                            expect(error.message).toBeDefined()
                            expect(typeof error.message).toBe('string')
                            expect(error.message.length).toBeGreaterThan(0)
                        }
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('所有错误对象都应支持 cause 属性', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (message, causeMessage) => {
                        const cause = new Error(causeMessage)

                        for (const { Class, needsPath } of errorClasses) {
                            let error: StorageError
                            if (needsPath) {
                                error = new (Class as typeof StorageNotFoundError)(message, cause)
                            } else if (Class === StorageError) {
                                error = new Class(message, StorageErrorCode.UNKNOWN_ERROR, cause)
                            } else {
                                error = new (Class as typeof StorageConfigError)(message, cause)
                            }
                            expect(error.cause).toBe(cause)
                        }
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('错误码正确性', () => {
        it('StorageConfigError 应使用 CONFIG_ERROR 错误码', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (message) => {
                        const error = new StorageConfigError(message)
                        expect(error.code).toBe(StorageErrorCode.CONFIG_ERROR)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('StorageNotFoundError 应使用 NOT_FOUND 错误码', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (path) => {
                        const error = new StorageNotFoundError(path)
                        expect(error.code).toBe(StorageErrorCode.NOT_FOUND)
                        expect(error.path).toBe(path)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('StoragePermissionError 应使用 PERMISSION_DENIED 错误码', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (message) => {
                        const error = new StoragePermissionError(message)
                        expect(error.code).toBe(StorageErrorCode.PERMISSION_DENIED)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('StorageNetworkError 应使用 NETWORK_ERROR 错误码', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (message) => {
                        const error = new StorageNetworkError(message)
                        expect(error.code).toBe(StorageErrorCode.NETWORK_ERROR)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('错误转换', () => {
        it('阿里云 NoSuchKey 错误应转换为 StorageNotFoundError', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (message) => {
                        const aliyunError = { code: 'NoSuchKey', message }
                        const error = convertAliyunError(aliyunError)
                        expect(error).toBeInstanceOf(StorageNotFoundError)
                        expect(error.code).toBe(StorageErrorCode.NOT_FOUND)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('阿里云 AccessDenied 错误应转换为 StoragePermissionError', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (message) => {
                        const aliyunError = { code: 'AccessDenied', message }
                        const error = convertAliyunError(aliyunError)
                        expect(error).toBeInstanceOf(StoragePermissionError)
                        expect(error.code).toBe(StorageErrorCode.PERMISSION_DENIED)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('阿里云 InvalidAccessKeyId 错误应转换为 StorageConfigError', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (message) => {
                        const aliyunError = { code: 'InvalidAccessKeyId', message }
                        const error = convertAliyunError(aliyunError)
                        expect(error).toBeInstanceOf(StorageConfigError)
                        expect(error.code).toBe(StorageErrorCode.CONFIG_ERROR)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('七牛云 612 错误应转换为 StorageNotFoundError', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (message) => {
                        const qiniuError = { statusCode: 612, message }
                        const error = convertQiniuError(qiniuError)
                        expect(error).toBeInstanceOf(StorageNotFoundError)
                        expect(error.code).toBe(StorageErrorCode.NOT_FOUND)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('七牛云 401/403 错误应转换为 StoragePermissionError', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(401, 403),
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (statusCode, message) => {
                        const qiniuError = { statusCode, message }
                        const error = convertQiniuError(qiniuError)
                        expect(error).toBeInstanceOf(StoragePermissionError)
                        expect(error.code).toBe(StorageErrorCode.PERMISSION_DENIED)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('腾讯云 NoSuchKey 错误应转换为 StorageNotFoundError', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (message) => {
                        const tencentError = { code: 'NoSuchKey', message }
                        const error = convertTencentError(tencentError)
                        expect(error).toBeInstanceOf(StorageNotFoundError)
                        expect(error.code).toBe(StorageErrorCode.NOT_FOUND)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('腾讯云 AccessDenied 错误应转换为 StoragePermissionError', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (message) => {
                        const tencentError = { code: 'AccessDenied', message }
                        const error = convertTencentError(tencentError)
                        expect(error).toBeInstanceOf(StoragePermissionError)
                        expect(error.code).toBe(StorageErrorCode.PERMISSION_DENIED)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('类型守卫', () => {
        it('isStorageError 应正确识别 StorageError 实例', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (message) => {
                        const storageError = new StorageError(message, StorageErrorCode.UNKNOWN_ERROR)
                        const normalError = new Error(message)

                        expect(isStorageError(storageError)).toBe(true)
                        expect(isStorageError(normalError)).toBe(false)
                        expect(isStorageError(null)).toBe(false)
                        expect(isStorageError(undefined)).toBe(false)
                        expect(isStorageError(message)).toBe(false)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('isStorageConfigError 应正确识别 StorageConfigError 实例', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (message) => {
                        const configError = new StorageConfigError(message)
                        const notFoundError = new StorageNotFoundError(message)

                        expect(isStorageConfigError(configError)).toBe(true)
                        expect(isStorageConfigError(notFoundError)).toBe(false)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('isStorageNotFoundError 应正确识别 StorageNotFoundError 实例', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (path) => {
                        const notFoundError = new StorageNotFoundError(path)
                        const configError = new StorageConfigError(path)

                        expect(isStorageNotFoundError(notFoundError)).toBe(true)
                        expect(isStorageNotFoundError(configError)).toBe(false)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('isStoragePermissionError 应正确识别 StoragePermissionError 实例', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (message) => {
                        const permissionError = new StoragePermissionError(message)
                        const networkError = new StorageNetworkError(message)

                        expect(isStoragePermissionError(permissionError)).toBe(true)
                        expect(isStoragePermissionError(networkError)).toBe(false)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('isStorageNetworkError 应正确识别 StorageNetworkError 实例', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (message) => {
                        const networkError = new StorageNetworkError(message)
                        const uploadError = new StorageUploadError(message)

                        expect(isStorageNetworkError(networkError)).toBe(true)
                        expect(isStorageNetworkError(uploadError)).toBe(false)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('toJSON 序列化', () => {
        it('所有错误对象都应能正确序列化为 JSON', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (message, causeMessage) => {
                        const cause = new Error(causeMessage)
                        const error = new StorageConfigError(message, cause)
                        const json = error.toJSON()

                        expect(json).toHaveProperty('name')
                        expect(json).toHaveProperty('code')
                        expect(json).toHaveProperty('message')
                        expect(json).toHaveProperty('cause')
                        expect(json.name).toBe('StorageConfigError')
                        expect(json.code).toBe(StorageErrorCode.CONFIG_ERROR)
                        expect(json.message).toBe(message)
                        expect(json.cause).toBe(causeMessage)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('StorageNotFoundError 序列化应包含 path 属性', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (path) => {
                        const error = new StorageNotFoundError(path)
                        const json = error.toJSON()

                        expect(json).toHaveProperty('path')
                        expect(json.path).toBe(path)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})
