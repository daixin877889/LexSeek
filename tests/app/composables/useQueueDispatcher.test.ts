/**
 * useQueueDispatcher 单测：聚焦"队列派发时透传附件元数据"的本次修复。
 *
 * 背景：QueueItem.files 之前是前瞻字段（spec §5.6 历史注释），dispatcher 派发时
 * 仅把 popped.text 发给 wrappedChat.sendMessage，导致用户在生成中态加入队列
 * 的"文本+附件"消息被消费时附件丢失。本测试守护"派发路径与顶层 sendMessage
 * 走完全相同的 buildAttachmentsPayload 口径"。
 *
 * 通过 stub navigator.locks（else 分支直接 tryPop）+ reactive 手工依赖构造，
 * 避免引入完整工厂上下文。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, ref, computed, shallowRef, nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { stubBroadcastChannel, stubNavigatorLocks } from '../utils/crossTabMocks'
import type { QueueItem, QueuePauseReason } from '~/composables/chatQueueActions'
import type { WrappedChat } from '~/composables/agent-platform/types'
import { useQueueDispatcher } from '~/composables/useQueueDispatcher'

// ── 共享 stub ──────────────────────────────────────────────────────────────

let restoreBC: (() => void) | null = null
let restoreLocks: (() => void) | null = null

beforeEach(() => {
    restoreBC = stubBroadcastChannel()
    restoreLocks = stubNavigatorLocks()
})

afterEach(() => {
    restoreBC?.()
    restoreLocks?.()
})

// ── 测试工具 ───────────────────────────────────────────────────────────────

interface DispatcherFixture {
    sendMessage: ReturnType<typeof vi.fn>
    runStatus: ReturnType<typeof ref<'idle' | 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'>>
    isLoading: ReturnType<typeof ref<boolean>>
    interruptData: ReturnType<typeof ref<unknown>>
    queuesBySession: Map<string, QueueItem[]>
    queuePausedBy: Map<string, Exclude<QueuePauseReason, null>>
    lastLocalSendSeq: ReturnType<typeof ref<number>>
    maybeDispatch: () => Promise<void>
    unmount: () => void
}

function makeFile(over: Partial<{ id: number; fileName: string; fileType: string; fileSize: number; encrypted: boolean }> = {}) {
    return {
        id: 200,
        fileName: 'evidence.pdf',
        fileType: 'application/pdf',
        fileSize: 2048,
        encrypted: false,
        source: 1,
        sourceName: '案件分析',
        status: 1,
        statusName: '正常',
        createdAt: '2026-04-01T00:00:00Z',
        ...over,
    } as any
}

function makeQueueItem(over: Partial<QueueItem> = {}): QueueItem {
    return {
        id: `q-${Math.random().toString(36).slice(2, 8)}`,
        text: '默认文本',
        thinking: false,
        enqueuedAt: Date.now(),
        ...over,
    }
}

/**
 * 在宿主组件 setup 中挂载 useQueueDispatcher，激活其内部 watch。
 * 返回 maybeDispatch 控制权与所有依赖响应式 ref，方便测试场景驱动。
 */
function mountDispatcher(): DispatcherFixture {
    const sendMessage = vi.fn().mockResolvedValue(undefined)

    const currentSessionId = ref<string | null>('s-1')
    const currentChat = shallowRef<WrappedChat | null>({
        sendMessage,
        // 占位（dispatcher 不消费这两个 method，类型对齐用）
        resumeInterrupt: vi.fn(),
        stopGeneration: vi.fn(),
    } as any)
    const runStatusRaw = ref<string>('idle')
    const runStatus = computed(() => runStatusRaw.value as any)
    const isLoading = ref(false)
    const interruptData = ref<unknown>(null)
    const queuesBySession = new Map<string, QueueItem[]>()
    const queuePausedBy = new Map<string, Exclude<QueuePauseReason, null>>()
    const lastLocalSendSeq = ref(0)

    let maybeDispatch!: () => Promise<void>

    const Host = defineComponent({
        setup() {
            const d = useQueueDispatcher({
                currentSessionId,
                currentChat,
                runStatus: runStatus as any,
                isLoading: computed(() => isLoading.value),
                interruptData: computed(() => interruptData.value),
                queuesBySession,
                queuePausedBy,
                tabId: 'tab-test',
                lastLocalSendSeq,
            })
            maybeDispatch = d.maybeDispatch
            return () => h('div')
        },
    })
    const wrapper = mount(Host)

    return {
        sendMessage,
        runStatus: runStatusRaw as any,
        isLoading,
        interruptData,
        queuesBySession,
        queuePausedBy,
        lastLocalSendSeq,
        maybeDispatch,
        unmount: () => wrapper.unmount(),
    }
}

// ── 测试用例 ───────────────────────────────────────────────────────────────

describe('useQueueDispatcher / 派发时透传 files（本次修复）', () => {
    it('queue item 不含 files：wrappedChat.sendMessage 收到原文本 + 无 additional_kwargs', async () => {
        const fx = mountDispatcher()
        try {
            fx.queuesBySession.set('s-1', [makeQueueItem({ text: '只有文字', thinking: true })])
            await fx.maybeDispatch()
            await flushPromises()

            expect(fx.sendMessage).toHaveBeenCalledTimes(1)
            const [content, opts] = fx.sendMessage.mock.calls[0]!
            expect(content).toBe('只有文字')
            expect(opts).toMatchObject({ thinking: true })
            expect(opts.additional_kwargs).toBeUndefined()
        } finally {
            fx.unmount()
        }
    })

    it('queue item 含 files：sendMessage 收到 sentinel + additional_kwargs.attachments', async () => {
        const fx = mountDispatcher()
        try {
            const file = makeFile({ id: 808, fileName: '合同.pdf' })
            fx.queuesBySession.set('s-1', [makeQueueItem({
                text: '帮我看这个合同',
                files: [file],
                thinking: false,
            })])
            await fx.maybeDispatch()
            await flushPromises()

            expect(fx.sendMessage).toHaveBeenCalledTimes(1)
            const [content, opts] = fx.sendMessage.mock.calls[0]!
            expect(content.startsWith('__ATTACHMENTS__\n')).toBe(true)
            expect(content.endsWith('帮我看这个合同')).toBe(true)
            expect(opts.thinking).toBe(false)
            expect(opts.additional_kwargs?.attachments).toHaveLength(1)
            expect(opts.additional_kwargs?.attachments?.[0]).toMatchObject({
                id: 808,
                fileName: '合同.pdf',
            })
        } finally {
            fx.unmount()
        }
    })

    it('queue item files=空数组等同于无附件', async () => {
        const fx = mountDispatcher()
        try {
            fx.queuesBySession.set('s-1', [makeQueueItem({ text: 'hi', files: [] })])
            await fx.maybeDispatch()
            await flushPromises()

            const [content, opts] = fx.sendMessage.mock.calls[0]!
            expect(content).toBe('hi')
            expect(opts.additional_kwargs).toBeUndefined()
        } finally {
            fx.unmount()
        }
    })

    it('queue item 仅含 files、文本为空：sentinel 单独构成内容', async () => {
        const fx = mountDispatcher()
        try {
            fx.queuesBySession.set('s-1', [makeQueueItem({ text: '', files: [makeFile()] })])
            await fx.maybeDispatch()
            await flushPromises()

            const [content] = fx.sendMessage.mock.calls[0]!
            expect(content.startsWith('__ATTACHMENTS__\n')).toBe(true)
            // 空文本时不应再追加正文段
            expect(content).not.toMatch(/\n\n.+$/)
        } finally {
            fx.unmount()
        }
    })

    it('canDispatch（completed + !isLoading + !interruptData + seq 增长）触发派发', async () => {
        const fx = mountDispatcher()
        try {
            fx.queuesBySession.set('s-1', [makeQueueItem({ text: 'auto', files: [makeFile({ id: 9 })] })])
            // 模拟用户曾经本地发送过一次（seq>0），canDispatch 才会派发
            fx.lastLocalSendSeq.value = 1
            // 触发 canDispatch true
            fx.runStatus.value = 'completed'
            await flushPromises()
            await nextTick()
            await flushPromises()

            expect(fx.sendMessage).toHaveBeenCalled()
            const [content, opts] = fx.sendMessage.mock.calls[0]!
            expect(content.startsWith('__ATTACHMENTS__\n')).toBe(true)
            expect(opts.additional_kwargs?.attachments?.[0]?.id).toBe(9)
        } finally {
            fx.unmount()
        }
    })

    it('派发失败：popped 还原到队首 + 设置 paused=failed（files 不丢）', async () => {
        const fx = mountDispatcher()
        try {
            fx.sendMessage.mockRejectedValueOnce(new Error('网络错误'))
            const item = makeQueueItem({ text: 'failure', files: [makeFile({ id: 1 })] })
            fx.queuesBySession.set('s-1', [item])
            await fx.maybeDispatch()
            await flushPromises()

            const remaining = fx.queuesBySession.get('s-1') ?? []
            expect(remaining).toHaveLength(1)
            expect(remaining[0]?.id).toBe(item.id)
            expect(remaining[0]?.files?.[0]?.id).toBe(1)
            expect(fx.queuePausedBy.get('s-1')).toBe('failed')
        } finally {
            fx.unmount()
        }
    })
})
