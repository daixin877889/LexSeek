/**
 * useStreamChat composable 测试
 *
 * 测试泛型流管理底层 composable 的核心逻辑：
 * - interruptData 从 values.__interrupt__ 正确读取
 * - messages computed 始终返回数组
 * - hasHistoryLoaded 状态转换
 * - reconnect / loadHistory 重置逻辑
 *
 * **Feature: stream-chat**
 * **Validates: Requirements 5.1, 5.2, 5.3**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed, shallowRef, watch, nextTick } from 'vue'

// ── mock @langchain/vue ──────────────────────────────────────────────────────

// 工厂函数，每个测试可注入不同的 values/messages 状态
let mockValuesRef = shallowRef<any>(undefined)
let mockMessagesRef: any[] = []
const mockSubmit = vi.fn()
const mockStop = vi.fn()
const mockGetMessagesMetadata = vi.fn()

vi.mock('@langchain/vue', () => ({
    // 必须用普通函数（非箭头函数）才能被 new 调用
    FetchStreamTransport: vi.fn().mockImplementation(function () { return {} }),
    useStream: vi.fn(() => {
        // useStreamCustom 返回的 values/messages 是 ES6 getter（非 Ref）
        // 此处用 Object.defineProperty 模拟 getter，让 Vue computed 可追踪 shallowRef
        const obj: Record<string, any> = {
            isLoading: shallowRef(false),
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

// ── 动态导入（确保 mock 先完成）─────────────────────────────────────────────

const { useStreamChat } = await import('~/composables/useStreamChat')

// ── 测试工具 ─────────────────────────────────────────────────────────────────

function buildChat(overrides: Parameters<typeof useStreamChat>[0] = { apiUrl: '/test' }) {
    return useStreamChat(overrides)
}

// ── 测试套件 ─────────────────────────────────────────────────────────────────

describe('useStreamChat', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockValuesRef = shallowRef<any>(undefined)
        mockMessagesRef = []
    })

    // ── interruptData ────────────────────────────────────────────────────────

    describe('interruptData 解包逻辑', () => {
        it('values 无 __interrupt__ 时应返回 null', () => {
            mockValuesRef.value = { messages: [] }
            const chat = buildChat()
            expect(chat.interruptData.value).toBeNull()
        })

        it('__interrupt__ 为空数组时应返回 null', () => {
            mockValuesRef.value = { __interrupt__: [] }
            const chat = buildChat()
            expect(chat.interruptData.value).toBeNull()
        })

        it('应从 values.__interrupt__[0].value 解包（数组→首项→.value）', () => {
            const interruptValue = { type: 'case_info_check', question: '请补充信息' }
            mockValuesRef.value = {
                __interrupt__: [{ value: interruptValue }],
            }
            const chat = buildChat()
            expect(chat.interruptData.value).toEqual(interruptValue)
        })

        it('确认从 values.__interrupt__ 读取（非 stream.interrupt 路径）', () => {
            // stream 对象本身没有 interrupt 字段，数据必须来自 values.__interrupt__
            const interruptValue = { type: 'confirm', message: '确认提交？' }
            mockValuesRef.value = {
                __interrupt__: [{ value: interruptValue }],
            }
            const chat = buildChat()
            // 只要 values.__interrupt__ 存在，就应能读到数据
            expect(chat.interruptData.value).not.toBeNull()
            expect(chat.interruptData.value).toEqual(interruptValue)
        })

        it('__interrupt__ 有多个元素时应返回整个数组', () => {
            const items = [{ value: 'a' }, { value: 'b' }]
            mockValuesRef.value = { __interrupt__: items }
            const chat = buildChat()
            // raw.length !== 1 → resolved = raw（数组本身），无 .value → resolved 直接返回
            expect(chat.interruptData.value).toEqual(items)
        })

        it('单项 __interrupt__ 无 .value 时应返回整个 item', () => {
            const item = { type: 'raw_without_value' }
            mockValuesRef.value = { __interrupt__: [item] }
            const chat = buildChat()
            // resolved = item, item.value = undefined → 返回 resolved（item 本身）
            expect(chat.interruptData.value).toEqual(item)
        })
    })

    // ── messages computed ────────────────────────────────────────────────────

    describe('messages computed', () => {
        it('初始状态应返回数组', () => {
            const chat = buildChat()
            expect(Array.isArray(chat.messages.value)).toBe(true)
        })

        it('messages getter 有数据时应透传', () => {
            const fakeMessages = [
                { type: 'human', content: 'hello' },
                { type: 'ai', content: 'world' },
            ]
            mockMessagesRef = fakeMessages
            const chat = buildChat()
            expect(chat.messages.value).toEqual(fakeMessages)
        })
    })

    // ── hasHistoryLoaded ─────────────────────────────────────────────────────

    describe('hasHistoryLoaded', () => {
        it('初始值应为 false', () => {
            const chat = buildChat()
            expect(chat.hasHistoryLoaded.value).toBe(false)
        })

        it('values 变为非空后应变为 true', async () => {
            const chat = buildChat()
            expect(chat.hasHistoryLoaded.value).toBe(false)

            // 模拟 values 变化（useStream 返回数据）
            mockValuesRef.value = { messages: [] }
            await nextTick()

            expect(chat.hasHistoryLoaded.value).toBe(true)
        })

        it('已加载后再次赋值不会重复触发（值保持 true）', async () => {
            const chat = buildChat()
            mockValuesRef.value = { messages: [] }
            await nextTick()
            expect(chat.hasHistoryLoaded.value).toBe(true)

            // 再次变化
            mockValuesRef.value = { messages: [{ type: 'human', content: 'hi' }] }
            await nextTick()
            expect(chat.hasHistoryLoaded.value).toBe(true)
        })
    })

    // ── reconnect ────────────────────────────────────────────────────────────

    describe('reconnect', () => {
        it('应重置 hasHistoryLoaded 为 false 并调用 submit(undefined)', async () => {
            const chat = buildChat()

            // 先让 hasHistoryLoaded = true
            mockValuesRef.value = { messages: [] }
            await nextTick()
            expect(chat.hasHistoryLoaded.value).toBe(true)

            chat.reconnect()

            expect(chat.hasHistoryLoaded.value).toBe(false)
            expect(mockSubmit).toHaveBeenCalledWith(undefined)
        })
    })

    // ── loadHistory ──────────────────────────────────────────────────────────

    describe('loadHistory', () => {
        it('应重置 hasHistoryLoaded 为 false 并调用 submit(undefined)', async () => {
            const chat = buildChat()

            // 先让 hasHistoryLoaded = true
            mockValuesRef.value = { messages: [] }
            await nextTick()
            expect(chat.hasHistoryLoaded.value).toBe(true)

            chat.loadHistory()

            expect(chat.hasHistoryLoaded.value).toBe(false)
            expect(mockSubmit).toHaveBeenCalledWith(undefined)
        })
    })

    // ── submit / stop 透传 ───────────────────────────────────────────────────

    describe('submit 和 stop 透传', () => {
        it('submit 应调用底层 s.submit', () => {
            const chat = buildChat()
            const input = { messages: [{ type: 'human', content: 'test' }] }
            chat.submit(input)
            expect(mockSubmit).toHaveBeenCalledWith(input, undefined)
        })

        it('stop 应调用底层 s.stop', () => {
            const chat = buildChat()
            chat.stop()
            expect(mockStop).toHaveBeenCalled()
        })
    })
})
