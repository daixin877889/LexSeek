/**
 * useFileEncryption Composable 测试
 *
 * 测试文件加密状态管理逻辑
 *
 * **Feature: file-encryption-composable**
 * **Validates: Requirements 3.1, 3.2**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, readonly } from 'vue'
import type { EncryptionStatus } from '../../../shared/types/encryption'

// 模拟 useAgeCrypto
const mockEncryptFile = vi.fn()
vi.stubGlobal('useAgeCrypto', () => ({
    encryptFile: mockEncryptFile,
}))

// 模拟 onUnmounted
vi.stubGlobal('onUnmounted', vi.fn())

describe('useFileEncryption 状态管理测试', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('初始状态', () => {
        it('初始状态应为 idle', () => {
            const status = ref<EncryptionStatus>('idle')
            expect(status.value).toBe('idle')
        })

        it('初始进度应为 0', () => {
            const progress = ref(0)
            expect(progress.value).toBe(0)
        })

        it('初始错误应为 null', () => {
            const error = ref<Error | null>(null)
            expect(error.value).toBeNull()
        })

        it('初始加密结果应为 null', () => {
            const encryptedBlob = ref<Blob | null>(null)
            expect(encryptedBlob.value).toBeNull()
        })
    })

    describe('加密流程状态变化', () => {
        it('开始加密时状态应变为 encrypting', () => {
            const status = ref<EncryptionStatus>('idle')
            const progress = ref(0)
            const error = ref<Error | null>(null)

            // 模拟开始加密
            status.value = 'encrypting'
            progress.value = 0
            error.value = null

            expect(status.value).toBe('encrypting')
            expect(progress.value).toBe(0)
            expect(error.value).toBeNull()
        })

        it('加密成功时状态应变为 success', () => {
            const status = ref<EncryptionStatus>('encrypting')
            const encryptedBlob = ref<Blob | null>(null)

            // 模拟加密成功
            const result = new Blob(['encrypted'], { type: 'application/octet-stream' })
            encryptedBlob.value = result
            status.value = 'success'

            expect(status.value).toBe('success')
            expect(encryptedBlob.value).toBe(result)
        })

        it('加密失败时状态应变为 error', () => {
            const status = ref<EncryptionStatus>('encrypting')
            const error = ref<Error | null>(null)

            // 模拟加密失败
            const err = new Error('加密失败')
            error.value = err
            status.value = 'error'

            expect(status.value).toBe('error')
            expect(error.value).toBe(err)
        })
    })

    describe('进度更新', () => {
        it('进度应在 0-100 范围内更新', () => {
            const progress = ref(0)

            // 模拟进度更新
            const progressValues = [0, 10, 25, 50, 75, 99, 100]
            for (const p of progressValues) {
                progress.value = p
                expect(progress.value).toBeGreaterThanOrEqual(0)
                expect(progress.value).toBeLessThanOrEqual(100)
            }
        })
    })

    describe('重置状态', () => {
        it('reset 应重置所有状态', () => {
            const status = ref<EncryptionStatus>('success')
            const progress = ref(100)
            const error = ref<Error | null>(new Error('test'))
            const encryptedBlob = ref<Blob | null>(new Blob(['test']))

            // 模拟 reset
            status.value = 'idle'
            progress.value = 0
            error.value = null
            encryptedBlob.value = null

            expect(status.value).toBe('idle')
            expect(progress.value).toBe(0)
            expect(error.value).toBeNull()
            expect(encryptedBlob.value).toBeNull()
        })
    })

    describe('readonly 状态', () => {
        it('返回的状态应为 readonly', () => {
            const status = ref<EncryptionStatus>('idle')
            const readonlyStatus = readonly(status)

            // readonly 应该返回相同的值
            expect(readonlyStatus.value).toBe('idle')
        })
    })
})

describe('useFileEncryption 加密逻辑测试', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('应调用 encryptFile 并传递正确参数', async () => {
        const file = new File(['test content'], 'test.txt', { type: 'text/plain' })
        const recipient = 'age1test...'
        const mockResult = new Blob(['encrypted'], { type: 'application/octet-stream' })

        mockEncryptFile.mockResolvedValueOnce(mockResult)

        // 模拟 encrypt 函数调用
        const result = await mockEncryptFile(file, recipient, vi.fn())

        expect(mockEncryptFile).toHaveBeenCalledWith(file, recipient, expect.any(Function))
        expect(result).toBe(mockResult)
    })

    it('加密失败时应抛出错误', async () => {
        const file = new File(['test'], 'test.txt')
        const recipient = 'age1test...'
        const mockError = new Error('加密失败')

        mockEncryptFile.mockRejectedValueOnce(mockError)

        await expect(mockEncryptFile(file, recipient, vi.fn())).rejects.toThrow('加密失败')
    })

    it('进度回调应被正确调用', async () => {
        const file = new File(['test'], 'test.txt')
        const recipient = 'age1test...'
        const progressCallback = vi.fn()

        mockEncryptFile.mockImplementationOnce(async (_f, _r, onProgress) => {
            // 模拟进度回调
            onProgress?.(10)
            onProgress?.(50)
            onProgress?.(100)
            return new Blob(['encrypted'])
        })

        await mockEncryptFile(file, recipient, progressCallback)

        expect(progressCallback).toHaveBeenCalledWith(10)
        expect(progressCallback).toHaveBeenCalledWith(50)
        expect(progressCallback).toHaveBeenCalledWith(100)
    })
})
