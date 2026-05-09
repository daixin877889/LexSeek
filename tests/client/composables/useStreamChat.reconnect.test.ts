/**
 * useStreamChat 自动重连机制测试
 *
 * **Feature: stream-chat-auto-reconnect**
 * **Validates: docs/superpowers/specs/2026-05-09-frontend-sse-auto-reconnect-design.md §3.1-§3.6**
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { shallowRef, defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'

// ── mock @langchain/vue ──────────────────────────────────────────────
// 对齐项目内 useStreamChat.test.ts：useStreamCustom 返回的 values/messages 是 ES6 getter，
// 用 Object.defineProperty 模拟，让 Vue computed 可追踪到底层 shallowRef。

const captured: { options: any } = { options: null }
const mockSubmit = vi.fn()
const mockStop = vi.fn()
const mockGetMessagesMetadata = vi.fn()

const mockIsLoading = shallowRef(false)
let mockValuesRef = shallowRef<any>(null)
let mockMessagesRef: any[] = []

vi.mock('@langchain/vue', () => ({
    // 必须用普通函数（非箭头函数）才能被 new 调用
    FetchStreamTransport: vi.fn().mockImplementation(function () { return {} }),
    useStream: vi.fn((options: any) => {
        captured.options = options
        const obj: Record<string, any> = {
            isLoading: mockIsLoading,
            error: shallowRef(null),
            submit: mockSubmit,
            stop: mockStop,
            getMessagesMetadata: mockGetMessagesMetadata,
        }
        Object.defineProperty(obj, 'values', {
            get() { return mockValuesRef.value },
            enumerable: true,
        })
        Object.defineProperty(obj, 'messages', {
            get() { return mockMessagesRef },
            enumerable: true,
        })
        return obj
    }),
}))

// 动态导入：确保 mock 已注册
const { useStreamChat } = await import('~/composables/useStreamChat')

// mountChat 把 useStreamChat 包在组件 setup 里跑，让 useEventListener /
// useDocumentVisibility 正确注册到组件 effect scope（unmount 时自动清理）
function mountChat() {
    const Wrapper = defineComponent({
        setup() {
            const chat = useStreamChat({ apiUrl: '/api/v1/cases/init-analysis' })
            ;(globalThis as any).__chat = chat
            return () => h('div')
        },
    })
    return mount(Wrapper)
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    captured.options = null
    mockSubmit.mockReset()
    mockSubmit.mockImplementation(async () => {})
    mockStop.mockReset()
    mockIsLoading.value = false
    mockValuesRef = shallowRef<any>(null)
    mockMessagesRef = []
    delete (globalThis as any).__chat
})

afterEach(() => {
    vi.useRealTimers()
})

describe('useStreamChat reconnect - retry scheduling', () => {
    it('triggers retry on transport error and resubmits with undefined', async () => {
        const w = mountChat()
        await nextTick()
        expect(captured.options).not.toBeNull()

        // 触发传输层错误（SDK 抛出的"Failed to stream: 500"形态）
        captured.options!.onError!(new Error('Failed to stream: 500'))
        await nextTick()

        const chat = (globalThis as any).__chat
        expect(chat.reconnectState.isRetrying).toBe(true)
        expect(chat.reconnectState.attempts).toBe(1)

        // 推进到第 1 次重试间隔（Math.random 默认未 mock，区间 [800, 1200]）
        vi.advanceTimersByTime(1200)
        await nextTick()
        expect(mockSubmit).toHaveBeenCalledWith(undefined)

        w.unmount()
    })

    it('does NOT retry on AbortError', async () => {
        mountChat()
        await nextTick()

        const abortErr = new Error('aborted')
        abortErr.name = 'AbortError'
        captured.options!.onError!(abortErr)
        await nextTick()

        const chat = (globalThis as any).__chat
        expect(chat.reconnectState.isRetrying).toBe(false)
        expect(chat.reconnectState.attempts).toBe(0)
    })

    it('does NOT retry on error with message containing "aborted"', async () => {
        mountChat()
        await nextTick()

        captured.options!.onError!(new Error('The operation was aborted'))
        await nextTick()

        const chat = (globalThis as any).__chat
        expect(chat.reconnectState.isRetrying).toBe(false)
    })

    it('uses exponential backoff schedule (1/2/4/8/16s) with jitter', async () => {
        // 固定 jitter 系数为 0（Math.random=0.5 → -0.2~+0.2 中点 → 1+0=1）
        vi.spyOn(Math, 'random').mockReturnValue(0.5)
        mountChat()
        await nextTick()

        const expected = [1000, 2000, 4000, 8000, 16000]
        for (let i = 0; i < 5; i++) {
            mockSubmit.mockClear()
            captured.options!.onError!(new Error('boom'))
            await nextTick()

            // 间隔不到时不会重试
            vi.advanceTimersByTime(expected[i]! - 50)
            await nextTick()
            expect(mockSubmit).not.toHaveBeenCalled()

            vi.advanceTimersByTime(100)
            await nextTick()
            expect(mockSubmit).toHaveBeenCalledOnce()
        }
    })
})
