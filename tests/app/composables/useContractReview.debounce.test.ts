/**
 * useContractReview.onEditRisks 真实 debounce 500ms 节流验证
 *
 * 单独文件：不 mock @vueuse/core，使用 vi.useFakeTimers 推进虚拟时间。
 * 其他行为测试见 useContractReview.test.ts。
 *
 * **Feature: contract-review-m5**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shallowRef } from 'vue'

// ── mock @langchain/vue（同 useContractReview.test.ts）─────────────────────

const mockStreamSubmit = vi.fn()
const mockStreamStop = vi.fn().mockResolvedValue(undefined)
const mockStreamValues = shallowRef<any>(undefined)
const mockStreamMessages = shallowRef<any[]>([])
const mockStreamIsLoading = shallowRef(false)

vi.mock('@langchain/vue', () => ({
    FetchStreamTransport: vi.fn().mockImplementation(function () { return {} }),
    useStream: vi.fn((_opts: any) => {
        const obj: Record<string, any> = {
            isLoading: mockStreamIsLoading,
            error: shallowRef(null),
            submit: mockStreamSubmit,
            stop: mockStreamStop,
            getMessagesMetadata: vi.fn(),
        }
        Object.defineProperty(obj, 'values', { get() { return mockStreamValues.value }, enumerable: true })
        Object.defineProperty(obj, 'messages', { get() { return mockStreamMessages.value }, enumerable: true })
        return obj
    }),
}))

// ── mock toast ─────────────────────────────────────────────────────────────

vi.mock('vue-sonner', () => ({
    toast: {
        info: vi.fn(),
        success: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
    },
}))

// ── mock useApiFetch ───────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({
    useApiFetch: (...args: unknown[]) => mockFetch(...args),
}))

// ── 不 mock @vueuse/core：测试真实 useDebounceFn 节流 ────────────────────

const { useContractReview } = await import('~/composables/useContractReview')

describe('useContractReview.onEditRisks debounce 500ms 节流', () => {
    beforeEach(() => {
        mockFetch.mockReset()
        mockStreamSubmit.mockReset()
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('连续 3 次 50ms 内调用只发 1 次 PATCH（末次参数）', async () => {
        // 先 mountReview 准备 reviewId
        mockFetch.mockResolvedValueOnce({
            review: {
                id: 100,
                sessionId: 's-100',
                status: 'completed',
                contractType: null,
                partyA: null,
                partyB: null,
                stance: null,
                risks: [],
                summary: null,
                originalFileId: 1,
                reviewedFileId: 2,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        const c = useContractReview()
        await c.mountReview(100)
        mockFetch.mockReset()
        mockFetch.mockResolvedValueOnce({ reviewId: 100 })

        // 连续 3 次调用，间隔 50ms
        const r1 = [{ id: 'r1' }] as any
        const r2 = [{ id: 'r2' }] as any
        const r3 = [{ id: 'r3' }] as any
        c.onEditRisks(r1)
        await vi.advanceTimersByTimeAsync(50)
        c.onEditRisks(r2)
        await vi.advanceTimersByTimeAsync(50)
        c.onEditRisks(r3)

        // 尚未到 500ms 边界
        expect(mockFetch).not.toHaveBeenCalled()

        // 推进 500ms 触发最后一次
        await vi.advanceTimersByTimeAsync(500)

        expect(mockFetch).toHaveBeenCalledTimes(1)
        expect(mockFetch).toHaveBeenCalledWith(
            '/api/v1/assistant/contract/reviews/100',
            expect.objectContaining({ method: 'PATCH', body: { risks: r3 } }),
        )
    })
})
