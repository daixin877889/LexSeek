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

export interface DomainAgentSessionConfig {
  scope: DomainScope
  sessionId: string
  userId: string
  caseId?: number  // scope='case' 时必填
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

// ── 事件分发器 ──

function createEventDispatcher(scope: DomainScope) {
  return (data: unknown) => {
    if (!data || typeof data !== 'object') return

    const evt = data as Record<string, unknown>
    const eventName = evt.name as string | undefined

    // 根据 scope 路由自定义事件
    switch (scope) {
      case 'document':
        if (eventName === 'draft_saved' || eventName === 'draft_ready' || eventName === 'draft_update') {
          // 文书相关事件可在此处理
        }
        break
      case 'contract':
        if (eventName === 'contract_review_saved') {
          // 合同审查相关事件可在此处理
        }
        break
      case 'case':
      case 'legal_assistant':
      case 'case_analysis_init':
        if (eventName === 'analysis_result_saved') {
          // 案件分析相关事件可在此处理
        }
        break
    }
  }
}

// ── 主工厂函数 ──

export function useDomainAgentSession(config: DomainAgentSessionConfig) {
  const { scope, sessionId: initialSessionId, userId, caseId } = config
  const apiConfig = getApiConfig(scope, initialSessionId, caseId)

  // ── 会话状态（来自 useChatSessionManager 模式） ──
  const sessions = ref<SessionItem[]>([])
  const currentSessionId = ref<string>(initialSessionId)
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

  async function fetchSessions() {
    const result = await useApiFetch<SessionItem[]>(apiConfig.listUrl)
    if (result) {
      sessions.value = result
    }
  }

  async function createSession(title?: string): Promise<string> {
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
        onCustomEvent: createEventDispatcher(scope),
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
    await useApiFetch(
      apiConfig.renameUrl(sessionId),
      { method: 'PATCH', body: { title: newTitle } },
    )
    sessions.value = sessions.value.map(s =>
      s.sessionId === sessionId ? { ...s, title: newTitle } : s,
    )
  }

  // ── 消息操作 ──

  async function sendMessage(text: string, opts?: SendOpts): Promise<void> {
    if (!currentChat.value) return

    lastLocalSendSeq.value++

    // 重置 runStatus 到 idle：避免上一轮的 cancelled/failed/completed 粘滞
    currentChat.value.runStatus.value = 'idle'

    let content = text.trim()
    const additional_kwargs: Record<string, any> = {}
    if (opts?.files && opts.files.length > 0) {
      const payload = opts.files.map((f: any) => ({
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

    const msgPayload: Record<string, any> = { type: 'human', content }
    if (Object.keys(additional_kwargs).length > 0) {
      msgPayload.additional_kwargs = additional_kwargs
    }

    // 使用 submit 提交消息，保留现有消息避免闪烁
    await (currentChat.value as any).submit({
      messages: [msgPayload],
      thinking: opts?.thinking,
    }, {
      optimisticValues: (currentChat.value as any).values.value,
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
      await fetchSessions()
      if (sessions.value.length === 0) {
        await createSession()
      } else {
        await switchSession(sessions.value[0]!.sessionId)
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
