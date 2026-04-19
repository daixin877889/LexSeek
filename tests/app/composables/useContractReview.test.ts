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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shallowRef, nextTick } from 'vue'

// ── mock vue-sonner toast（在顶层，避免后续分支 hoist 问题）───────────────────

const mockToast = {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
}
vi.mock('vue-sonner', () => ({
    toast: mockToast,
}))

// ── mock @vueuse/core 的 useDebounceFn：测试里取消 debounce 让调用立即生效 ───
// 单独的"debounce 500ms"用例里改用 vi.useFakeTimers + actual useDebounceFn。

vi.mock('@vueuse/core', async () => {
    const actual = await vi.importActual<typeof import('@vueuse/core')>('@vueuse/core')
    return {
        ...actual,
        useDebounceFn: (fn: (...args: unknown[]) => unknown) => fn,
    }
})

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

    it('mountReview 成功：review.hasUnsavedDocxChanges=true → composable ref 回填为 true', async () => {
        const reviewData = {
            id: 999,
            sessionId: 'sess-999',
            status: 'completed',
            contractType: '买卖合同',
            partyA: '甲方',
            partyB: '乙方',
            stance: 'partyA',
            risks: [],
            summary: null,
            originalFileId: 1,
            reviewedFileId: 2,
            hasUnsavedDocxChanges: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        }
        mockFetch.mockResolvedValueOnce({ review: reviewData } as any)

        const c = useContractReview()
        await c.mountReview(999)

        expect(c.hasUnsavedDocxChanges.value).toBe(true)
    })

    it('mountReview 成功：review.hasUnsavedDocxChanges=false → composable ref 回填为 false（覆盖旧 true）', async () => {
        const reviewData = {
            id: 1000,
            sessionId: 'sess-1000',
            status: 'completed',
            contractType: '买卖合同',
            partyA: '甲方',
            partyB: '乙方',
            stance: 'partyA',
            risks: [],
            summary: null,
            originalFileId: 1,
            reviewedFileId: 2,
            hasUnsavedDocxChanges: false,
            createdAt: new Date(),
            updatedAt: new Date(),
        }
        mockFetch.mockResolvedValueOnce({ review: reviewData } as any)

        const c = useContractReview()
        // 先手动置 true，模拟跨会话遗留
        c.hasUnsavedDocxChanges.value = true
        await c.mountReview(1000)

        expect(c.hasUnsavedDocxChanges.value).toBe(false)
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
            // onDownload 现在传 { showError: false }，为失败分支显式弹 toast.error 服务
            expect.objectContaining({ showError: false }),
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

describe('useContractReview.cancelReview', () => {
    beforeEach(() => {
        mockFetch.mockReset()
        mockStreamSubmit.mockReset()
        mockStreamStop.mockClear()
        mockStreamValues.value = undefined
        mockStreamMessages.value = []
        mockStreamIsLoading.value = false
        capturedOnCustomEvent = null
    })

    it('停 stream + 清 review / reviewId / stream.value', async () => {
        // 先 onStart 挂载 stream
        mockFetch.mockResolvedValueOnce({ reviewId: 77, sessionId: 's-77' })
        const c = useContractReview()
        await c.onStart({ sourceType: 'paste', text: '...' })
        expect(c.reviewId.value).toBe(77)

        await c.cancelReview()

        expect(mockStreamStop).toHaveBeenCalledTimes(1)
        expect(c.review.value).toBeNull()
        expect(c.reviewId.value).toBeNull()
    })

    it('未挂载 stream 时调用 cancelReview 不抛错', async () => {
        const c = useContractReview()
        await expect(c.cancelReview()).resolves.toBeUndefined()
        expect(c.review.value).toBeNull()
        expect(c.reviewId.value).toBeNull()
    })
})

// ── M5 扩展测试 ─────────────────────────────────────────────────────────────

describe('useContractReview M5 扩展', () => {
    /** 统一准备一个已 mount 的 composable，reviewId=100 */
    async function mountReviewed(status: string = 'completed') {
        mockFetch.mockResolvedValueOnce({
            review: {
                id: 100,
                sessionId: 's-100',
                status,
                contractType: '买卖合同',
                partyA: 'A',
                partyB: 'B',
                stance: 'partyA',
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
        mockToast.info.mockReset()
        mockToast.success.mockReset()
        mockToast.warning.mockReset()
        mockToast.error.mockReset()
        return c
    }

    beforeEach(() => {
        mockFetch.mockReset()
        mockStreamSubmit.mockReset()
        mockStreamValues.value = undefined
        mockStreamMessages.value = []
        mockToast.info.mockReset()
        mockToast.success.mockReset()
        mockToast.warning.mockReset()
        mockToast.error.mockReset()
    })

    describe('onEditRisks', () => {
        it('onEditRisks 成功 → review.value.risks 更新 + hasUnsavedDocxChanges=true', async () => {
            const c = await mountReviewed()
            mockFetch.mockResolvedValueOnce({ reviewId: 100 })

            const newRisks = [
                {
                    id: 'r1',
                    clauseIndex: 1,
                    clauseText: '条款1',
                    level: 'high' as const,
                    category: '付款',
                    problem: '问题',
                    analysis: '分析',
                    risk: '风险',
                    suggestion: '建议',
                    suggestedClauseText: '改后',
                },
            ]
            await c.onEditRisks(newRisks)

            expect(mockFetch).toHaveBeenCalledWith(
                '/api/v1/assistant/contract/reviews/100',
                expect.objectContaining({ method: 'PATCH', body: { risks: newRisks } }),
            )
            expect(c.review.value?.risks).toEqual(newRisks)
            expect(c.hasUnsavedDocxChanges.value).toBe(true)
        })

        it('onEditRisks 失败（useApiFetch 返回 null）→ toast.error + hasUnsavedDocxChanges 保持', async () => {
            const c = await mountReviewed()
            mockFetch.mockResolvedValueOnce(null)

            await c.onEditRisks([])

            expect(mockToast.error).toHaveBeenCalledWith('保存风险清单失败')
            expect(c.hasUnsavedDocxChanges.value).toBe(false)
        })

        it('onEditRisks reviewId 为空 → 静默不发请求', async () => {
            const c = useContractReview()
            await c.onEditRisks([])
            expect(mockFetch).not.toHaveBeenCalled()
            expect(mockToast.error).not.toHaveBeenCalled()
        })
    })

    describe('onRebuildDocx', () => {
        it('成功：toast.info 入口 + 刷 review + hasUnsavedDocxChanges=false + toast.success + <a download> 触发', async () => {
            const c = await mountReviewed('completed')
            // 先制造 "有未保存改动"
            mockFetch.mockResolvedValueOnce({ reviewId: 100 })
            await c.onEditRisks([])
            expect(c.hasUnsavedDocxChanges.value).toBe(true)
            mockFetch.mockReset()
            mockToast.info.mockReset()

            // 1. POST /rebuild-docx 成功
            mockFetch.mockResolvedValueOnce({
                reviewedFileId: 88,
                downloadUrl: 'https://oss.example.com/rebuild.docx',
            })
            // 2. refreshReview 拉最新
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
                    reviewedFileId: 88,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })

            const appendSpy = vi.spyOn(document.body, 'appendChild')
            const removeSpy = vi.spyOn(document.body, 'removeChild')
            const createSpy = vi.spyOn(document, 'createElement')

            await c.onRebuildDocx()

            expect(mockToast.info).toHaveBeenCalledWith('批注正在重新生成，请稍候...')
            expect(mockFetch).toHaveBeenNthCalledWith(
                1,
                '/api/v1/assistant/contract/reviews/100/rebuild-docx',
                expect.objectContaining({ method: 'POST' }),
            )
            expect(c.hasUnsavedDocxChanges.value).toBe(false)
            expect(mockToast.success).toHaveBeenCalledWith('批注已重新生成')

            expect(createSpy).toHaveBeenCalledWith('a')
            expect(appendSpy).toHaveBeenCalled()
            expect(removeSpy).toHaveBeenCalled()
            const anchor = appendSpy.mock.calls.find(
                (args) => (args[0] as HTMLElement).tagName === 'A',
            )?.[0] as HTMLAnchorElement
            expect(anchor.href).toContain('rebuild.docx')

            appendSpy.mockRestore()
            removeSpy.mockRestore()
            createSpy.mockRestore()
        })

        it('429 → toast.warning 提示重新生成中', async () => {
            const c = await mountReviewed('completed')
            // 模拟 useApiFetch onBusinessError 注入 code=429 后返回 null
            mockFetch.mockImplementationOnce((_url: string, opts: any) => {
                opts?.onBusinessError?.({ code: 429 })
                return Promise.resolve(null)
            })

            await c.onRebuildDocx()

            expect(mockToast.info).toHaveBeenCalled()
            expect(mockToast.warning).toHaveBeenCalledWith('批注正在重新生成中，请稍候')
            expect(mockToast.error).not.toHaveBeenCalled()
        })

        it('500 → toast.error', async () => {
            const c = await mountReviewed('completed')
            mockFetch.mockImplementationOnce((_url: string, opts: any) => {
                opts?.onBusinessError?.({ code: 500 })
                return Promise.resolve(null)
            })

            await c.onRebuildDocx()

            expect(mockToast.error).toHaveBeenCalledWith('重新生成批注失败，请稍后重试')
            expect(mockToast.warning).not.toHaveBeenCalled()
        })

        it('reviewId 为空 → 静默不发请求', async () => {
            const c = useContractReview()
            await c.onRebuildDocx()
            expect(mockFetch).not.toHaveBeenCalled()
            expect(mockToast.info).not.toHaveBeenCalled()
        })
    })

    describe('isRebuilding', () => {
        it('review.status === rebuilding → true', async () => {
            const c = await mountReviewed('rebuilding')
            expect(c.isRebuilding.value).toBe(true)
        })

        it('review.status !== rebuilding → false', async () => {
            const c = await mountReviewed('completed')
            expect(c.isRebuilding.value).toBe(false)
        })

        it('review 未挂载 → false', () => {
            const c = useContractReview()
            expect(c.isRebuilding.value).toBe(false)
        })
    })

    describe('mountReview / onStart 重置 hasUnsavedDocxChanges', () => {
        it('先置 true 再 mountReview 应归零', async () => {
            const c = await mountReviewed('completed')
            mockFetch.mockResolvedValueOnce({ reviewId: 100 })
            await c.onEditRisks([])
            expect(c.hasUnsavedDocxChanges.value).toBe(true)

            // 再次 mountReview（不同 id 也可）
            mockFetch.mockResolvedValueOnce({
                review: {
                    id: 200,
                    sessionId: 's-200',
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
            await c.mountReview(200)

            expect(c.hasUnsavedDocxChanges.value).toBe(false)
        })

        it('先置 true 再 onStart 应归零', async () => {
            const c = await mountReviewed('completed')
            mockFetch.mockResolvedValueOnce({ reviewId: 100 })
            await c.onEditRisks([])
            expect(c.hasUnsavedDocxChanges.value).toBe(true)

            mockFetch.mockResolvedValueOnce({ reviewId: 300, sessionId: 's-300' })
            await c.onStart({ sourceType: 'paste', text: '...' })

            expect(c.hasUnsavedDocxChanges.value).toBe(false)
        })
    })
})

// ── debounce 真实节流用例：单独在顶层换 mock 不便，这里用 spy 验证接入即可 ──
//   useDebounceFn 的节流本身由 @vueuse/core 单元测试保证，我们验证 onEditRisks
//   的"逻辑在调用后立即生效"（debounce 已被取消为 identity）已足够覆盖行为。
//   若后续需验证真实 500ms 节流，可新建独立文件 + vi.useFakeTimers。

// ── M6.2 扩展：onExportPdf ─────────────────────────────────────────────────

describe('useContractReview.onExportPdf', () => {
    async function mountReviewed() {
        mockFetch.mockResolvedValueOnce({
            review: {
                id: 500,
                sessionId: 's-500',
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
        await c.mountReview(500)
        mockFetch.mockReset()
        mockToast.info.mockReset()
        mockToast.success.mockReset()
        mockToast.error.mockReset()
        return c
    }

    const originalFetch = (globalThis as any).$fetch
    const originalCreateObjectURL = URL.createObjectURL
    const originalRevokeObjectURL = URL.revokeObjectURL

    beforeEach(() => {
        mockFetch.mockReset()
        mockToast.info.mockReset()
        mockToast.success.mockReset()
        mockToast.error.mockReset()
        URL.createObjectURL = vi.fn(() => 'blob:mock-url')
        URL.revokeObjectURL = vi.fn()
    })

    afterEach(() => {
        ; (globalThis as any).$fetch = originalFetch
        URL.createObjectURL = originalCreateObjectURL
        URL.revokeObjectURL = originalRevokeObjectURL
    })

    it('成功：toast.info + <a download> 触发 + toast.success', async () => {
        const c = await mountReviewed()

        const blob = new Blob(['%PDF-1.4 mock'], { type: 'application/pdf' })
        const fetchFn = vi.fn().mockResolvedValue(blob)
        ; (globalThis as any).$fetch = fetchFn

        const appendSpy = vi.spyOn(document.body, 'appendChild')
        const removeSpy = vi.spyOn(document.body, 'removeChild')

        await c.onExportPdf(true)

        expect(mockToast.info).toHaveBeenCalledWith('正在生成 PDF...')
        expect(fetchFn).toHaveBeenCalledWith(
            '/api/v1/assistant/contract/reviews/500/export-pdf',
            expect.objectContaining({
                method: 'POST',
                body: { includeRisks: true },
                responseType: 'blob',
            }),
        )
        const anchor = appendSpy.mock.calls.find(
            (args) => (args[0] as HTMLElement).tagName === 'A',
        )?.[0] as HTMLAnchorElement
        expect(anchor).toBeDefined()
        expect(anchor.download).toBe('contract-review-500.pdf')
        expect(removeSpy).toHaveBeenCalled()
        expect(mockToast.success).toHaveBeenCalledWith('PDF 已下载')

        appendSpy.mockRestore()
        removeSpy.mockRestore()
    })

    it('返回非 Blob 时 toast.error', async () => {
        const c = await mountReviewed()
        const fetchFn = vi.fn().mockResolvedValue({ not: 'a blob' })
        ; (globalThis as any).$fetch = fetchFn

        await c.onExportPdf(false)

        expect(mockToast.info).toHaveBeenCalled()
        expect(mockToast.error).toHaveBeenCalledWith('PDF 生成失败')
        expect(mockToast.success).not.toHaveBeenCalled()
    })

    it('$fetch 抛错时解析 e.data.message 提示', async () => {
        const c = await mountReviewed()
        const fetchFn = vi.fn().mockRejectedValue({ data: { message: '后端炸了' } })
        ; (globalThis as any).$fetch = fetchFn

        await c.onExportPdf(false)

        expect(mockToast.error).toHaveBeenCalledWith('后端炸了')
    })

    it('$fetch 抛错且无 message 时 fallback 固定文案', async () => {
        const c = await mountReviewed()
        const fetchFn = vi.fn().mockRejectedValue(new Error('network'))
        ; (globalThis as any).$fetch = fetchFn

        await c.onExportPdf(false)

        expect(mockToast.error).toHaveBeenCalledWith('PDF 生成失败')
    })

    it('reviewId 为空 → 静默不发请求', async () => {
        const c = useContractReview()
        const fetchFn = vi.fn()
        ; (globalThis as any).$fetch = fetchFn

        await c.onExportPdf(true)

        expect(fetchFn).not.toHaveBeenCalled()
        expect(mockToast.info).not.toHaveBeenCalled()
    })
})
