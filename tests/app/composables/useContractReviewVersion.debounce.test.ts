/**
 * useContractReviewVersion · 真实 debounce 500ms 时序验证
 *
 * 独立文件：**不 mock** `@vueuse/core`，验证批注内容高频编辑在 500ms 内
 * 合并成一次 PATCH 的核心行为；以及 500ms 内多个不同 annotationId 各自独立合并。
 *
 * 主测试文件顶层将 `useDebounceFn` 替换为 identity 以简化其他 describe，
 * 本文件专门做真实时序验证。
 *
 * **Feature: contract-review-versioning-phase-a**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'

// 只 mock useApiFetch，不 mock @vueuse/core（用真实 useDebounceFn）
const mockFetch = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({
    useApiFetch: (...args: unknown[]) => mockFetch(...args),
}))

const { useContractReviewVersion } = await import('~/composables/useContractReviewVersion')

function makeAnnotation(id: number, riskId: number = 1) {
    return {
        id,
        reviewId: 1,
        riskId,
        parentAnnotationId: null,
        authorType: 'lawyer' as const,
        authorName: '张三',
        authorUserId: 1,
        content: '初始内容',
        createdAt: '2026-01-01T00:00:00.000Z',
    }
}

describe('useContractReviewVersion · 真实 debounce 500ms', () => {
    beforeEach(() => {
        mockFetch.mockReset()
        mockFetch.mockResolvedValue({ ok: true })
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('499ms 内多次击键不发 PATCH，满 500ms 后刚好发一次（取最新值）', async () => {
        const c = useContractReviewVersion(ref(1))
        c.workspace.value.annotations = [makeAnnotation(1)]

        // 连续 3 次击键，每次间隔 100ms，累计 200ms
        c.updateAnnotation(1, '第 1 次')
        await vi.advanceTimersByTimeAsync(100)
        c.updateAnnotation(1, '第 2 次')
        await vi.advanceTimersByTimeAsync(100)
        c.updateAnnotation(1, '最终值')

        // 距离最后一次击键推进 499ms
        await vi.advanceTimersByTimeAsync(499)
        expect(mockFetch).not.toHaveBeenCalled()

        // 再推进 1ms（达到 debounce 500ms 阈值）
        await vi.advanceTimersByTimeAsync(1)

        // 刚好一次 PATCH，body.content 为最新值
        expect(mockFetch).toHaveBeenCalledTimes(1)
        expect(mockFetch).toHaveBeenCalledWith(
            '/api/v1/assistant/contract/reviews/annotations/1',
            expect.objectContaining({
                method: 'PATCH',
                body: { content: '最终值' },
            }),
        )
    })

    it('对不同 annotationId 的击键分别合并成独立的 PATCH', async () => {
        const c = useContractReviewVersion(ref(1))
        c.workspace.value.annotations = [makeAnnotation(1, 1), makeAnnotation(2, 1)]

        c.updateAnnotation(1, '给 1 的内容')
        c.updateAnnotation(2, '给 2 的内容')
        c.updateAnnotation(1, '给 1 的新内容') // 覆盖 1 的 pending

        await vi.advanceTimersByTimeAsync(500)

        // 两条 annotation 各一次 PATCH
        expect(mockFetch).toHaveBeenCalledTimes(2)
        expect(mockFetch).toHaveBeenCalledWith(
            '/api/v1/assistant/contract/reviews/annotations/1',
            expect.objectContaining({ body: { content: '给 1 的新内容' } }),
        )
        expect(mockFetch).toHaveBeenCalledWith(
            '/api/v1/assistant/contract/reviews/annotations/2',
            expect.objectContaining({ body: { content: '给 2 的内容' } }),
        )
    })
})
