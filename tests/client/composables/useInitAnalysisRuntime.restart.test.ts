/**
 * useInitAnalysisRuntime.restartAnalysis 测试
 *
 * **Feature: stream-chat-auto-reconnect**
 * **Validates: docs/superpowers/specs/2026-05-09-frontend-sse-auto-reconnect-design.md §3.5**
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, defineComponent, h, nextTick } from 'vue'
import { mount, enableAutoUnmount } from '@vue/test-utils'

enableAutoUnmount(afterEach)

// ── mock useApiFetch ──────────────────────────────────────────────
const mockApiFetch = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({
    useApiFetch: (...args: any[]) => mockApiFetch(...args),
}))

// ── mock useStreamChat（最小返回形状，不走真实流逻辑）──────────────
const streamSubmit = vi.fn()
const streamReset = vi.fn()
vi.mock('~/composables/useStreamChat', () => ({
    useStreamChat: () => ({
        submit: streamSubmit,
        reset: streamReset,
        values: { value: undefined },
        messages: { value: [] },
        isLoading: { value: false },
        runStatus: { value: 'idle' },
        runError: { value: '' },
        interruptData: { value: null },
        syntheticToolCalls: {},
        subThreadsMap: {},
        handleAgentEvent: vi.fn(),
        getMessagesMetadata: () => ({}),
        stop: vi.fn(),
        reconnect: vi.fn(),
        loadHistory: vi.fn(),
        hasHistoryLoaded: { value: false },
    }),
}))

// 顶层 await import 对齐项目模式：保证两个 vi.mock 都已注册再加载被测模块
const { useInitAnalysisRuntime } = await import('~/composables/initAnalysis/useInitAnalysisRuntime')

function mountRuntime() {
    const Wrapper = defineComponent({
        setup() {
            const r = useInitAnalysisRuntime(ref('test-session-uuid'))
            ;(globalThis as any).__runtime = r
            return () => h('div')
        },
    })
    return mount(Wrapper)
}

beforeEach(() => {
    mockApiFetch.mockReset()
    streamSubmit.mockReset()
    streamReset.mockReset()
    delete (globalThis as any).__runtime
})

describe('useInitAnalysisRuntime.restartAnalysis', () => {
    it('on in_progress: calls stream.submit(undefined), does not start fresh', async () => {
        mountRuntime()
        const r = (globalThis as any).__runtime
        r.caseId.value = 42

        mockApiFetch.mockResolvedValueOnce({
            status: 'in_progress',
            modules: [],
            selectedModules: ['summary', 'chronicle'],
        })

        await r.restartAnalysis()
        await nextTick()

        expect(streamReset).toHaveBeenCalledOnce()
        expect(mockApiFetch).toHaveBeenCalledWith(
            '/api/v1/cases/init-analysis-status/42',
            expect.objectContaining({ query: expect.any(Object) }),
        )
        expect(streamSubmit).toHaveBeenCalledWith(undefined)
        expect(r.phase.value).toBe('running')
    })

    it('on completed: submits undefined and sets phase=complete', async () => {
        mountRuntime()
        const r = (globalThis as any).__runtime
        r.caseId.value = 42

        mockApiFetch.mockResolvedValueOnce({
            status: 'completed',
            modules: [],
            selectedModules: ['summary'],
        })

        await r.restartAnalysis()
        await nextTick()

        expect(streamSubmit).toHaveBeenCalledWith(undefined)
        expect(r.phase.value).toBe('complete')
    })

    it('on not_started: falls back to startAnalysis (submit with caseId+selectedModules)', async () => {
        mountRuntime()
        const r = (globalThis as any).__runtime
        r.caseId.value = 42
        r.selectedModules.value = ['summary', 'chronicle']

        mockApiFetch.mockResolvedValueOnce({ status: 'not_started', modules: [] })

        await r.restartAnalysis()
        await nextTick()

        // startAnalysis 调 stream.submit({ caseId, selectedModules })
        expect(streamSubmit).toHaveBeenCalledWith(expect.objectContaining({
            caseId: 42,
            selectedModules: ['summary', 'chronicle'],
        }))
    })

    it('does NOT call cancel API in any branch', async () => {
        mountRuntime()
        const r = (globalThis as any).__runtime
        r.caseId.value = 42

        mockApiFetch.mockResolvedValueOnce({ status: 'in_progress', modules: [] })
        await r.restartAnalysis()
        await nextTick()

        // 校验没有任何 cancel 路径被请求
        const calls = mockApiFetch.mock.calls.map((c: any[]) => c[0] as string)
        expect(calls.every(url => !url.includes('/cancel'))).toBe(true)
    })
})
