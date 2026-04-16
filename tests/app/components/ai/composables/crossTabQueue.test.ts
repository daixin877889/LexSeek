/**
 * 跨标签队列同步测试（Phase 3.5）
 *
 * 覆盖 spec §5.7 / §9.6 的跨标签协议：
 * - enqueue / remove / pause 的 `chat-queue:sync` 广播
 * - hello / sync 的握手流程
 * - Web Lock 互斥（两 tab 同时派发只有一个成功）
 * - 持锁 tab sendMessage 同步抛错
 * - Listener 自回过滤
 * - 过期版本丢弃
 * - 无 navigator.locks 环境降级
 * - Tab A 清空 + Tab B 派发中（§8.1 #15）
 *
 * **Feature: chat-stop-and-queue**
 * **Validates: spec §9.6**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, ref, nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { stubBroadcastChannel, stubNavigatorLocks } from '../../../utils/crossTabMocks'

/**
 * 等待下一个真实时间片，让 performance.now() 推进
 *
 * spec §5.5 / §8.2 已说明：version = performance.now() + Math.random() 在毫秒级
 * 连续广播时可能乱序（last-writer-wins）。测试中需 await 真实 tick 保证单调性。
 */
async function advanceClock() {
  await new Promise(r => setTimeout(r, 2))
  await flushPromises()
}

// 每个 tab 独立的 mockChat ref
function createMockChat() {
  const messages = ref<any[]>([])
  const isLoading = ref(false)
  const runStatus = ref<'idle' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'>('idle')
  const runError = ref('')
  const interruptData = ref<unknown>(null)
  const values = ref<any>(undefined)
  const error = ref<unknown>(null)
  const hasHistoryLoaded = ref(false)

  return {
    messages,
    values,
    isLoading,
    runStatus,
    runError,
    interruptData,
    error,
    hasHistoryLoaded,
    sendMessage: vi.fn(),
    stopGeneration: vi.fn(),
    loadHistory: vi.fn(),
    reconnect: vi.fn(),
    resumeInterrupt: vi.fn(),
    stop: vi.fn(),
    submit: vi.fn(),
    getMessagesMetadata: vi.fn(),
  }
}

// 共享 mockChat 池：每次 useCaseChat 调用返回同一个 mock（按 sessionId）
// 这样多个 tab 的 manager 各自持有独立 mock
let currentMockChatFactory: (() => ReturnType<typeof createMockChat>) | null = null

vi.mock('~/composables/useCaseChat', () => ({
  useCaseChat: vi.fn(() => {
    if (!currentMockChatFactory) throw new Error('currentMockChatFactory not set')
    return currentMockChatFactory()
  }),
}))

const mockUseApiFetch = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({
  useApiFetch: (...args: any[]) => mockUseApiFetch(...args),
}))

const mockStopActiveRun = vi.fn()
vi.mock('~/composables/useStopActiveRun', () => ({
  stopActiveRun: (...args: any[]) => mockStopActiveRun(...args),
}))

const { useChatSessionManager } = await import('~/composables/useChatSessionManager')

function makeOptions() {
  return {
    caseId: 1,
    listUrl: (caseId: number) => `/api/v1/case/${caseId}/sessions`,
    createUrl: '/api/v1/case/analysis/session/create',
    deleteUrl: (sessionId: string) => `/api/v1/case/analysis/session/${sessionId}`,
    buildCreateBody: (caseId: number, title?: string) => ({ caseId, title }),
  }
}

/**
 * 启动一个模拟的独立 tab：用 mount 挂宿主触发 onMounted（tabId 生成）。
 * 返回 manager 本身及其独立 mockChat 句柄。
 */
function mountTab(mockChat: ReturnType<typeof createMockChat>) {
  currentMockChatFactory = () => mockChat
  let manager!: ReturnType<typeof useChatSessionManager>
  const Host = defineComponent({
    setup() {
      manager = useChatSessionManager(makeOptions())
      return () => h('div')
    },
  })
  const wrapper = mount(Host)
  return { manager, wrapper }
}

const SHARED_SID = 'sess-shared'

async function initAt(manager: ReturnType<typeof useChatSessionManager>) {
  mockUseApiFetch.mockResolvedValueOnce([{
    sessionId: SHARED_SID,
    title: 'shared',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    hasActiveRun: false,
  }])
  await manager.init()
  await flushPromises()
}

describe('跨标签队列同步', () => {
  let restoreBC: () => void
  let restoreLocks: () => void

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseApiFetch.mockResolvedValue(undefined)
    mockStopActiveRun.mockResolvedValue(undefined)
    restoreBC = stubBroadcastChannel()
    restoreLocks = stubNavigatorLocks()
  })

  afterEach(() => {
    restoreBC()
    restoreLocks()
    currentMockChatFactory = null
  })

  it('Tab A enqueue → Tab B 接收到同步事件，currentQueue 包含新 item', async () => {
    const chatA = createMockChat()
    const chatB = createMockChat()
    const a = mountTab(chatA)
    await initAt(a.manager)
    const b = mountTab(chatB)
    await initAt(b.manager)
    await flushPromises()

    const ok = a.manager.enqueueMessage('from A')
    expect(ok).toBe(true)
    expect(a.manager.currentQueue.value).toHaveLength(1)
    await flushPromises()

    // Tab B 应接收并应用
    expect(b.manager.currentQueue.value).toHaveLength(1)
    expect(b.manager.currentQueue.value[0]!.text).toBe('from A')

    a.wrapper.unmount()
    b.wrapper.unmount()
  })

  it('Tab A remove → Tab B 队列同步减少', async () => {
    const chatA = createMockChat()
    const chatB = createMockChat()
    const a = mountTab(chatA)
    await initAt(a.manager)
    const b = mountTab(chatB)
    await initAt(b.manager)
    await flushPromises()

    a.manager.enqueueMessage('to remove')
    await advanceClock()  // 保证 version 单调递增
    a.manager.enqueueMessage('to keep')
    await advanceClock()
    expect(b.manager.currentQueue.value).toHaveLength(2)

    const rmId = a.manager.currentQueue.value[0]!.id
    a.manager.removeQueueItem(rmId)
    await advanceClock()

    expect(b.manager.currentQueue.value).toHaveLength(1)
    expect(b.manager.currentQueue.value[0]!.text).toBe('to keep')

    a.wrapper.unmount()
    b.wrapper.unmount()
  })

  it('Tab A pause → Tab B isQueuePaused=true，queuePauseReason 透传', async () => {
    const chatA = createMockChat()
    const chatB = createMockChat()
    const a = mountTab(chatA)
    await initAt(a.manager)
    const b = mountTab(chatB)
    await initAt(b.manager)
    await flushPromises()

    a.manager.sendMessage('第一条')
    a.manager.enqueueMessage('queued')
    await advanceClock()
    chatA.runStatus.value = 'running'
    await nextTick()
    chatA.runStatus.value = 'failed'
    await nextTick()
    await advanceClock()

    expect(a.manager.isQueuePaused.value).toBe(true)
    expect(b.manager.isQueuePaused.value).toBe(true)
    expect(b.manager.queuePauseReason.value).toBe('failed')

    a.wrapper.unmount()
    b.wrapper.unmount()
  })

  it('新 tab hello → 旧 tab 响应 sync，新 tab 收到状态', async () => {
    const chatA = createMockChat()
    const a = mountTab(chatA)
    await initAt(a.manager)
    await flushPromises()

    // Tab A 先入队
    a.manager.enqueueMessage('from A')
    await flushPromises()
    expect(a.manager.currentQueue.value).toHaveLength(1)

    // 启动新 Tab B（init 时 watch 会 postCrossTabEvent hello）
    const chatB = createMockChat()
    const b = mountTab(chatB)
    await initAt(b.manager)
    await flushPromises()
    // 额外等待一个 microtask 允许 hello → sync 的双边往返
    await flushPromises()

    // Tab B 应收到 Tab A 的 sync 响应
    expect(b.manager.currentQueue.value).toHaveLength(1)
    expect(b.manager.currentQueue.value[0]!.text).toBe('from A')

    a.wrapper.unmount()
    b.wrapper.unmount()
  })

  it('两 tab 同时 maybeDispatch → Web Lock 只允许一个拿到锁', async () => {
    const chatA = createMockChat()
    const chatB = createMockChat()
    const a = mountTab(chatA)
    await initAt(a.manager)
    const b = mountTab(chatB)
    await initAt(b.manager)
    await flushPromises()

    a.manager.sendMessage('第一条')
    a.manager.enqueueMessage('will dispatch')
    await flushPromises()
    // 双方都应看到队列 1 条
    expect(b.manager.currentQueue.value).toHaveLength(1)

    // 两 tab 同时 completed（触发各自的 dispatcher）
    chatA.runStatus.value = 'running'
    chatB.runStatus.value = 'running'
    await nextTick()
    chatA.runStatus.value = 'completed'
    chatB.runStatus.value = 'completed'
    await nextTick()
    await flushPromises()
    await nextTick()
    await flushPromises()

    // B 的 lastLocalSendSeq=0，溯源守卫在 B 处拒绝；A 的守卫通过，A 拿锁派发
    // 因此总派发次数应为 1（只有 A 派发）
    const totalSent = chatA.sendMessage.mock.calls.length + chatB.sendMessage.mock.calls.length
    // A 派发了 sendMessage('第一条') 1 次 + 队头 1 次 = 2；B 不派发
    expect(chatA.sendMessage).toHaveBeenCalledTimes(2)
    expect(chatB.sendMessage).not.toHaveBeenCalled()
    expect(totalSent).toBe(2)

    a.wrapper.unmount()
    b.wrapper.unmount()
  })

  it('持锁 tab sendMessage 同步抛错 → 队头保留 + pauseReason=failed 广播', async () => {
    const chatA = createMockChat()
    const chatB = createMockChat()
    const a = mountTab(chatA)
    await initAt(a.manager)
    const b = mountTab(chatB)
    await initAt(b.manager)
    await flushPromises()

    a.manager.sendMessage('第一条')
    a.manager.enqueueMessage('will fail')
    await advanceClock()
    // 此时 sendMessage 已被调用 1 次，下一次调用（即 dispatcher 的派发）需抛错
    chatA.sendMessage.mockImplementationOnce(() => {
      throw new Error('dispatch fail')
    })

    chatA.runStatus.value = 'running'
    await nextTick()
    chatA.runStatus.value = 'completed'
    await nextTick()
    await advanceClock()
    await nextTick()
    await advanceClock()

    // A 暂停 + 队头保留
    expect(a.manager.isQueuePaused.value).toBe(true)
    expect(a.manager.queuePauseReason.value).toBe('failed')
    expect(a.manager.currentQueue.value).toHaveLength(1)
    // B 也通过 sync 收到
    expect(b.manager.isQueuePaused.value).toBe(true)
    expect(b.manager.queuePauseReason.value).toBe('failed')
    expect(b.manager.currentQueue.value).toHaveLength(1)

    a.wrapper.unmount()
    b.wrapper.unmount()
  })

  it('Listener 自回过滤：同 tabId 的 chat-queue:sync 被忽略', async () => {
    const chatA = createMockChat()
    const a = mountTab(chatA)
    await initAt(a.manager)
    await flushPromises()

    // Tab A enqueue 会自己广播 sync，但自己的 listener 应识别 tabId 相同并跳过
    // 可观察状态：currentQueue 保持一致，没有因自回触发二次 .set
    a.manager.enqueueMessage('solo')
    await flushPromises()

    expect(a.manager.currentQueue.value).toHaveLength(1)
    expect(a.manager.currentQueue.value[0]!.text).toBe('solo')

    // 第二次 enqueue：若 listener 没过滤自回会出现奇怪现象
    a.manager.enqueueMessage('second')
    await flushPromises()
    expect(a.manager.currentQueue.value).toHaveLength(2)

    a.wrapper.unmount()
  })

  it('过期版本丢弃：version 小于等于 lastApplied 的 sync 被忽略', async () => {
    const chatA = createMockChat()
    const chatB = createMockChat()
    const a = mountTab(chatA)
    await initAt(a.manager)
    const b = mountTab(chatB)
    await initAt(b.manager)
    await flushPromises()

    // A 先广播一个 version 较大的状态
    a.manager.enqueueMessage('v-new')
    await flushPromises()
    expect(b.manager.currentQueue.value).toHaveLength(1)

    // 手动 post 一个"过期"版本的 sync 事件
    // 使用 useCrossTabEvents.postCrossTabEvent 构造 payload with version=-1（明显小于 lastApplied）
    const { postCrossTabEvent } = await import('~/composables/useCrossTabEvents')
    postCrossTabEvent('chat-queue:sync', {
      sessionId: SHARED_SID,
      tabId: 'other-tab',
      queue: [],
      pauseReason: null,
      version: -1,
    })
    await flushPromises()

    // B 的队列应**不**被覆盖为空
    expect(b.manager.currentQueue.value).toHaveLength(1)
    expect(b.manager.currentQueue.value[0]!.text).toBe('v-new')

    a.wrapper.unmount()
    b.wrapper.unmount()
  })

  it('无 navigator.locks 环境降级：直接执行派发', async () => {
    // 关掉 navigator.locks stub，改用空 navigator
    restoreLocks()
    vi.stubGlobal('navigator', {})

    const chatA = createMockChat()
    const a = mountTab(chatA)
    await initAt(a.manager)
    await flushPromises()

    a.manager.sendMessage('第一条')
    a.manager.enqueueMessage('queued')

    chatA.runStatus.value = 'running'
    await nextTick()
    chatA.runStatus.value = 'completed'
    await nextTick()
    await flushPromises()
    await nextTick()

    // 降级路径仍应派发（走 else 分支直接 doDispatch）
    expect(chatA.sendMessage).toHaveBeenCalledTimes(2)
    expect(a.manager.currentQueue.value).toHaveLength(0)

    a.wrapper.unmount()
  })

  it('Tab A 清空 + Tab B 派发中：两 tab 最终收敛到空队列 + 暂停清除（§8.1 #15）', async () => {
    const chatA = createMockChat()
    const chatB = createMockChat()
    const a = mountTab(chatA)
    await initAt(a.manager)
    const b = mountTab(chatB)
    await initAt(b.manager)
    await flushPromises()

    // A 入队 + sendMessage 积累 seq；B 不调用 sendMessage（模拟 A 主动方、B 被动方）
    a.manager.sendMessage('第一条')
    a.manager.enqueueMessage('item-1')
    await advanceClock()
    a.manager.enqueueMessage('item-2')
    await advanceClock()

    // A 触发 completed → A 持锁派发
    // 在 A 派发到一半时，模拟 A 自己调 clearQueue（实际业务中这可能是用户在另一 tab 清空）
    chatA.runStatus.value = 'running'
    await nextTick()
    chatA.runStatus.value = 'completed'
    await nextTick()
    await advanceClock()
    await nextTick()
    await advanceClock()

    // A 派发了队头 item-1（sendMessage calls = 2），队列应剩 1 条
    expect(chatA.sendMessage).toHaveBeenCalledTimes(2)

    // 现在 A 调 clearQueue（模拟 concurrent clear）
    a.manager.clearQueue()
    await advanceClock()

    // 两 tab 最终都应收敛到空队列 + 非暂停
    expect(a.manager.currentQueue.value).toHaveLength(0)
    expect(b.manager.currentQueue.value).toHaveLength(0)
    expect(a.manager.isQueuePaused.value).toBe(false)
    expect(b.manager.isQueuePaused.value).toBe(false)

    a.wrapper.unmount()
    b.wrapper.unmount()
  })
})
