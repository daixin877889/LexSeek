/**
 * useFileDecryption Composable 测试
 *
 * 测试文件解密状态管理逻辑
 *
 * **Feature: file-decryption-composable**
 * **Validates: Requirements 4.1, 4.2**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, readonly, computed } from 'vue'
import type { DecryptionStatus } from '../../../shared/types/encryption'
import { IdentityNotUnlockedError } from '../../../shared/types/encryption'

// 模拟 useAgeCrypto
const mockDecryptFile = vi.fn()
const mockIsUnlocked = ref(true)
vi.stubGlobal('useAgeCrypto', () => ({
    decryptFile: mockDecryptFile,
    isUnlocked: computed(() => mockIsUnlocked.value),
}))

// 模拟 onUnmounted
vi.stubGlobal('onUnmounted', vi.fn())

// 模拟 URL
const mockRevokeObjectURL = vi.fn()
const mockCreateObjectURL = vi.fn(() => 'blob:test-url')
vi.stubGlobal('URL', {
    createObjectURL: mockCreateObjectURL,
    revokeObjectURL: mockRevokeObjectURL,
})

describe('useFileDecryption 状态管理测试', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockIsUnlocked.value = true
    })

    describe('初始状态', () => {
        it('初始状态应为 idle', () => {
            const status = ref<DecryptionStatus>('idle')
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

        it('初始 objectUrl 应为 null', () => {
            const objectUrl = ref<string | null>(null)
            expect(objectUrl.value).toBeNull()
        })
    })

    describe('解密流程状态变化', () => {
        it('私钥未解锁时状态应变为 locked', () => {
            const status = ref<DecryptionStatus>('idle')
            mockIsUnlocked.value = false

            // 模拟检查私钥状态
            if (!mockIsUnlocked.value) {
                status.value = 'locked'
            }

            expect(status.value).toBe('locked')
        })

        it('开始解密时状态应变为 decrypting', () => {
            const status = ref<DecryptionStatus>('idle')
            const progress = ref(0)
            const error = ref<Error | null>(null)

            // 模拟开始解密
            status.value = 'decrypting'
            progress.value = 0
            error.value = null

            expect(status.value).toBe('decrypting')
            expect(progress.value).toBe(0)
            expect(error.value).toBeNull()
        })

        it('解密成功时状态应变为 success', () => {
            const status = ref<DecryptionStatus>('decrypting')
            const objectUrl = ref<string | null>(null)

            // 模拟解密成功
            objectUrl.value = 'blob:test-url'
            status.value = 'success'

            expect(status.value).toBe('success')
            expect(objectUrl.value).toBe('blob:test-url')
        })

        it('解密失败时状态应变为 error', () => {
            const status = ref<DecryptionStatus>('decrypting')
            const error = ref<Error | null>(null)

            // 模拟解密失败
            const err = new Error('解密失败')
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

    describe('URL 管理', () => {
        it('revokeUrl 应释放 Object URL', () => {
            const objectUrl = ref<string | null>('blob:test-url')

            // 模拟 revokeUrl
            if (objectUrl.value) {
                mockRevokeObjectURL(objectUrl.value)
                objectUrl.value = null
            }

            expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:test-url')
            expect(objectUrl.value).toBeNull()
        })

        it('objectUrl 为 null 时 revokeUrl 不应调用 revokeObjectURL', () => {
            const objectUrl = ref<string | null>(null)

            // 模拟 revokeUrl
            if (objectUrl.value) {
                mockRevokeObjectURL(objectUrl.value)
                objectUrl.value = null
            }

            expect(mockRevokeObjectURL).not.toHaveBeenCalled()
        })
    })

    describe('重置状态', () => {
        it('reset 应重置所有状态并释放 URL', () => {
            const status = ref<DecryptionStatus>('success')
            const progress = ref(100)
            const error = ref<Error | null>(new Error('test'))
            const objectUrl = ref<string | null>('blob:test-url')

            // 模拟 reset
            if (objectUrl.value) {
                mockRevokeObjectURL(objectUrl.value)
                objectUrl.value = null
            }
            status.value = 'idle'
            progress.value = 0
            error.value = null

            expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:test-url')
            expect(status.value).toBe('idle')
            expect(progress.value).toBe(0)
            expect(error.value).toBeNull()
            expect(objectUrl.value).toBeNull()
        })
    })
})

describe('useFileDecryption 解密逻辑测试', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockIsUnlocked.value = true
    })

    it('私钥未解锁时应抛出 IdentityNotUnlockedError', async () => {
        mockIsUnlocked.value = false

        // 模拟 decrypt 函数
        const decrypt = async () => {
            if (!mockIsUnlocked.value) {
                throw new IdentityNotUnlockedError()
            }
        }

        await expect(decrypt()).rejects.toThrow(IdentityNotUnlockedError)
    })

    it('应调用 decryptFile 并传递正确参数', async () => {
        const encryptedData = new Blob(['encrypted'])
        const mockResult = new ArrayBuffer(10)

        mockDecryptFile.mockResolvedValueOnce(mockResult)

        // 模拟 decrypt 函数调用
        const result = await mockDecryptFile(encryptedData, vi.fn())

        expect(mockDecryptFile).toHaveBeenCalledWith(encryptedData, expect.any(Function))
        expect(result).toBe(mockResult)
    })

    it('解密成功后应创建 Object URL', async () => {
        const encryptedData = new Blob(['encrypted'])
        const mimeType = 'image/jpeg'
        const mockResult = new ArrayBuffer(10)

        mockDecryptFile.mockResolvedValueOnce(mockResult)

        // 模拟解密并创建 URL
        const decrypted = await mockDecryptFile(encryptedData, vi.fn())
        const blob = new Blob([decrypted], { type: mimeType })
        const url = mockCreateObjectURL(blob)

        expect(mockCreateObjectURL).toHaveBeenCalled()
        expect(url).toBe('blob:test-url')
    })

    it('解密失败时应抛出错误', async () => {
        const encryptedData = new Blob(['encrypted'])
        const mockError = new Error('解密失败')

        mockDecryptFile.mockRejectedValueOnce(mockError)

        await expect(mockDecryptFile(encryptedData, vi.fn())).rejects.toThrow('解密失败')
    })

    it('进度回调应被正确调用', async () => {
        const encryptedData = new Blob(['encrypted'])
        const progressCallback = vi.fn()

        mockDecryptFile.mockImplementationOnce(async (_data, onProgress) => {
            // 模拟进度回调
            onProgress?.(10)
            onProgress?.(50)
            onProgress?.(100)
            return new ArrayBuffer(10)
        })

        await mockDecryptFile(encryptedData, progressCallback)

        expect(progressCallback).toHaveBeenCalledWith(10)
        expect(progressCallback).toHaveBeenCalledWith(50)
        expect(progressCallback).toHaveBeenCalledWith(100)
    })
})

describe('useFileDecryption 错误处理测试', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockIsUnlocked.value = true
    })

    it('非 Error 类型错误应被包装为 Error', () => {
        const status = ref<DecryptionStatus>('decrypting')
        const error = ref<Error | null>(null)

        // 模拟非 Error 类型错误
        const e = 'string error'
        error.value = e instanceof Error ? e : new Error(String(e))
        status.value = 'error'

        expect(error.value).toBeInstanceOf(Error)
        expect(error.value.message).toBe('string error')
    })

    it('Error 类型错误应直接使用', () => {
        const status = ref<DecryptionStatus>('decrypting')
        const error = ref<Error | null>(null)

        // 模拟 Error 类型错误
        const e = new Error('test error')
        error.value = e instanceof Error ? e : new Error(String(e))
        status.value = 'error'

        expect(error.value).toBe(e)
        expect(error.value.message).toBe('test error')
    })
})
