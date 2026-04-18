/**
 * useContractReview composable 测试
 *
 * 覆盖 M4 合同审查前端 composable 的核心行为：
 * - onStart：创建审查 + 挂载 SSE + submit(undefined) 触发 checkpoint 推送
 * - mountReview：通过已有 reviewId 恢复审查 + 挂载 SSE
 * - onStance：提交立场后 stream 重置 + submit(undefined) 续订
 * - onDownload：拉取签名 URL 触发浏览器下载（DOM 插入-click-移除）
 * - awaitingStance 派生：interruptData.type === 'awaiting_stance' 时返回立场字段
 * - stream completed/failed 后 watcher 主动拉取最新 review
 *
 * 参考同级 useDocumentDraft.extensions.test.ts 的 mock 骨架：
 * mock @langchain/vue 屏蔽真实 SSE + mock useApiFetch 捕获请求。
 *
 * **Feature: contract-review-m4**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowRef, nextTick } from 'vue'

// ── mock @langchain/vue：避免真实 useStream 在测试环境下报错 ─────────────────

const mockStreamSubmit = vi.fn()
const mockStreamStop = vi.fn().mockResolvedValue(undefined)
const mockStreamValues = shallowRef<any>(undefined)
const mockStreamMessages = shallowRef<any[]>([])
const mockStreamIsLoading = shallowRef(false)
let capturedOnCustomEvent: ((data: unknown) => void) | null = null

vi.mock('@langchain/vue', () => ({
    FetchStreamTransport: vi.fn().mockImplementation(function () { return {} }),
    useStream: vi.fn((opts: any) => {
        capturedOnCustomEvent = opts?.onCustomEvent ?? null
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

// ── mock useApiFetch ────────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({
    useApiFetch: (...args: unknown[]) => mockFetch(...args),
}))

// ── 动态导入（确保 mock 先完成）─────────────────────────────────────────────

const { useContractReview } = await import('~/composables/useContractReview')

describe('useContractReview.onStart', () => {
    beforeEach(() => {
        mockFetch.mockReset()
        mockStreamSubmit.mockReset()
        mockStreamStop.mockClear()
        mockStreamValues.value = undefined
        mockStreamMessages.value = []
        mockStreamIsLoading.value = false
    })

    it('创建审查后写入 reviewId 并 submit(undefined) 触发推送', async () => {
        mockFetch.mockResolvedValueOnce({ reviewId: 123, sessionId: 'sess-a' })

        const c = useContractReview()
        await c.onStart({ sourceType: 'paste', text: '甲方乙方合同文本' })

        expect(c.reviewId.value).toBe(123)
        expect(mockFetch).toHaveBeenCalledWith(
            '/api/v1/assistant/contract/reviews',
            expect.objectContaining({ method: 'POST' }),
        )
        expect(mockStreamSubmit).toHaveBeenCalledTimes(1)
        expect(mockStreamSubmit).toHaveBeenCalledWith(undefined, undefined)
    })

    it('创建失败时 runStatus 回到 idle 且不挂载 stream', async () => {
        mockFetch.mockResolvedValueOnce(null)

        const c = useContractReview()
        await c.onStart({ sourceType: 'paste', text: '...' })

        expect(c.reviewId.value).toBeNull()
        expect(c.runStatus.value).toBe('idle')
        expect(mockStreamSubmit).not.toHaveBeenCalled()
    })
})

describe('useContractReview.mountReview', () => {
    beforeEach(() => {
        mockFetch.mockReset()
        mockStreamSubmit.mockReset()
        mockStreamValues.value = undefined
        mockStreamMessages.value = []
    })

    it('拉取已存在 review 并写入 + 挂载 stream + submit 续订', async () => {
        const reviewData = {
            id: 999,
            sessionId: 'sess-999',
            status: 'reviewing',
            contractType: '买卖合同',
            partyA: '甲方',
            partyB: '乙方',
            stance: 'partyA',
            risks: [],
            summary: null,
            originalFileId: 1,
            reviewedFileId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        }
        mockFetch.mockResolvedValueOnce({ review: reviewData })

        const c = useContractReview()
        await c.mountReview(999)

        expect(c.review.value?.id).toBe(999)
        expect(c.reviewId.value).toBe(999)
        expect(mockFetch).toHaveBeenCalledWith(
            '/api/v1/assistant/contract/reviews/999',
            expect.objectContaining({ showError: false }),
        )
        expect(mockStreamSubmit).toHaveBeenCalledTimes(1)
        expect(mockStreamSubmit).toHaveBeenCalledWith(undefined, undefined)
    })

    it('拉取失败时静默返回 null，不挂载 stream', async () => {
        mockFetch.mockResolvedValueOnce(null)

        const c = useContractReview()
        await c.mountReview(404)

        expect(c.review.value).toBeNull()
        expect(mockStreamSubmit).not.toHaveBeenCalled()
    })
})

describe('useContractReview.onStance + awaitingStance', () => {
    beforeEach(() => {
        mockFetch.mockReset()
        mockStreamSubmit.mockReset()
        mockStreamValues.value = undefined
        mockStreamMessages.value = []
    })

    async function mountWithStance() {
        // 1. mountReview 拉 review
        mockFetch.mockResolvedValueOnce({
            review: {
                id: 7,
                sessionId: 's-7',
                status: 'awaiting_stance',
                contractType: '买卖合同',
                partyA: 'A',
                partyB: 'B',
                stance: null,
                risks: null,
                summary: null,
                originalFileId: 1,
                reviewedFileId: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        const c = useContractReview()
        await c.mountReview(7)
        mockStreamSubmit.mockClear()
        // 2. 模拟 SSE 推送 interrupt
        mockStreamValues.value = {
            __interrupt__: [{
                value: {
                    type: 'awaiting_stance',
                    partyA: 'A',
                    partyB: 'B',
                    contractType: '买卖合同',
                },
            }],
        }
        return c
    }

    it('interrupt.type=awaiting_stance 时 awaitingStance 返回三元组', async () => {
        const c = await mountWithStance()
        expect(c.awaitingStance.value).toEqual({
            partyA: 'A',
            partyB: 'B',
            contractType: '买卖合同',
        })
    })

    it('没有 interrupt 时 awaitingStance 为 null', () => {
        const c = useContractReview()
        expect(c.awaitingStance.value).toBeNull()
    })

    it('onStance 成功后 runStatus=idle 且 submit(undefined) 续订', async () => {
        const c = await mountWithStance()
        // 模拟 POST /stance 成功
        mockFetch.mockResolvedValueOnce({ reviewId: 7, runId: 42 })

        await c.onStance({ stance: 'partyA', partyA: 'A', partyB: 'B' })

        expect(mockFetch).toHaveBeenCalledWith(
            '/api/v1/assistant/contract/reviews/7/stance',
            expect.objectContaining({
                method: 'POST',
                body: { stance: 'partyA', partyA: 'A', partyB: 'B' },
            }),
        )
        expect(mockStreamSubmit).toHaveBeenCalledTimes(1)
        expect(mockStreamSubmit).toHaveBeenCalledWith(undefined, undefined)
    })

    it('reviewId 为空时 onStance 静默返回', async () => {
        const c = useContractReview()
        await c.onStance({ stance: 'partyA' })
        expect(mockFetch).not.toHaveBeenCalled()
    })
})

describe('useContractReview.onDownload', () => {
    beforeEach(() => {
        mockFetch.mockReset()
        mockStreamSubmit.mockReset()
    })

    it('拉取 downloadUrl 并触发隐藏 <a> 下载后移除节点', async () => {
        // 1. 先 mount 拿 reviewId
        mockFetch.mockResolvedValueOnce({
            review: {
                id: 55,
                sessionId: 's-55',
                status: 'completed',
                contractType: null,
                partyA: null,
                partyB: null,
                stance: null,
                risks: null,
                summary: null,
                originalFileId: 1,
                reviewedFileId: 2,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        const c = useContractReview()
        await c.mountReview(55)
        // 2. 下载
        mockFetch.mockResolvedValueOnce({ downloadUrl: 'https://oss.example.com/x.docx' })

        const appendSpy = vi.spyOn(document.body, 'appendChild')
        const removeSpy = vi.spyOn(document.body, 'removeChild')
        const createSpy = vi.spyOn(document, 'createElement')

        await c.onDownload()

        expect(mockFetch).toHaveBeenLastCalledWith(
            '/api/v1/assistant/contract/reviews/55/download',
        )
        expect(createSpy).toHaveBeenCalledWith('a')
        expect(appendSpy).toHaveBeenCalled()
        expect(removeSpy).toHaveBeenCalled()

        // 验证被插入的 <a> 带上了 href
        const anchor = appendSpy.mock.calls[0]?.[0] as HTMLAnchorElement
        expect(anchor.href).toContain('x.docx')

        appendSpy.mockRestore()
        removeSpy.mockRestore()
        createSpy.mockRestore()
    })

    it('reviewId 为空时不发起请求', async () => {
        const c = useContractReview()
        await c.onDownload()
        expect(mockFetch).not.toHaveBeenCalled()
    })
})

describe('useContractReview stream completed watcher', () => {
    beforeEach(() => {
        mockFetch.mockReset()
        mockStreamSubmit.mockReset()
        mockStreamValues.value = undefined
        mockStreamMessages.value = []
        mockStreamIsLoading.value = false
        capturedOnCustomEvent = null
    })

    it('runStatus 变为 completed 时主动 GET review 写回 review.value', async () => {
        // 1. 先 onStart 挂载 stream（同时捕获 onCustomEvent 句柄）
        mockFetch.mockResolvedValueOnce({ reviewId: 8, sessionId: 's-8' })
        const c = useContractReview()
        await c.onStart({ sourceType: 'paste', text: '...' })
        expect(c.reviewId.value).toBe(8)

        // 2. 准备 completed 后 watcher 会发的 GET /:id 返回
        const completedReview = {
            id: 8,
            sessionId: 's-8',
            status: 'completed',
            contractType: '买卖合同',
            partyA: null,
            partyB: null,
            stance: null,
            risks: [],
            summary: '审查完成',
            originalFileId: 1,
            reviewedFileId: 2,
            createdAt: new Date(),
            updatedAt: new Date(),
        }
        mockFetch.mockResolvedValueOnce({ review: completedReview })

        // 3. 通过捕获的 onCustomEvent 发 status_change → 驱动 useStreamChat 内部
        //    runStatus ref 变化 → 触发 composable 里的 watcher → 拉取最新 review
        expect(capturedOnCustomEvent).not.toBeNull()
        capturedOnCustomEvent!({ type: 'status_change', status: 'completed' })
        // 给 watcher 和内部 await 用的 microtask 机会跑完
        await nextTick()
        await Promise.resolve()
        await nextTick()

        expect(c.review.value?.id).toBe(8)
        expect(c.review.value?.status).toBe('completed')
        expect(mockFetch).toHaveBeenLastCalledWith(
            '/api/v1/assistant/contract/reviews/8',
            expect.objectContaining({ showError: false }),
        )
    })

    it('runStatus 变为 failed 时同样拉取最新 review（状态同步）', async () => {
        mockFetch.mockResolvedValueOnce({ reviewId: 9, sessionId: 's-9' })
        const c = useContractReview()
        await c.onStart({ sourceType: 'paste', text: '...' })

        mockFetch.mockResolvedValueOnce({
            review: {
                id: 9,
                sessionId: 's-9',
                status: 'failed',
                contractType: null,
                partyA: null,
                partyB: null,
                stance: null,
                risks: null,
                summary: null,
                originalFileId: 1,
                reviewedFileId: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })

        capturedOnCustomEvent!({ type: 'status_change', status: 'failed' })
        await nextTick()
        await Promise.resolve()
        await nextTick()

        expect(c.review.value?.status).toBe('failed')
    })
})
