/**
 * 阶段 7 · 统一工厂：useDomainAgentSession
 *
 * 整合 useChatSessionManager + useStreamChat 的多 scope 工厂，
 * 为 6 个业务 composable 提供统一的会话管理、流处理、消息队列、跨标签同步、竞态防护。
 *
 * Scopes:
 * - 'case'：案件分析（小索 + 模块对话），caseId 必填
 * - 'legal_assistant'：法律助手，跨案件全局
 * - 'document'：文书生成
 * - 'contract'：合同审查
 * - 'case_analysis_init'：初分流程
 */

import { effectScope } from 'vue'
import type { EffectScope, MaybeRef, Ref } from 'vue'
import { nanoid } from 'nanoid'
import type { BaseMessage } from '@langchain/core/messages'
import type { AgentRunStatus } from '#shared/types/agentRun'
import {
  enqueueAction,
  type QueueItem,
  type QueuePauseReason,
} from '../chatQueueActions'
import { postCrossTabEvent, useCrossTabListener } from '../useCrossTabEvents'
import { useQueueDispatcher } from '../useQueueDispatcher'
import { useApiFetch } from '../useApiFetch'
import { useStreamChat } from '../useStreamChat'
import { useCaseChat } from '../useCaseChat'
import { stopActiveRun } from '../useStopActiveRun'

// ── 类型定义 ──

export interface SessionItem {
  sessionId: string
  title: string
  createdAt: string
  updatedAt: string
  hasActiveRun: boolean
}

export type DomainScope = 'case' | 'legal_assistant' | 'document' | 'contract' | 'case_analysis_init'

export interface SendOpts {
  thinking?: boolean
  files?: any[]
}

/**
 * sessionId 三种取值：
 * - 'auto'：多 session 模式，从后端列表选首个；空则自动创建
 * - string / Ref<string>：单 session 模式，sessionId 由调用方固定提供
 *   (document/contract/legal_assistant/case_analysis_init 默认走这一路)
 *   单 session 模式下：
 *     - init() 不调 fetchSessions / createSession，直接 switchSession 到提供的 id
 *     - sessions list 始终为空（UI 隐藏 sessions 列表）
 *     - deleteSession 后不会自动 createSession 或回切
 */
export type SessionIdConfig = 'auto' | string | MaybeRef<string>

export interface DomainAgentApiEndpoints {
  /** case scope 模块对话需要 moduleName 参数，故签名同时支持 caseId/moduleName */
  listUrl?: ((caseId?: number, moduleName?: string) => string) | null
  chatUrl?: string
  createUrl?: string | null
  deleteUrl?: ((sessionId: string) => string) | null
  renameUrl?: ((sessionId: string) => string) | null
}

export interface DomainAgentSessionConfig {
  scope: DomainScope
  /** 默认 'auto'。单 session 业务（document/contract/...）传字符串或 Ref<string> */
  sessionId?: SessionIdConfig
  userId: string
  caseId?: number  // scope='case' 时必填
  /** case scope 模块对话用，决定 listUrl 拼接 */
  moduleName?: string
  /** 业务方覆盖默认推断的 API 端点 */
  apiEndpoints?: DomainAgentApiEndpoints
  /**
   * 业务自定义事件钩子：在 useStreamChat 的 onCustomEvent 中调用
   *
   * 工厂内部已经处理了 status_change（驱动 runStatus），剩余 custom_event
   * （如 draft_ready / contract_stage / analysis_result_saved）通过此钩子透传给业务方。
   * 入参 data 是原始 SSE custom event payload，业务方按 name 分发。
   */
  onCustomEvent?: (data: unknown) => void
  /**
   * 流末回拉钩子：runStatus 进入 'completed' / 'failed' 时调用
   *
   * 用于 useDocumentDraft.refetchLatestDraft / useContractReview.refreshReview 等
   * "流完了 GET 业务实体" 的回拉场景。watch 在 setup 顶层注册，自动跟随调用方 scope 清理。
   */
  onStreamSettled?: (status: 'completed' | 'failed') => void | Promise<void>
}

// ── API 端点映射 ──

function getApiConfig(scope: DomainScope, sessionId: string, caseId?: number) {
  switch (scope) {
    case 'case':
      if (!caseId) throw new Error('scope=case 时 caseId 必填')
      return {
        listUrl: `/api/v1/case/analysis/xiaosuo-sessions?caseId=${caseId}`,
        createUrl: '/api/v1/case/analysis/xiaosuo-session',
        deleteUrl: (sid: string) => `/api/v1/case/analysis/xiaosuo-session/${sid}`,
        renameUrl: (sid: string) => `/api/v1/case/analysis/session/rename/${sid}`,
        chatUrl: '/api/v1/case/analysis/chat',
      }
    case 'legal_assistant':
      return {
        listUrl: '/api/v1/assistant/sessions',
        createUrl: '/api/v1/assistant/sessions',
        deleteUrl: (sid: string) => `/api/v1/assistant/sessions/${sid}`,
        renameUrl: (sid: string) => `/api/v1/assistant/sessions/${sid}/rename`,
        chatUrl: '/api/v1/assistant/chat',
      }
    case 'document':
      return {
        listUrl: '/api/v1/assistant/document/sessions',
        createUrl: '/api/v1/assistant/document/sessions',
        deleteUrl: (sid: string) => `/api/v1/assistant/document/sessions/${sid}`,
        renameUrl: (sid: string) => `/api/v1/assistant/document/sessions/${sid}/rename`,
        chatUrl: '/api/v1/assistant/document/chat',
      }
    case 'contract':
      return {
        listUrl: '/api/v1/assistant/contract/sessions',
        createUrl: '/api/v1/assistant/contract/sessions',
        deleteUrl: (sid: string) => `/api/v1/assistant/contract/sessions/${sid}`,
        renameUrl: (sid: string) => `/api/v1/assistant/contract/sessions/${sid}/rename`,
        chatUrl: '/api/v1/assistant/contract/chat',
      }
    case 'case_analysis_init':
      return {
        listUrl: '/api/v1/case/analysis/init-sessions',
        createUrl: '/api/v1/case/analysis/init-session',
        deleteUrl: (sid: string) => `/api/v1/case/analysis/init-session/${sid}`,
        renameUrl: (sid: string) => `/api/v1/case/analysis/init-session/${sid}/rename`,
        chatUrl: '/api/v1/case/analysis/init/chat',
      }
    default:
      const exhaustive: never = scope
      throw new Error(`未知 scope: ${exhaustive}`)
  }
}

// 事件分发器已移除：原空壳实现替换为 config.onCustomEvent + onStreamSettled 直注入
// （任务 1.4 - 业务事件 dispatcher 钩子）

// ── 主工厂函数 ──

export function useDomainAgentSession(config: DomainAgentSessionConfig) {
  const { scope, sessionId: sessionIdConfig = 'auto', userId, caseId, moduleName } = config

  // ── 解析 sessionId 配置 ──
  // 'auto' → 多 session 模式（fetchSessions + 选首个 / createSession）
  // 字符串 / Ref<string> → 单 session 模式（不 fetch / 不 create，直接绑定到该 id）
  const isSingleSessionMode = sessionIdConfig !== 'auto'
  const fixedSessionIdRef = isSingleSessionMode
    ? (typeof sessionIdConfig === 'string' ? ref(sessionIdConfig) : ref(unref(sessionIdConfig)))
    : null

  // 单 session 模式下：sessionIdConfig 是 Ref<string> 时随之更新 fixedSessionIdRef
  if (isSingleSessionMode && typeof sessionIdConfig !== 'string') {
    watch(
      () => unref(sessionIdConfig),
      (next) => {
        if (next && fixedSessionIdRef && fixedSessionIdRef.value !== next) {
          fixedSessionIdRef.value = next
          // sessionId 变更时切换底层 chat
          switchSession(next).catch((err) => {
            console.error('[useDomainAgentSession] switchSession failed', err)
          })
        }
      },
    )
  }

  // 任务 1.6 会替换为支持 moduleName + apiEndpoints 覆盖
  const apiConfig = getApiConfig(scope, fixedSessionIdRef?.value ?? '', caseId)

  // ── 会话状态（来自 useChatSessionManager 模式） ──
  const sessions = ref<SessionItem[]>([])
  const currentSessionId = ref<string>(fixedSessionIdRef?.value ?? '')
  const isSessionLoading = ref(false)
  const initialized = ref(false)

  // effectScope 管理（每 session 独立 scope）
  // currentChat 用 useCaseChat 类型（已封装 sendMessage / resumeInterrupt / stopGeneration）
  // 与 useQueueDispatcher.deps.currentChat 类型对齐
  type WrappedChat = ReturnType<typeof useCaseChat>
  let currentScope: EffectScope | null = null
  const currentChat = shallowRef<WrappedChat | null>(null)
  let switchCounter = 0

  function disposeCurrentChat() {
    if (currentScope) {
      currentScope.stop()
      currentScope = null
      currentChat.value = null
    }
  }

  // ── 代理当前对话状态 ──
  const messages = computed(() => currentChat.value?.messages?.value ?? [])
  const values = computed(() => currentChat.value?.values?.value)
  const isLoading = computed(() => currentChat.value?.isLoading?.value ?? false)
  const interruptData = computed(() => currentChat.value?.interruptData?.value)
  const runStatus = computed(() => currentChat.value?.runStatus?.value ?? 'idle')
  const runError = computed(() => currentChat.value?.runError?.value ?? '')

  // ── 队列状态（per-session 隔离）──
  const queuesBySession = reactive(new Map<string, QueueItem[]>())
  const queuePausedBy = reactive(new Map<string, Exclude<QueuePauseReason, null>>())
  const lastLocalSendSeq = ref(0)
  const lastAppliedVersion = new Map<string, number>()

  // tabId：跨标签同步标识
  let tabId = ''
  if (import.meta.client) {
    tabId = nanoid()
  }

  // ── 派生 computed ──
  const currentQueue = computed<QueueItem[]>(() => {
    const sid = currentSessionId.value
    if (!sid) return []
    return queuesBySession.get(sid) ?? []
  })

  const currentQueueLen = computed(() => currentQueue.value.length)

  const isQueuePaused = computed(() => {
    const sid = currentSessionId.value
    if (!sid) return false
    return queuePausedBy.get(sid) != null
  })

  const queuePauseReason = computed<QueuePauseReason>(() => {
    const sid = currentSessionId.value
    if (!sid) return null
    return queuePausedBy.get(sid) ?? null
  })

  // ── Session CRUD ──
  // 注：单 session 模式下，所有 CRUD API 都会 no-op + warn（业务方自行管理 sessionId 生命周期）

  async function fetchSessions() {
    if (isSingleSessionMode) return
    const result = await useApiFetch<SessionItem[]>(apiConfig.listUrl)
    if (result) {
      sessions.value = result
    }
  }

  async function createSession(title?: string): Promise<string> {
    if (isSingleSessionMode) {
      throw new Error('[useDomainAgentSession] 单 session 模式不支持 createSession，sessionId 由业务方提供')
    }

    const body: Record<string, any> = {}
    if (scope === 'case') {
      body.caseId = caseId
      body.title = title
    } else if (scope === 'legal_assistant') {
      body.title = title || '新对话'
    } else if (scope === 'document') {
      body.title = title || '新文书'
    } else if (scope === 'contract') {
      body.title = title || '新审查'
    } else if (scope === 'case_analysis_init') {
      body.caseId = caseId
      body.title = title || '初分分析'
    }

    const result = await useApiFetch<{ sessionId: string; title: string }>(
      apiConfig.createUrl,
      { method: 'POST', body },
    )
    if (!result?.sessionId) throw new Error('创建 session 失败')

    sessions.value = [
      {
        sessionId: result.sessionId,
        title: result.title,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        hasActiveRun: false,
      },
      ...sessions.value,
    ]

    await switchSession(result.sessionId)
    return result.sessionId
  }

  async function switchSession(sessionId: string) {
    const currentSwitch = ++switchCounter
    disposeCurrentChat()
    currentSessionId.value = sessionId

    const newScope = effectScope()
    const streamChat = newScope.run(() =>
      useStreamChat({
        apiUrl: apiConfig.chatUrl,
        threadId: sessionId,
        messagesKey: 'messages',
        // 业务自定义事件钩子直接注入：useStreamChat 已先消费 status_change，
        // 剩余 custom_event 透传给业务方按 name 分发
        onCustomEvent: config.onCustomEvent,
      }),
    )!

    if (currentSwitch !== switchCounter) {
      newScope.stop()
      return
    }

    currentScope = newScope
    // 在 streamChat 上叠加 sendMessage / resumeInterrupt / stopGeneration，
    // 类型与 useCaseChat 一致（dispatcher 也按 useCaseChat 的接口消费）
    const wrappedChat: WrappedChat = Object.assign(streamChat, {
      sendMessage: async (message: string, opts?: { thinking?: boolean; additional_kwargs?: Record<string, any> }) => {
        streamChat.runStatus.value = 'idle'
        const msgPayload: Record<string, any> = { type: 'human', content: message }
        if (opts?.additional_kwargs && Object.keys(opts.additional_kwargs).length > 0) {
          msgPayload.additional_kwargs = opts.additional_kwargs
        }
        await streamChat.submit({
          messages: [msgPayload],
          thinking: opts?.thinking,
        } as any, { optimisticValues: streamChat.values.value })
      },
      resumeInterrupt: (data: any) => {
        streamChat.runStatus.value = 'idle'
        streamChat.submit(undefined, { command: { resume: data } })
      },
      stopGeneration: () => streamChat.stop(),
    })
    currentChat.value = wrappedChat

    const session = sessions.value.find(s => s.sessionId === sessionId)
    if (session?.hasActiveRun) {
      wrappedChat.reconnect()
    } else {
      wrappedChat.loadHistory()
    }
  }

  async function deleteSession(sessionId: string) {
    if (isSingleSessionMode) {
      // 单 session 模式：业务方自行管理 sessionId 生命周期，工厂不做 CRUD
      console.warn('[useDomainAgentSession] deleteSession 在单 session 模式下被调用，已忽略')
      return
    }

    await stopActiveRun(sessionId).catch(() => {})

    await useApiFetch(apiConfig.deleteUrl(sessionId), { method: 'DELETE' })

    queuesBySession.delete(sessionId)
    queuePausedBy.delete(sessionId)
    lastAppliedVersion.delete(sessionId)
    dispatcher.broadcastState(sessionId)

    sessions.value = sessions.value.filter(s => s.sessionId !== sessionId)

    if (currentSessionId.value === sessionId) {
      if (sessions.value.length > 0) {
        await switchSession(sessions.value[0]!.sessionId)
      } else {
        await createSession()
      }
    }
  }

  async function renameSession(sessionId: string, newTitle: string) {
    if (isSingleSessionMode) {
      console.warn('[useDomainAgentSession] renameSession 在单 session 模式下被调用，已忽略')
      return
    }
    await useApiFetch(
      apiConfig.renameUrl(sessionId),
      { method: 'PATCH', body: { title: newTitle } },
    )
    sessions.value = sessions.value.map(s =>
      s.sessionId === sessionId ? { ...s, title: newTitle } : s,
    )
  }

  // ── 消息操作 ──

  /**
   * 顶层 sendMessage：与 dispatcher 走同一条路径（wrappedChat.sendMessage）
   *
   * 关键设计：dispatcher 第 129 行调的是 currentChat.value.sendMessage（wrappedChat），
   * 工厂顶层 sendMessage 也必须调 wrappedChat.sendMessage，让 wrappedChat 成为
   * **唯一发送入口**。这样：
   *   1. 顶层 sendMessage 经过 wrappedChat 内部的 runStatus reset / submit 守卫
   *   2. 未来在 wrappedChat 加守卫（如重发节流）时只改一处
   *   3. 避免出现"顶层和 dispatcher 走两条路径"的不一致 bug
   *
   * 多签名兼容（任务 1.5）：
   *   sendMessage(text: string, opts?: SendOpts)
   *   sendMessage(input: { text, files }, opts?: { thinking })
   * 第二种是 useAssistantChat 的 AiPromptSubmitData 形态。运行时按 typeof 分发。
   *
   * 附件预处理（files → attachments + sentinel）在此处完成，统一调 wrappedChat.sendMessage。
   */
  async function sendMessage(
    textOrInput: string | { text: string; files?: any[] },
    opts?: SendOpts | { thinking?: boolean },
  ): Promise<void> {
    if (!currentChat.value) return

    // 归一化：支持两种调用形态
    const text = typeof textOrInput === 'string' ? textOrInput : textOrInput.text
    const files = typeof textOrInput === 'string'
      ? (opts as SendOpts | undefined)?.files
      : textOrInput.files
    const thinking = opts?.thinking

    lastLocalSendSeq.value++

    let content = (text ?? '').trim()
    const additional_kwargs: Record<string, any> = {}
    if (files && files.length > 0) {
      const payload = files.map((f: any) => ({
        id: f.id,
        fileName: f.fileName,
        fileType: f.fileType,
        fileSize: f.fileSize,
        encrypted: f.encrypted,
      }))
      additional_kwargs.attachments = payload
      const sentinel = `__ATTACHMENTS__\n${JSON.stringify(payload)}`
      content = content ? `${sentinel}\n\n${content}` : sentinel
    }

    if (!content) return

    // 走 wrappedChat 唯一入口（与 dispatcher 同路径）
    await currentChat.value.sendMessage(content, {
      thinking,
      additional_kwargs: Object.keys(additional_kwargs).length > 0 ? additional_kwargs : undefined,
    })
  }

  // ── 队列操作 API ──

  function enqueueMessage(text: string, files?: any[], thinking = false): boolean {
    const sid = currentSessionId.value
    if (!sid) return false
    const item: QueueItem = {
      id: nanoid(),
      text,
      files,
      thinking,
      enqueuedAt: Date.now(),
    }
    const snapshot = new Map(queuesBySession) as Map<string, QueueItem[]>
    const { next, ok } = enqueueAction(snapshot, sid, item)
    if (ok) {
      queuesBySession.set(sid, next.get(sid)!)
      dispatcher.broadcastState(sid)
      nextTick(() => dispatcher.maybeDispatch())
    }
    return ok
  }

  function removeQueueItem(itemId: string) {
    const sid = currentSessionId.value
    if (!sid) return
    const current = queuesBySession.get(sid) ?? []
    const nextList = current.filter(i => i.id !== itemId)
    queuesBySession.set(sid, nextList)
    if (nextList.length === 0) queuePausedBy.delete(sid)
    dispatcher.broadcastState(sid)
  }

  function clearQueue() {
    const sid = currentSessionId.value
    if (!sid) return
    queuesBySession.set(sid, [])
    queuePausedBy.delete(sid)
    dispatcher.broadcastState(sid)
  }

  function resumeQueue() {
    const sid = currentSessionId.value
    if (!sid) return
    queuePausedBy.delete(sid)
    dispatcher.broadcastState(sid)
    dispatcher.maybeDispatch()
  }

  function resumeInterrupt(data: any) {
    currentChat.value?.resumeInterrupt(data)
  }

  async function stopGeneration() {
    currentChat.value?.stopGeneration()
    const sid = currentSessionId.value
    if (sid) await stopActiveRun(sid)
  }

  // ── 初始化（幂等）──

  async function init() {
    if (initialized.value) return
    isSessionLoading.value = true

    try {
      if (isSingleSessionMode) {
        // 单 session 模式：直接 switchSession 到固定 id，不 fetch / 不 create
        // sessions list 保持空（UI 隐藏 sessions 列表）
        const sid = fixedSessionIdRef?.value
        if (sid) {
          await switchSession(sid)
        }
      } else {
        // 多 session 模式：fetchSessions 后选首个，空则 createSession
        await fetchSessions()
        if (sessions.value.length === 0) {
          await createSession()
        } else {
          await switchSession(sessions.value[0]!.sessionId)
        }
      }
      initialized.value = true
    } finally {
      isSessionLoading.value = false
    }
  }

  // ── 派发器实例化 ──
  const dispatcher = useQueueDispatcher({
    currentSessionId,
    currentChat,
    runStatus,
    isLoading,
    interruptData,
    queuesBySession: queuesBySession as unknown as Map<string, QueueItem[]>,
    queuePausedBy: queuePausedBy as unknown as Map<string, Exclude<QueuePauseReason, null>>,
    get tabId() { return tabId },
    lastLocalSendSeq,
  })

  // ── 跨标签 listener ──
  useCrossTabListener('chat-queue:sync', (payload) => {
    if (payload.tabId === tabId) return
    const sid = payload.sessionId
    const lastV = lastAppliedVersion.get(sid) ?? 0
    if (payload.version <= lastV) return
    lastAppliedVersion.set(sid, payload.version)

    queuesBySession.set(sid, payload.queue)
    if (payload.pauseReason === null) queuePausedBy.delete(sid)
    else queuePausedBy.set(sid, payload.pauseReason)
  })

  useCrossTabListener('chat-queue:hello', (payload) => {
    if (payload.tabId === tabId) return
    const sid = payload.sessionId
    if (queuesBySession.has(sid) || queuePausedBy.has(sid)) {
      postCrossTabEvent('chat-queue:sync', {
        sessionId: sid,
        tabId,
        queue: queuesBySession.get(sid) ?? [],
        pauseReason: queuePausedBy.get(sid) ?? null,
        version: performance.now() + Math.random(),
      })
    }
  })

  const helloSent = new Set<string>()
  watch(
    currentSessionId,
    (sid) => {
      if (!sid || !tabId) return
      if (helloSent.has(sid)) return
      helloSent.add(sid)
      postCrossTabEvent('chat-queue:hello', { sessionId: sid, tabId })
    },
    { immediate: false },
  )

  // ── 流末回拉钩子 ──
  // runStatus 进入 completed/failed 时调用业务方注入的 onStreamSettled。
  // watch 在 setup 顶层注册（不在 switchSession 的 inner scope），自动跟随调用方
  // scope 清理；switchSession 切换时 currentChat 内部的流状态变化会重新触发 runStatus
  // computed → 此 watch 自然继续生效。
  if (config.onStreamSettled) {
    watch(runStatus, (next) => {
      if (next === 'completed' || next === 'failed') {
        try {
          const ret = config.onStreamSettled?.(next)
          if (ret && typeof (ret as Promise<void>).catch === 'function') {
            (ret as Promise<void>).catch((err) => {
              console.error('[useDomainAgentSession] onStreamSettled rejected', err)
            })
          }
        } catch (err) {
          console.error('[useDomainAgentSession] onStreamSettled threw', err)
        }
      }
    })
  }

  onScopeDispose(() => disposeCurrentChat())

  return {
    // 状态
    messages,
    isLoading,
    interruptData,
    runStatus,
    runError,
    sessions,
    currentSessionId,

    // 核心操作
    sendMessage,
    resumeInterrupt,
    init,
    switchSession,
    createSession,
    deleteSession,
    renameSession,
    stopGeneration,

    // 队列相关 API
    currentQueue,
    currentQueueLen,
    isQueuePaused,
    queuePauseReason,
    enqueueMessage,
    removeQueueItem,
    resumeQueue,
    clearQueue,
  }
}

// ── 多 key 池化（用于模块对话等场景，每个 key 一个独立 session 实例）──

/**
 * SessionFactory：池化时每个 key 对应的工厂实例
 * 类型 = useDomainAgentSession 的返回值
 */
export type SessionFactory = ReturnType<typeof useDomainAgentSession>

interface PoolEntry {
  scope: EffectScope
  factory: SessionFactory
}

/**
 * useDomainAgentSessionPool —— 多 key 池化
 *
 * 用于 case 模块对话（每模块一个独立的 useDomainAgentSession）：
 * - 每个 key 独立 effectScope + 独立 useDomainAgentSession 实例
 * - getOrCreate(key) 幂等返回该 key 的 factory，第二次调用直接复用已有实例
 * - remove(key) dispose 该 key 的 scope + 清理 entry
 * - 父 scope dispose 时（onScopeDispose）自动 dispose 所有 entries
 *
 * baseConfig：所有 key 共享的配置（scope/userId/caseId/apiEndpoints/钩子等）
 * extraConfig：每 key 调用时叠加的差异（典型：moduleName / sessionId）
 *
 * 参考实现：useModuleChatManager.ts:52-96 的 getOrCreateModuleManager
 */
export interface DomainAgentSessionPoolApi {
  getOrCreate: (key: string, extraConfig?: Partial<DomainAgentSessionConfig>) => SessionFactory
  remove: (key: string) => void
  keys: () => string[]
  /** 池中所有 factory 的快照（只读，按 key 顺序）*/
  list: () => Array<{ key: string; factory: SessionFactory }>
}

export function useDomainAgentSessionPool(
  baseConfig: Omit<DomainAgentSessionConfig, 'sessionId'> & { sessionId?: SessionIdConfig },
): DomainAgentSessionPoolApi {
  const entries = new Map<string, PoolEntry>()

  function getOrCreate(
    key: string,
    extraConfig?: Partial<DomainAgentSessionConfig>,
  ): SessionFactory {
    const existing = entries.get(key)
    if (existing) return existing.factory

    // 每个 key 独立 effectScope，确保 useDomainAgentSession 内的 ref/computed/watch
    // 在调用 remove(key) 时被一并清理（异步事件回调中无 component context）
    const scope = effectScope(true)
    const factory = scope.run(() =>
      useDomainAgentSession({ ...baseConfig, ...extraConfig } as DomainAgentSessionConfig),
    )
    if (!factory) {
      scope.stop()
      throw new Error(`[useDomainAgentSessionPool] factory 创建失败 key=${key}`)
    }

    entries.set(key, { scope, factory })
    return factory
  }

  function remove(key: string) {
    const entry = entries.get(key)
    if (!entry) return
    entry.scope.stop()
    entries.delete(key)
  }

  function keys(): string[] {
    return Array.from(entries.keys())
  }

  function list(): Array<{ key: string; factory: SessionFactory }> {
    return Array.from(entries.entries()).map(([key, entry]) => ({ key, factory: entry.factory }))
  }

  // 父 scope dispose 时一次性清理所有 entries
  onScopeDispose(() => {
    for (const entry of entries.values()) {
      entry.scope.stop()
    }
    entries.clear()
  })

  return { getOrCreate, remove, keys, list }
}
