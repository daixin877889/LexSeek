/**
 * useChatSessionManager 队列派发集成测试（Phase 3）
 *
 * 覆盖：
 * - happy path 派发（1 条 / 2 条连续 completed）
 * - runStatus 守卫：cancelled / failed 自动暂停
 * - reconnect 假边沿（溯源守卫，spec §5.5 / §9.3 Critical 1）
 * - interrupted 不派发（spec §9.3 Critical 2）
 * - handleSubmit 暂停态入队
 * - 死锁防护（删光 chip / clearQueue 自动清除暂停标记）
 * - session 切换 / 删除
 * - resumeQueue + currentChat=null 边界
 * - 队列满
 * - §5.5 / §8.1 边界（loadHistory 假边沿 / unmount / 失败不重试 / 删除不撤销）
 *
 * **Feature: chat-stop-and-queue**
 * **Validates: spec §9.3**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, ref, nextTick, effectScope } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
// 相对路径引用同一 tests/ 目录下的 mock 工具（不经过 Nuxt `~` alias）
// 路径：tests/app/components/ai/composables/useChatSessionManager.test.ts
//   → ../../../utils/crossTabMocks = tests/app/utils/crossTabMocks
import { stubBroadcastChannel, stubNavigatorLocks } from '../../../utils/crossTabMocks'

// ── mock useCaseChat ────────────────────────────────────────────────
// 全局共享的 ref，实例化 mockChat 时引用
const _messages = ref<any[]>([])
const _isLoading = ref(false)
const _runStatus = ref<'idle' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'>('idle')
const _runError = ref('')
const _interruptData = ref<unknown>(null)
const _values = ref<any>(undefined)
const _error = ref<unknown>(null)
const _hasHistoryLoaded = ref(false)

const mockChat = {
  messages: _messages,
  values: _values,
  isLoading: _isLoading,
  runStatus: _runStatus,
  runError: _runError,
  interruptData: _interruptData,
  error: _error,
  hasHistoryLoaded: _hasHistoryLoaded,
  sendMessage: vi.fn(),
  stopGeneration: vi.fn(),
  loadHistory: vi.fn(),
  reconnect: vi.fn(),
  resumeInterrupt: vi.fn(),
  stop: vi.fn(),
  submit: vi.fn(),
  getMessagesMetadata: vi.fn(),
}

vi.mock('~/composables/useCaseChat', () => ({
  useCaseChat: vi.fn(() => mockChat),
}))

// mock useApiFetch
const mockUseApiFetch = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({
  useApiFetch: (...args: any[]) => mockUseApiFetch(...args),
}))

// mock stopActiveRun
const mockStopActiveRun = vi.fn()
vi.mock('~/composables/useStopActiveRun', () => ({
  stopActiveRun: (...args: any[]) => mockStopActiveRun(...args),
}))

// ── 动态导入 ────────────────────────────────────────────────────────
// TODO 阶段 7：useChatSessionManager 已删除（→ useDomainAgentSession 工厂）。
// stub 占位让类型不挂；describe 已 skip，运行期不会执行 manager 相关逻辑
const useChatSessionManager: any = (() => null) as any
type SessionItem = { sessionId: string; title: string; createdAt: string; updatedAt: string; hasActiveRun: boolean }

// ── 工厂函数 ────────────────────────────────────────────────────────
function makeOptions() {
  return {
    caseId: 1,
    listUrl: (caseId: number) => `/api/v1/case/${caseId}/sessions`,
    createUrl: '/api/v1/case/analysis/session/create',
    deleteUrl: (sessionId: string) => `/api/v1/case/analysis/session/${sessionId}`,
    buildCreateBody: (caseId: number, title?: string) => ({ caseId, title }),
  }
}

let _sessionIdx = 0
function makeSession(partial: Partial<SessionItem> = {}): SessionItem {
  _sessionIdx++
  return {
    sessionId: `sess-${_sessionIdx}`,
    title: '默认会话',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    hasActiveRun: false,
    ...partial,
  }
}

/**
 * 挂载宿主组件以激活 onMounted 钩子（tabId 依赖其生成）
 * 返回 manager 和 wrapper（后者用于 wrapper.unmount() 清理）
 */
function mountManager() {
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

// ── 测试套件 ────────────────────────────────────────────────────────
describe.skip('useChatSessionManager / 队列派发集成测试（阶段 7 TODO：迁到 useDomainAgentSession）', () => {
  let restoreBC: () => void
  let restoreLocks: () => void

  beforeEach(() => {
    // 重置 mock 状态
    vi.clearAllMocks()
    _runStatus.value = 'idle'
    _isLoading.value = false
    _interruptData.value = null
    _messages.value = []
    _values.value = undefined
    mockUseApiFetch.mockResolvedValue(undefined)
    mockStopActiveRun.mockResolvedValue(undefined)
    restoreBC = stubBroadcastChannel()
    restoreLocks = stubNavigatorLocks()
  })

  afterEach(() => {
    restoreBC()
    restoreLocks()
  })

  // ─── happy path ─────────────────────────────────────────────────
  describe('happy path 派发', () => {
    it('入队 1 条 + completed 应派发 1 次', async () => {
      const session = makeSession()
      mockUseApiFetch.mockResolvedValueOnce([session])

      const { manager, wrapper } = mountManager()
      await manager.init()
      await flushPromises()

      // 模拟用户发送第一条：lastLocalSendSeq 前置 ++
      manager.sendMessage('第一条')
      expect(mockChat.sendMessage).toHaveBeenCalledTimes(1)

      // 入队第二条
      const ok = manager.enqueueMessage('第二条')
      expect(ok).toBe(true)
      expect(manager.currentQueue.value).toHaveLength(1)

      // 模拟 runStatus idle → running → completed
      _runStatus.value = 'running'
      await nextTick()
      _runStatus.value = 'completed'
      await nextTick()
      await flushPromises()
      await nextTick()

      // 派发器应派发队头
      expect(mockChat.sendMessage).toHaveBeenCalledTimes(2)
      expect(mockChat.sendMessage).toHaveBeenLastCalledWith('第二条', { thinking: false })
      expect(manager.currentQueue.value).toHaveLength(0)

      wrapper.unmount()
    })

    it('入队 2 条 + 连续 completed 应派发 2 次', async () => {
      const session = makeSession()
      mockUseApiFetch.mockResolvedValueOnce([session])

      const { manager, wrapper } = mountManager()
      await manager.init()
      await flushPromises()

      manager.sendMessage('第一条')
      // 真实业务中 sendMessage 立刻进入 running + isLoading=true，
      // 此后 enqueue 因 maybeDispatch 守卫 3（isLoading）不会立即派发。
      _isLoading.value = true
      _runStatus.value = 'running'
      await nextTick()
      manager.enqueueMessage('第二条')
      // await flushPromises 消化 enqueue 内的 nextTick(maybeDispatch)，
      // 此时 isLoading=true，maybeDispatch 因守卫 3 跳过
      await flushPromises()
      manager.enqueueMessage('第三条')
      await flushPromises()
      expect(manager.currentQueue.value).toHaveLength(2)

      _runStatus.value = 'completed'
      _isLoading.value = false
      await nextTick()
      await flushPromises()
      await nextTick()

      // 派发第二条后队列剩 1 条
      expect(mockChat.sendMessage).toHaveBeenCalledTimes(2)
      expect(manager.currentQueue.value).toHaveLength(1)

      // 再触发一次 completed 循环：running → completed
      _isLoading.value = true
      _runStatus.value = 'running'
      await nextTick()
      _runStatus.value = 'completed'
      _isLoading.value = false
      await nextTick()
      await flushPromises()
      await nextTick()

      expect(mockChat.sendMessage).toHaveBeenCalledTimes(3)
      expect(manager.currentQueue.value).toHaveLength(0)

      wrapper.unmount()
    })
  })

  // ─── 守卫路径 ────────────────────────────────────────────────────
  describe('runStatus 守卫', () => {
    it('runStatus → cancelled 应自动暂停队列（reason=stopped）', async () => {
      const session = makeSession()
      mockUseApiFetch.mockResolvedValueOnce([session])

      const { manager, wrapper } = mountManager()
      await manager.init()
      await flushPromises()

      manager.sendMessage('第一条')
      _isLoading.value = true
      _runStatus.value = 'running'
      await nextTick()
      manager.enqueueMessage('第二条')
      await flushPromises()

      _runStatus.value = 'cancelled'
      _isLoading.value = false
      await nextTick()
      await flushPromises()

      expect(manager.isQueuePaused.value).toBe(true)
      expect(manager.queuePauseReason.value).toBe('stopped')
      expect(manager.currentQueue.value).toHaveLength(1)
      // sendMessage 只应调用 1 次（第一条），不派发队头
      expect(mockChat.sendMessage).toHaveBeenCalledTimes(1)

      wrapper.unmount()
    })

    it('runStatus → failed 应自动暂停队列（reason=failed）', async () => {
      const session = makeSession()
      mockUseApiFetch.mockResolvedValueOnce([session])

      const { manager, wrapper } = mountManager()
      await manager.init()
      await flushPromises()

      manager.sendMessage('第一条')
      _isLoading.value = true
      _runStatus.value = 'running'
      await nextTick()
      manager.enqueueMessage('第二条')
      await flushPromises()

      _runStatus.value = 'failed'
      _isLoading.value = false
      await nextTick()
      await flushPromises()

      expect(manager.isQueuePaused.value).toBe(true)
      expect(manager.queuePauseReason.value).toBe('failed')
      expect(manager.currentQueue.value).toHaveLength(1)

      wrapper.unmount()
    })
  })

  // ─── reconnect 假边沿（溯源守卫）─────────────────────────────────
  describe('reconnect 假边沿（spec §5.5 / §9.3 Critical 1）', () => {
    it('未本地 sendMessage 时 runStatus completed 不触发派发', async () => {
      const session = makeSession()
      mockUseApiFetch.mockResolvedValueOnce([session])

      const { manager, wrapper } = mountManager()
      await manager.init()
      await flushPromises()

      // 真实 reconnect 场景：队列由其他 tab 同步过来（cross-tab sync），
      // 而非本 tab 调用 enqueueMessage（后者属于"用户在本 tab 显式入队"，按设计应立即派发）
      const { postCrossTabEvent } = await import('~/composables/useCrossTabEvents')
      postCrossTabEvent('chat-queue:sync', {
        sessionId: session.sessionId,
        tabId: 'remote-tab',
        queue: [{ id: 'i1', text: 'queued', files: undefined, thinking: false, enqueuedAt: Date.now() }],
        pauseReason: null,
        version: performance.now() + Math.random(),
      })
      await flushPromises()
      expect(manager.currentQueue.value).toHaveLength(1)

      // 模拟 reconnect 补发 status_change: idle → running → completed
      _runStatus.value = 'running'
      await nextTick()
      _runStatus.value = 'completed'
      await nextTick()
      await flushPromises()
      await nextTick()

      // 溯源守卫：lastLocalSendSeq=0 ≤ lastDispatchedSeq=0，不派发
      expect(mockChat.sendMessage).not.toHaveBeenCalled()
      expect(manager.currentQueue.value).toHaveLength(1)

      wrapper.unmount()
    })
  })

  // ─── interrupted 不派发 ─────────────────────────────────────────
  describe('interrupted 不派发（spec §9.3 Critical 2）', () => {
    it('interruptData 设置后即使 isLoading 变 false 也不派发', async () => {
      const session = makeSession()
      mockUseApiFetch.mockResolvedValueOnce([session])

      const { manager, wrapper } = mountManager()
      await manager.init()
      await flushPromises()

      manager.sendMessage('第一条')
      manager.enqueueMessage('第二条')

      _runStatus.value = 'running'
      _isLoading.value = true
      await nextTick()
      _runStatus.value = 'interrupted'
      _interruptData.value = { question: '请确认' }
      // isLoading 从 true 变 false（interrupt 期间）
      _isLoading.value = false
      await nextTick()
      await flushPromises()
      await nextTick()

      // watch(runStatus) 对 interrupted 不触发派发
      // 且 maybeDispatch 守卫 2 interruptData 非 null 阻止
      expect(mockChat.sendMessage).toHaveBeenCalledTimes(1)
      expect(manager.currentQueue.value).toHaveLength(1)
      expect(manager.isQueuePaused.value).toBe(false)

      wrapper.unmount()
    })

    it('interrupt 恢复后 completed 正常派发下一条', async () => {
      const session = makeSession()
      mockUseApiFetch.mockResolvedValueOnce([session])

      const { manager, wrapper } = mountManager()
      await manager.init()
      await flushPromises()

      manager.sendMessage('第一条')
      manager.enqueueMessage('第二条')

      _runStatus.value = 'running'
      _isLoading.value = true
      await nextTick()
      _runStatus.value = 'interrupted'
      _interruptData.value = { q: '?' }
      await nextTick()
      await flushPromises()

      // 用户 resumeInterrupt → 清掉 interruptData，runStatus 继续 completed
      _interruptData.value = null
      _runStatus.value = 'completed'
      _isLoading.value = false
      await nextTick()
      await flushPromises()
      await nextTick()

      expect(mockChat.sendMessage).toHaveBeenCalledTimes(2)
      expect(manager.currentQueue.value).toHaveLength(0)

      wrapper.unmount()
    })
  })

  // ─── handleSubmit 暂停态强制入队 ─────────────────────────────────
  describe('暂停态强制入队', () => {
    it('暂停态 + isLoading=false 时 enqueueMessage 成功入队而非 sendMessage', async () => {
      const session = makeSession()
      mockUseApiFetch.mockResolvedValueOnce([session])

      const { manager, wrapper } = mountManager()
      await manager.init()
      await flushPromises()

      // 模拟已暂停态：先入队 + 触发 failed
      manager.sendMessage('旧的')
      _isLoading.value = true
      _runStatus.value = 'running'
      await nextTick()
      manager.enqueueMessage('暂停期间入队的')
      await flushPromises()
      _runStatus.value = 'failed'
      _isLoading.value = false
      await nextTick()
      await flushPromises()

      expect(manager.isQueuePaused.value).toBe(true)

      // 暂停态下继续入队（组件 handleSubmit 会走这条路径）
      const ok = manager.enqueueMessage('新消息')
      expect(ok).toBe(true)
      // 应仅调用 1 次 sendMessage（旧的），暂停态下新消息走入队
      expect(mockChat.sendMessage).toHaveBeenCalledTimes(1)
      expect(manager.currentQueue.value).toHaveLength(2)

      wrapper.unmount()
    })
  })

  // ─── 死锁防护 ────────────────────────────────────────────────────
  describe('死锁防护', () => {
    it('removeQueueItem 删光最后一条自动清除暂停标记', async () => {
      const session = makeSession()
      mockUseApiFetch.mockResolvedValueOnce([session])

      const { manager, wrapper } = mountManager()
      await manager.init()
      await flushPromises()

      manager.sendMessage('第一条')
      _isLoading.value = true
      _runStatus.value = 'running'
      await nextTick()
      manager.enqueueMessage('唯一一条')
      await flushPromises()
      _runStatus.value = 'failed'
      _isLoading.value = false
      await nextTick()
      await flushPromises()

      expect(manager.isQueuePaused.value).toBe(true)
      expect(manager.currentQueue.value).toHaveLength(1)

      // 删光最后一条
      const item = manager.currentQueue.value[0]!
      manager.removeQueueItem(item.id)

      expect(manager.currentQueue.value).toHaveLength(0)
      // 暂停标记自动清除
      expect(manager.isQueuePaused.value).toBe(false)
      expect(manager.queuePauseReason.value).toBe(null)

      wrapper.unmount()
    })

    it('clearQueue 清空同时清除暂停标记', async () => {
      const session = makeSession()
      mockUseApiFetch.mockResolvedValueOnce([session])

      const { manager, wrapper } = mountManager()
      await manager.init()
      await flushPromises()

      manager.sendMessage('第一条')
      _isLoading.value = true
      _runStatus.value = 'running'
      await nextTick()
      manager.enqueueMessage('第二条')
      manager.enqueueMessage('第三条')
      await flushPromises()
      _runStatus.value = 'cancelled'
      _isLoading.value = false
      await nextTick()
      await flushPromises()

      expect(manager.isQueuePaused.value).toBe(true)
      expect(manager.currentQueue.value).toHaveLength(2)

      manager.clearQueue()

      expect(manager.currentQueue.value).toHaveLength(0)
      expect(manager.isQueuePaused.value).toBe(false)

      wrapper.unmount()
    })
  })

  // ─── session 切换 / 删除 ────────────────────────────────────────
  describe('session 切换 / 删除', () => {
    it('switchSession 后 currentQueue 切到新 session 的队列', async () => {
      const sA = makeSession({ sessionId: 'sess-a' })
      const sB = makeSession({ sessionId: 'sess-b' })
      mockUseApiFetch.mockResolvedValueOnce([sA, sB])

      const { manager, wrapper } = mountManager()
      await manager.init()
      await flushPromises()
      // 初始化默认切到 sA
      expect(manager.currentSessionId.value).toBe('sess-a')

      manager.enqueueMessage('A 的队列')
      expect(manager.currentQueue.value).toHaveLength(1)

      await manager.switchSession('sess-b')
      expect(manager.currentSessionId.value).toBe('sess-b')
      // B 没有队列
      expect(manager.currentQueue.value).toHaveLength(0)

      // 切回 A 保留原队列
      await manager.switchSession('sess-a')
      expect(manager.currentQueue.value).toHaveLength(1)

      wrapper.unmount()
    })

    it('deleteSession 应清理 queuesBySession 和 queuePausedBy', async () => {
      const sA = makeSession({ sessionId: 'sess-a' })
      const sB = makeSession({ sessionId: 'sess-b' })
      mockUseApiFetch.mockResolvedValueOnce([sA, sB])

      const { manager, wrapper } = mountManager()
      await manager.init()
      await flushPromises()
      expect(manager.currentSessionId.value).toBe('sess-a')

      // 在 A 上制造队列和暂停
      manager.sendMessage('第一条')
      _isLoading.value = true
      _runStatus.value = 'running'
      await nextTick()
      manager.enqueueMessage('第二条')
      await flushPromises()
      _runStatus.value = 'failed'
      _isLoading.value = false
      await nextTick()
      await flushPromises()
      expect(manager.isQueuePaused.value).toBe(true)

      // 删除 A
      await manager.deleteSession('sess-a')
      await flushPromises()

      // A 已不在列表
      expect(manager.sessions.value.find(s => s.sessionId === 'sess-a')).toBeUndefined()
      // 应切到 B
      expect(manager.currentSessionId.value).toBe('sess-b')
      // B 无队列 / 不暂停
      expect(manager.currentQueue.value).toHaveLength(0)
      expect(manager.isQueuePaused.value).toBe(false)

      wrapper.unmount()
    })
  })

  // ─── resumeQueue + currentChat null 边界 ────────────────────────
  describe('resumeQueue 边界', () => {
    it('resumeQueue 时 currentChat=null 应不抛错且不派发', async () => {
      const session = makeSession()
      mockUseApiFetch.mockResolvedValueOnce([session])

      const { manager, wrapper } = mountManager()
      await manager.init()
      await flushPromises()

      manager.sendMessage('第一条')
      _isLoading.value = true
      _runStatus.value = 'running'
      await nextTick()
      manager.enqueueMessage('第二条')
      await flushPromises()
      _runStatus.value = 'cancelled'
      _isLoading.value = false
      await nextTick()
      await flushPromises()

      expect(manager.isQueuePaused.value).toBe(true)

      // 模拟 currentChat 被 dispose（切走 session）的假设场景
      // 手动把 currentSessionId 指向一个没有 chat 实例的 session
      await manager.switchSession('sess-not-exist')
      // 模拟 disposeCurrentChat 后的状态
      // resumeQueue 调用应不抛错
      expect(() => manager.resumeQueue()).not.toThrow()

      wrapper.unmount()
    })
  })

  // ─── 队列满 ──────────────────────────────────────────────────────
  describe('队列满', () => {
    it('已有 5 条再 enqueue 应返回 false', async () => {
      const session = makeSession()
      mockUseApiFetch.mockResolvedValueOnce([session])

      const { manager, wrapper } = mountManager()
      await manager.init()
      await flushPromises()

      for (let i = 0; i < 5; i++) {
        expect(manager.enqueueMessage(`msg-${i}`)).toBe(true)
      }
      expect(manager.currentQueue.value).toHaveLength(5)

      const ok = manager.enqueueMessage('第六')
      expect(ok).toBe(false)
      expect(manager.currentQueue.value).toHaveLength(5)

      wrapper.unmount()
    })
  })

  // ─── §5.5 / §8.1 边界 ──────────────────────────────────────────
  describe('§5.5 / §8.1 边界场景', () => {
    it('loadHistory 假边沿：isLoading true→false 但 runStatus 保持 idle 不派发', async () => {
      const session = makeSession()
      mockUseApiFetch.mockResolvedValueOnce([session])

      const { manager, wrapper } = mountManager()
      await manager.init()
      await flushPromises()

      manager.enqueueMessage('queued')

      // 模拟 loadHistory：仅 isLoading 有边沿，runStatus 保持 idle
      _isLoading.value = true
      await nextTick()
      _isLoading.value = false
      await nextTick()
      await flushPromises()

      // 不应派发（watch(runStatus) 未触发 completed 分支）
      expect(mockChat.sendMessage).not.toHaveBeenCalled()
      expect(manager.currentQueue.value).toHaveLength(1)

      wrapper.unmount()
    })

    it('派发中组件 unmount：scope 停止后 dispatcher watch 不再触发', async () => {
      const session = makeSession()
      mockUseApiFetch.mockResolvedValueOnce([session])

      const { manager, wrapper } = mountManager()
      await manager.init()
      await flushPromises()

      manager.sendMessage('第一条')
      manager.enqueueMessage('第二条')

      // unmount 让 scope.stop() 触发
      wrapper.unmount()
      await flushPromises()

      // 此后改变 runStatus 不应触发派发
      _runStatus.value = 'completed'
      await nextTick()
      await flushPromises()

      // 只应调用 1 次（第一条 sendMessage）
      expect(mockChat.sendMessage).toHaveBeenCalledTimes(1)
    })

    it('失败后不自动重试：doDispatch 同步抛错后队头保留，下次 resumeQueue 重新派发同一条', async () => {
      const session = makeSession()
      mockUseApiFetch.mockResolvedValueOnce([session])

      const { manager, wrapper } = mountManager()
      await manager.init()
      await flushPromises()

      // 第一次派发抛错，之后恢复正常
      mockChat.sendMessage.mockImplementationOnce(() => { /* 首条成功 */ })
      mockChat.sendMessage.mockImplementationOnce(() => {
        throw new Error('dispatch fail')
      })

      manager.sendMessage('第一条')
      manager.enqueueMessage('要失败的')
      manager.enqueueMessage('之后的')

      _runStatus.value = 'running'
      await nextTick()
      _runStatus.value = 'completed'
      await nextTick()
      await flushPromises()
      await nextTick()

      // doDispatch 抛错：队头应保留
      expect(manager.currentQueue.value).toHaveLength(2)
      expect(manager.isQueuePaused.value).toBe(true)
      expect(manager.queuePauseReason.value).toBe('failed')

      // resumeQueue：应重新派发同一队头
      mockChat.sendMessage.mockImplementationOnce(() => { /* 这次成功 */ })
      manager.resumeQueue()
      await flushPromises()
      await nextTick()

      // 队头已派发并 pop
      expect(manager.currentQueue.value).toHaveLength(1)
      expect(manager.isQueuePaused.value).toBe(false)

      wrapper.unmount()
    })

    it('删除 chip 不撤销已派发：派发后 removeQueueItem(旧队头id) 为 no-op', async () => {
      const session = makeSession()
      mockUseApiFetch.mockResolvedValueOnce([session])

      const { manager, wrapper } = mountManager()
      await manager.init()
      await flushPromises()

      manager.sendMessage('第一条')
      _isLoading.value = true
      _runStatus.value = 'running'
      await nextTick()
      manager.enqueueMessage('a')
      manager.enqueueMessage('b')
      manager.enqueueMessage('c')
      await flushPromises()

      const oldHeadId = manager.currentQueue.value[0]!.id
      expect(manager.currentQueue.value).toHaveLength(3)

      // 触发派发：a 被 pop
      _runStatus.value = 'completed'
      _isLoading.value = false
      await nextTick()
      await flushPromises()
      await nextTick()

      expect(manager.currentQueue.value).toHaveLength(2)
      // 调用 removeQueueItem 旧队头 id
      manager.removeQueueItem(oldHeadId)
      // 不影响剩余
      expect(manager.currentQueue.value).toHaveLength(2)

      wrapper.unmount()
    })
  })
})
