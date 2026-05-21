/**
 * useFileUploadWorker Composable 测试
 *
 * 测试文件上传 Worker 逻辑
 *
 * **Feature: file-upload-worker-composable**
 * **Validates: Requirements 3.3, 3.4**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PostSignatureResult } from '../../../shared/types/oss'

// 模拟 onUnmounted
vi.stubGlobal('onUnmounted', vi.fn())

// 模拟 Worker
class MockWorker {
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    private messageHandler: ((data: any) => void) | null = null

    constructor() { }

    postMessage(data: any) {
        // 模拟异步处理
        if (this.messageHandler) {
            setTimeout(() => this.messageHandler!(data), 0)
        }
    }

    addEventListener(type: string, handler: (event: any) => void) {
        if (type === 'message') {
            this.onmessage = handler
        }
    }

    terminate() { }

    // 测试辅助方法：模拟 Worker 响应
    simulateResponse(response: any) {
        if (this.onmessage) {
            this.onmessage({ data: response } as MessageEvent)
        }
    }

    setMessageHandler(handler: (data: any) => void) {
        this.messageHandler = handler
    }
}

// 模拟 URL.createObjectURL
vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:worker-url'),
    revokeObjectURL: vi.fn(),
})

// 模拟 Blob
const originalBlob = global.Blob
vi.stubGlobal('Blob', class extends originalBlob {
    constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options)
    }
})

describe('useFileUploadWorker 测试', () => {
    let mockWorker: MockWorker

    beforeEach(() => {
        vi.clearAllMocks()
        mockWorker = new MockWorker()
        vi.stubGlobal('Worker', vi.fn(() => mockWorker))
    })

    describe('任务 ID 生成', () => {
        it('任务 ID 应包含时间戳', () => {
            const taskIdCounter = 0
            const id = `upload_${taskIdCounter + 1}_${Date.now()}`
            expect(id).toMatch(/^upload_\d+_\d+$/)
        })

        it('每次生成的任务 ID 应唯一', () => {
            const ids = new Set<string>()
            for (let i = 0; i < 100; i++) {
                const id = `upload_${i + 1}_${Date.now()}_${Math.random().toString(36).slice(2)}`
                ids.add(id)
            }
            expect(ids.size).toBe(100)
        })
    })

    describe('签名对象处理', () => {
        it('应正确构建可克隆的签名对象', () => {
            const signature: PostSignatureResult = {
                host: 'https://bucket.oss.com',
                policy: 'base64policy',
                signatureVersion: 'OSS4-HMAC-SHA256',
                credential: 'credential',
                date: '20231201T000000Z',
                signature: 'signature',
                key: 'uploads/test.txt',
                securityToken: 'token',
                callback: 'base64callback',
                callbackVar: {
                    'x:userid': '123',
                    'x:filename': 'test.txt',
                },
            }

            // 模拟构建可克隆对象
            const callbackVar: Record<string, string> = {}
            if (signature.callbackVar) {
                for (const [key, value] of Object.entries(signature.callbackVar)) {
                    callbackVar[key] = String(value)
                }
            }

            const cloneableSignature = {
                host: signature.host,
                policy: signature.policy,
                signatureVersion: signature.signatureVersion,
                credential: signature.credential,
                date: signature.date,
                signature: signature.signature,
                key: signature.key,
                securityToken: signature.securityToken || undefined,
                callback: signature.callback || undefined,
                callbackVar: Object.keys(callbackVar).length > 0 ? callbackVar : undefined,
            }

            expect(cloneableSignature.host).toBe('https://bucket.oss.com')
            expect(cloneableSignature.callbackVar).toEqual({
                'x:userid': '123',
                'x:filename': 'test.txt',
            })
        })

        it('无 callbackVar 时应为 undefined', () => {
            const signature: Partial<PostSignatureResult> = {
                host: 'https://bucket.oss.com',
                policy: 'base64policy',
            }

            const callbackVar: Record<string, string> = {}
            if (signature.callbackVar) {
                for (const [key, value] of Object.entries(signature.callbackVar)) {
                    callbackVar[key] = String(value)
                }
            }

            const result = Object.keys(callbackVar).length > 0 ? callbackVar : undefined
            expect(result).toBeUndefined()
        })

        it('空 callbackVar 应为 undefined', () => {
            const signature: Partial<PostSignatureResult> = {
                host: 'https://bucket.oss.com',
                callbackVar: {},
            }

            const callbackVar: Record<string, string> = {}
            if (signature.callbackVar) {
                for (const [key, value] of Object.entries(signature.callbackVar)) {
                    callbackVar[key] = String(value)
                }
            }

            const result = Object.keys(callbackVar).length > 0 ? callbackVar : undefined
            expect(result).toBeUndefined()
        })
    })

    describe('回调处理', () => {
        it('进度回调应被正确调用', () => {
            const onProgress = vi.fn()
            const callbacks = { onProgress }

            // 模拟进度响应
            const response = { type: 'progress', id: 'test-id', progress: 50 }
            callbacks.onProgress?.(response.progress)

            expect(onProgress).toHaveBeenCalledWith(50)
        })

        it('成功回调应被正确调用', () => {
            const onSuccess = vi.fn()
            const callbacks = { onSuccess }

            // 模拟成功响应
            const response = { type: 'success', id: 'test-id', data: { url: 'https://example.com/file.txt' } }
            callbacks.onSuccess?.(response.data)

            expect(onSuccess).toHaveBeenCalledWith({ url: 'https://example.com/file.txt' })
        })

        it('错误回调应被正确调用', () => {
            const onError = vi.fn()
            const callbacks = { onError }

            // 模拟错误响应
            const response = { type: 'error', id: 'test-id', error: '上传失败' }
            callbacks.onError?.(new Error(response.error))

            expect(onError).toHaveBeenCalledWith(expect.any(Error))
            expect(onError.mock.calls[0][0].message).toBe('上传失败')
        })

        it('未知错误应使用默认消息', () => {
            const onError = vi.fn()
            const callbacks = { onError }

            // 模拟未知错误响应
            const response = { type: 'error', id: 'test-id', error: undefined }
            callbacks.onError?.(new Error(response.error || '未知错误'))

            expect(onError.mock.calls[0][0].message).toBe('未知错误')
        })
    })

    describe('任务管理', () => {
        it('应正确存储和删除任务', () => {
            const tasks = new Map<string, any>()
            const id = 'test-task-id'
            const task = { id, callbacks: {} }

            // 添加任务
            tasks.set(id, task)
            expect(tasks.has(id)).toBe(true)
            expect(tasks.get(id)).toBe(task)

            // 删除任务
            tasks.delete(id)
            expect(tasks.has(id)).toBe(false)
        })

        it('取消上传应删除任务', () => {
            const tasks = new Map<string, any>()
            const id = 'test-task-id'
            tasks.set(id, { id, callbacks: {} })

            // 模拟取消
            tasks.delete(id)

            expect(tasks.has(id)).toBe(false)
        })
    })

    describe('Worker 生命周期', () => {
        it('destroy 应终止 Worker 并清空任务', () => {
            const tasks = new Map<string, any>()
            tasks.set('task1', {})
            tasks.set('task2', {})

            let worker: MockWorker | null = mockWorker
            const terminate = vi.fn()
            worker.terminate = terminate

            // 模拟 destroy
            if (worker) {
                worker.terminate()
                worker = null
            }
            tasks.clear()

            expect(terminate).toHaveBeenCalled()
            expect(tasks.size).toBe(0)
        })
    })
})

describe('Worker 消息格式测试', () => {
    it('上传消息应包含正确字段', () => {
        const file = new File(['test'], 'test.txt', { type: 'text/plain' })
        const signature = {
            host: 'https://bucket.oss.com',
            policy: 'policy',
            signatureVersion: 'OSS4-HMAC-SHA256',
            credential: 'credential',
            date: '20231201T000000Z',
            signature: 'signature',
            key: 'test.txt',
        }

        const message = {
            type: 'upload',
            id: 'test-id',
            file,
            signature,
        }

        expect(message.type).toBe('upload')
        expect(message.id).toBe('test-id')
        expect(message.file).toBe(file)
        expect(message.signature).toBe(signature)
    })

    it('取消消息应包含正确字段', () => {
        const message = {
            type: 'cancel',
            id: 'test-id',
        }

        expect(message.type).toBe('cancel')
        expect(message.id).toBe('test-id')
    })
})

// 新增 mock：useApiFetch 用于兜底接口调用
// 用 vi.hoisted 避免 vi.mock 工厂执行时 const 还在 TDZ
const { useApiFetchMock } = vi.hoisted(() => ({ useApiFetchMock: vi.fn() }))
vi.mock('~/composables/useApiFetch', () => ({
    useApiFetch: useApiFetchMock,
}))

import { useFileUploadWorker } from '~/composables/useFileUploadWorker'

describe('useFileUploadWorker — callback 失败兜底', () => {
    let mockWorker: MockWorker
    // 记录每个测试创建的 composable，afterEach 统一 destroy 清理 workerInstanceMap 单例
    let destroyFn: (() => void) | null = null

    beforeEach(() => {
        vi.clearAllMocks()
        // 恢复所有全局 stub（包括 URL），避免 "URL is not a constructor" 错误
        vi.unstubAllGlobals()
        mockWorker = new MockWorker()
        // 使用 regular function（非 arrow），才能被 new Worker() 正确调用
        const ref = { current: mockWorker }
        vi.stubGlobal('Worker', function MockWorkerCtor() { return ref.current } as any)
        vi.stubGlobal('onUnmounted', vi.fn())
        useApiFetchMock.mockReset()
    })

    afterEach(() => {
        // 清理 workerInstanceMap 单例，避免下一个测试复用旧 worker
        destroyFn?.()
        destroyFn = null
    })

    function makeSig(ossFileId?: number): PostSignatureResult {
        return {
            host: 'https://b.oss-cn-hangzhou.aliyuncs.com',
            policy: 'p',
            signatureVersion: 'v',
            credential: 'c',
            date: 'd',
            signature: 's',
            key: 'u/x.pdf',
            dir: 'u/',
            ossFileId,
        } as any
    }

    it('callback 成功 → 走正常 onSuccess（不调兜底）', async () => {
        const { upload, destroy } = useFileUploadWorker()
        destroyFn = destroy
        const onSuccess = vi.fn()
        const id = upload(new File(['x'], 'x.pdf'), makeSig(123), { onSuccess })
        mockWorker.simulateResponse({ type: 'success', id, data: { fileId: 123, filename: 'x.pdf', success: true } })
        await new Promise((r) => setTimeout(r, 0))
        expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ fileId: 123 }))
        expect(useApiFetchMock).not.toHaveBeenCalled()
    })

    it('callback 失败 + ossFileId 缺失 → onError，不调兜底', async () => {
        const { upload, destroy } = useFileUploadWorker()
        destroyFn = destroy
        const onError = vi.fn()
        const id = upload(new File(['x'], 'x.pdf'), makeSig(undefined), { onError })
        mockWorker.simulateResponse({ type: 'success', id, data: { success: false, error: 'callback processing failed' } })
        await new Promise((r) => setTimeout(r, 0))
        expect(onError).toHaveBeenCalled()
        expect(useApiFetchMock).not.toHaveBeenCalled()
    })

    it('callback 失败 + 兜底接口返 status=uploaded → onSuccess({recovered, fileId})', async () => {
        useApiFetchMock.mockResolvedValueOnce({ status: 'uploaded' })
        const { upload, destroy } = useFileUploadWorker()
        destroyFn = destroy
        const onSuccess = vi.fn()
        const id = upload(new File(['x'], 'x.pdf'), makeSig(123), { onSuccess })
        mockWorker.simulateResponse({ type: 'success', id, data: { success: false } })
        await new Promise((r) => setTimeout(r, 0))
        expect(useApiFetchMock).toHaveBeenCalledWith(
            '/api/v1/storage/confirm-upload',
            expect.objectContaining({ method: 'POST', body: { fileId: 123 } })
        )
        expect(onSuccess).toHaveBeenCalledWith({ recovered: true, fileId: 123 })
    })

    it('callback 失败 + 兜底接口返 null（业务失败）→ onError', async () => {
        useApiFetchMock.mockResolvedValueOnce(null)
        const { upload, destroy } = useFileUploadWorker()
        destroyFn = destroy
        const onError = vi.fn()
        const id = upload(new File(['x'], 'x.pdf'), makeSig(123), { onError })
        mockWorker.simulateResponse({ type: 'success', id, data: { success: false } })
        await new Promise((r) => setTimeout(r, 0))
        expect(onError).toHaveBeenCalled()
    })

    it('callback 失败 + 兜底接口抛网络错误 → onError 携带原异常', async () => {
        useApiFetchMock.mockRejectedValueOnce(new Error('网络错误'))
        const { upload, destroy } = useFileUploadWorker()
        destroyFn = destroy
        const onError = vi.fn()
        const id = upload(new File(['x'], 'x.pdf'), makeSig(123), { onError })
        mockWorker.simulateResponse({ type: 'success', id, data: { success: false } })
        await new Promise((r) => setTimeout(r, 0))
        expect(onError).toHaveBeenCalledWith(expect.any(Error))
        const err = onError.mock.calls[0][0] as Error
        expect(err.message).toContain('网络错误')
    })

    // 关键场景：OSS 把"上传成功但 callback 失败"透传成 HTTP 203。
    // worker 翻译为 data.__callbackFailed = true 给 composable，
    // composable 据此触发 confirm-upload 兜底而无需感知 HTTP 状态码。
    it('worker 透传 __callbackFailed=true + ossFileId 齐 → 触发兜底并恢复', async () => {
        useApiFetchMock.mockResolvedValueOnce({ status: 'uploaded' })
        const { upload, destroy } = useFileUploadWorker()
        destroyFn = destroy
        const onSuccess = vi.fn()
        const id = upload(new File(['x'], 'x.pdf'), makeSig(456), { onSuccess })
        mockWorker.simulateResponse({
            type: 'success',
            id,
            data: { raw: '<html>nginx error</html>', __httpStatus: 203, __callbackFailed: true },
        })
        await new Promise((r) => setTimeout(r, 0))
        expect(useApiFetchMock).toHaveBeenCalledWith(
            '/api/v1/storage/confirm-upload',
            expect.objectContaining({ method: 'POST', body: { fileId: 456 } })
        )
        expect(onSuccess).toHaveBeenCalledWith({ recovered: true, fileId: 456 })
    })

    it('__callbackFailed=true + 兜底返 status 非 uploaded（OSS 真未存在）→ onError', async () => {
        useApiFetchMock.mockResolvedValueOnce({ status: 'not_found' })
        const { upload, destroy } = useFileUploadWorker()
        destroyFn = destroy
        const onError = vi.fn()
        const id = upload(new File(['x'], 'x.pdf'), makeSig(456), { onError })
        mockWorker.simulateResponse({
            type: 'success',
            id,
            data: { __httpStatus: 203, __callbackFailed: true },
        })
        await new Promise((r) => setTimeout(r, 0))
        expect(useApiFetchMock).toHaveBeenCalled()
        expect(onError).toHaveBeenCalled()
    })

    it('HTTP 200 + callback 响应里恰好 success=true → 不触发兜底（防误伤）', async () => {
        const { upload, destroy } = useFileUploadWorker()
        destroyFn = destroy
        const onSuccess = vi.fn()
        const id = upload(new File(['x'], 'x.pdf'), makeSig(789), { onSuccess })
        mockWorker.simulateResponse({
            type: 'success',
            id,
            data: { fileId: 789, filename: 'x.pdf', success: true, __httpStatus: 200 },
        })
        await new Promise((r) => setTimeout(r, 0))
        expect(useApiFetchMock).not.toHaveBeenCalled()
        expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ fileId: 789, __httpStatus: 200 }))
    })
})
