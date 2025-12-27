/**
 * OSS 错误类测试
 *
 * 测试 OSS 模块中定义的各种错误类
 *
 * **Feature: storage-system**
 * **Validates: Requirements 10.4**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
    OssConfigError,
    OssStsError,
    OssNotFoundError,
    OssUploadError,
    OssDownloadError,
    OssDeleteError,
    OssNetworkError
} from '../../../server/lib/oss/errors'

describe('OSS 错误类', () => {
    describe('OssConfigError', () => {
        it('应正确设置错误名称和消息', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (message) => {
                        const error = new OssConfigError(message)
                        expect(error.name).toBe('OssConfigError')
                        expect(error.message).toBe(message)
                        expect(error).toBeInstanceOf(Error)
                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('OssStsError', () => {
        it('应正确设置错误名称和消息', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (message) => {
                        const error = new OssStsError(message)
                        expect(error.name).toBe('OssStsError')
                        expect(error.message).toBe(message)
                        expect(error).toBeInstanceOf(Error)
                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('OssNotFoundError', () => {
        it('应正确设置错误名称和消息', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (objectPath) => {
                        const error = new OssNotFoundError(objectPath)
                        expect(error.name).toBe('OssNotFoundError')
                        expect(error.message).toBe(`Object not found: ${objectPath}`)
                        expect(error).toBeInstanceOf(Error)
                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('OssUploadError', () => {
        it('应正确设置错误名称和消息', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (detail) => {
                        const error = new OssUploadError(detail)
                        expect(error.name).toBe('OssUploadError')
                        expect(error.message).toBe(`Upload failed: ${detail}`)
                        expect(error).toBeInstanceOf(Error)
                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('OssDownloadError', () => {
        it('应正确设置错误名称和消息', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (detail) => {
                        const error = new OssDownloadError(detail)
                        expect(error.name).toBe('OssDownloadError')
                        expect(error.message).toBe(`Download failed: ${detail}`)
                        expect(error).toBeInstanceOf(Error)
                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('OssDeleteError', () => {
        it('应正确设置错误名称和消息', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (detail) => {
                        const error = new OssDeleteError(detail)
                        expect(error.name).toBe('OssDeleteError')
                        expect(error.message).toBe(`Delete failed: ${detail}`)
                        expect(error).toBeInstanceOf(Error)
                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('OssNetworkError', () => {
        it('应正确设置错误名称和消息', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (detail) => {
                        const error = new OssNetworkError(detail)
                        expect(error.name).toBe('OssNetworkError')
                        expect(error.message).toBe(`Network error: ${detail}`)
                        expect(error).toBeInstanceOf(Error)
                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('错误继承关系', () => {
        it('所有错误类都应继承自 Error', () => {
            const errors = [
                new OssConfigError('test'),
                new OssStsError('test'),
                new OssNotFoundError('test'),
                new OssUploadError('test'),
                new OssDownloadError('test'),
                new OssDeleteError('test'),
                new OssNetworkError('test')
            ]

            for (const error of errors) {
                expect(error).toBeInstanceOf(Error)
            }
        })

        it('错误应可被 try-catch 捕获', () => {
            const errorClasses = [
                () => { throw new OssConfigError('test') },
                () => { throw new OssStsError('test') },
                () => { throw new OssNotFoundError('test') },
                () => { throw new OssUploadError('test') },
                () => { throw new OssDownloadError('test') },
                () => { throw new OssDeleteError('test') },
                () => { throw new OssNetworkError('test') }
            ]

            for (const throwError of errorClasses) {
                expect(throwError).toThrow(Error)
            }
        })
    })
})
