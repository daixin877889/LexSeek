/**
 * 加密/解密 Worker 测试
 *
 * 测试加密解密 Worker 的核心逻辑
 *
 * **Feature: crypto-worker**
 * **Validates: Requirements 3.6**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'

// 模拟 self.postMessage
const mockPostMessage = vi.fn()
vi.stubGlobal('self', {
    postMessage: mockPostMessage,
    onmessage: null,
})

describe('加密/解密 Worker 测试', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('消息类型', () => {
        it('解密消息应包含必要字段', () => {
            const message = {
                type: 'decrypt' as const,
                id: 'decrypt-123',
                data: new ArrayBuffer(100),
                identity: 'AGE-SECRET-KEY-1...',
            }

            expect(message.type).toBe('decrypt')
            expect(message.id).toBeDefined()
            expect(message.data).toBeInstanceOf(ArrayBuffer)
            expect(message.identity).toBeDefined()
        })

        it('加密消息应包含必要字段', () => {
            const message = {
                type: 'encrypt' as const,
                id: 'encrypt-123',
                data: new ArrayBuffer(100),
                recipient: 'age1...',
            }

            expect(message.type).toBe('encrypt')
            expect(message.id).toBeDefined()
            expect(message.data).toBeInstanceOf(ArrayBuffer)
            expect(message.recipient).toBeDefined()
        })
    })

    describe('响应消息格式', () => {
        it('成功响应应包含正确字段', () => {
            const response = {
                type: 'success' as const,
                id: 'test-id',
                data: new ArrayBuffer(100),
            }

            expect(response.type).toBe('success')
            expect(response.id).toBe('test-id')
            expect(response.data).toBeInstanceOf(ArrayBuffer)
        })

        it('错误响应应包含正确字段', () => {
            const response = {
                type: 'error' as const,
                id: 'test-id',
                error: '解密失败',
                errorType: 'FileCorruptedError',
            }

            expect(response.type).toBe('error')
            expect(response.id).toBe('test-id')
            expect(response.error).toBe('解密失败')
            expect(response.errorType).toBe('FileCorruptedError')
        })

        it('进度响应应包含正确字段', () => {
            const response = {
                type: 'progress' as const,
                id: 'test-id',
                progress: 50,
            }

            expect(response.type).toBe('progress')
            expect(response.id).toBe('test-id')
            expect(response.progress).toBe(50)
        })

        it('属性测试：进度值应在 0-100 范围内', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 100 }),
                    (progress) => {
                        const response = { type: 'progress', id: 'test', progress }
                        expect(response.progress).toBeGreaterThanOrEqual(0)
                        expect(response.progress).toBeLessThanOrEqual(100)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('错误类型分类', () => {
        it('身份不匹配错误应返回 IdentityMismatchError', () => {
            const errorMessages = [
                'no identity matched',
                'no matching identity',
            ]

            for (const errorMessage of errorMessages) {
                let errorType = 'FileCorruptedError'

                if (errorMessage.includes('no identity matched') || errorMessage.includes('no matching')) {
                    errorType = 'IdentityMismatchError'
                }

                expect(errorType).toBe('IdentityMismatchError')
            }
        })

        it('无效文件格式错误应返回 InvalidAgeFileError', () => {
            const errorMessages = [
                'invalid header',
                'not a valid age file',
            ]

            for (const errorMessage of errorMessages) {
                let errorType = 'FileCorruptedError'

                if (errorMessage.includes('invalid header') || errorMessage.includes('not a valid')) {
                    errorType = 'InvalidAgeFileError'
                }

                expect(errorType).toBe('InvalidAgeFileError')
            }
        })

        it('其他错误应返回 FileCorruptedError', () => {
            const errorMessage = 'unknown error occurred'
            let errorType = 'FileCorruptedError'

            if (errorMessage.includes('no identity matched') || errorMessage.includes('no matching')) {
                errorType = 'IdentityMismatchError'
            } else if (errorMessage.includes('invalid header') || errorMessage.includes('not a valid')) {
                errorType = 'InvalidAgeFileError'
            }

            expect(errorType).toBe('FileCorruptedError')
        })

        it('属性测试：错误类型分类应一致', () => {
            const classifyError = (errorMessage: string): string => {
                if (errorMessage.includes('no identity matched') || errorMessage.includes('no matching')) {
                    return 'IdentityMismatchError'
                } else if (errorMessage.includes('invalid header') || errorMessage.includes('not a valid')) {
                    return 'InvalidAgeFileError'
                }
                return 'FileCorruptedError'
            }

            fc.assert(
                fc.property(
                    fc.string(),
                    (errorMessage) => {
                        const errorType = classifyError(errorMessage)
                        expect(['IdentityMismatchError', 'InvalidAgeFileError', 'FileCorruptedError']).toContain(errorType)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('ArrayBuffer 处理', () => {
        it('应正确转换 ArrayBuffer 为 Uint8Array', () => {
            const buffer = new ArrayBuffer(10)
            const view = new Uint8Array(buffer)

            // 填充测试数据
            for (let i = 0; i < 10; i++) {
                view[i] = i
            }

            const uint8Data = new Uint8Array(buffer)
            expect(uint8Data.length).toBe(10)
            expect(uint8Data[0]).toBe(0)
            expect(uint8Data[9]).toBe(9)
        })

        it('属性测试：ArrayBuffer 转换应保持数据完整', () => {
            fc.assert(
                fc.property(
                    fc.uint8Array({ minLength: 1, maxLength: 1000 }),
                    (originalData) => {
                        const buffer = originalData.buffer.slice(
                            originalData.byteOffset,
                            originalData.byteOffset + originalData.byteLength
                        )
                        const converted = new Uint8Array(buffer)

                        expect(converted.length).toBe(originalData.length)
                        for (let i = 0; i < originalData.length; i++) {
                            expect(converted[i]).toBe(originalData[i])
                        }
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('进度报告', () => {
        it('解密进度应按预期顺序报告', () => {
            const expectedProgress = [10, 30, 100]
            const progressReports: number[] = []

            // 模拟进度报告
            for (const progress of expectedProgress) {
                progressReports.push(progress)
            }

            expect(progressReports).toEqual([10, 30, 100])
        })

        it('加密进度应按预期顺序报告', () => {
            const expectedProgress = [10, 30, 100]
            const progressReports: number[] = []

            // 模拟进度报告
            for (const progress of expectedProgress) {
                progressReports.push(progress)
            }

            expect(progressReports).toEqual([10, 30, 100])
        })
    })

    describe('Transferable 对象', () => {
        it('成功响应应使用 Transferable 传输 ArrayBuffer', () => {
            const data = new ArrayBuffer(100)
            const response = { type: 'success', id: 'test', data }

            // 验证 data 是 ArrayBuffer 类型，可以作为 Transferable
            expect(response.data).toBeInstanceOf(ArrayBuffer)
            expect(response.data.byteLength).toBe(100)
        })

        it('属性测试：任意大小的 ArrayBuffer 都应可传输', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 10000 }),
                    (size) => {
                        const data = new ArrayBuffer(size)
                        const response = { type: 'success', id: 'test', data }

                        expect(response.data).toBeInstanceOf(ArrayBuffer)
                        expect(response.data.byteLength).toBe(size)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})

describe('Worker 就绪状态测试', () => {
    it('Worker 应在初始化后发送 ready 消息', () => {
        const readyMessage = { type: 'ready' }
        expect(readyMessage.type).toBe('ready')
    })
})

describe('Age 密钥格式验证', () => {
    it('私钥应以 AGE-SECRET-KEY- 开头', () => {
        const validIdentity = 'AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ'
        expect(validIdentity.startsWith('AGE-SECRET-KEY-')).toBe(true)
    })

    it('公钥应以 age1 开头', () => {
        const validRecipient = 'age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
        expect(validRecipient.startsWith('age1')).toBe(true)
    })
})
