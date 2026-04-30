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
import type { WrappedChat } from './types'
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
  /**
   * thread state 接口：从后端拉主流 messages + 子代理 thread 历史，
   * 用于 useStreamChat 的 initialSubThreads（子流 CoT 历史恢复）。
   *
   * 不传或为 null → 不拉子流历史（首次跑可见、刷新页面后子流消失，老 bug 行为）。
   *
   * 后端契约：返回 `{ subAgentThreads: Array<{toolCallId, agentName, threadId, messages}> }`
   * （`useApiFetch` 已自动 unwrap data 字段；具体 schema 详见
   * `server/api/v1/case/analysis/thread/[sessionId].get.ts`）。
   */
  threadStateUrl?: ((sessionId: string) => string) | null
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

/**
 * 解析后的 API 端点（内部使用）
 *
 * 单 session scope（document / contract）默认 list/create/delete/rename 都是 null：
 *   - 调用 fetchSessions / createSession / deleteSession / renameSession 由 isSingleSessionMode 守卫拦截
 *   - apiEndpoints 覆盖时业务方传 null 表示禁用，传函数表示自定义
 *
 * case scope listUrl 是函数：模块对话需要 moduleName 拼参数；小索（无 moduleName）走 xiaosuo-sessions。
 */
interface ResolvedApiConfig {
  listUrl: ((caseId?: number, moduleName?: string) => string) | null
  chatUrl: string
  createUrl: string | null
  deleteUrl: ((sessionId: string) => string) | null
  renameUrl: ((sessionId: string) => string) | null
  threadStateUrl: ((sessionId: string) => string) | null
}

/**
 * 默认 API 端点（按 scope 推断）
 *
 * apiEndpoints 覆盖逻辑：业务方传入的字段 > scope 默认值。
 * 字段值为 undefined 时取默认；为 null 时显式禁用；为函数/字符串时按值使用。
 */
function defaultApiEndpoints(scope: DomainScope): ResolvedApiConfig {
  switch (scope) {
    case 'case':
      // listUrl 是函数：根据 moduleName 区分小索（xiaosuo-sessions）vs 模块对话（module-sessions）
      return {
        listUrl: (caseId, moduleName) => {
          if (!caseId) throw new Error('scope=case 时 caseId 必填')
          return moduleName
            ? `/api/v1/case/analysis/module-sessions?caseId=${caseId}&moduleName=${moduleName}`
            : `/api/v1/case/analysis/xiaosuo-sessions?caseId=${caseId}`
        },
        createUrl: '/api/v1/case/analysis/xiaosuo-session',
        deleteUrl: (sid) => `/api/v1/case/analysis/xiaosuo-session/${sid}`,
        renameUrl: (sid) => `/api/v1/case/analysis/session/rename/${sid}`,
        chatUrl: '/api/v1/case/analysis/chat',
        // 已存在的接口；见 server/api/v1/case/analysis/thread/[sessionId].get.ts
        threadStateUrl: (sid) => `/api/v1/case/analysis/thread/${sid}`,
      }
    case 'legal_assistant':
      return {
        listUrl: () => '/api/v1/assistant/sessions',
        createUrl: '/api/v1/assistant/sessions',
        deleteUrl: (sid) => `/api/v1/assistant/sessions/${sid}`,
        renameUrl: (sid) => `/api/v1/assistant/sessions/${sid}/rename`,
        chatUrl: '/api/v1/assistant/chat',
        threadStateUrl: null,
      }
    case 'document':
      // 单 session 默认：list/create/delete/rename 都 null（业务方按 draftId 单 session 驱动）
      return {
        listUrl: null,
        createUrl: null,
        deleteUrl: null,
        renameUrl: null,
        chatUrl: '/api/v1/assistant/document/chat',
        threadStateUrl: null,
      }
    case 'contract':
      // 单 session 默认：list/create/delete/rename 都 null
      return {
        listUrl: null,
        createUrl: null,
        deleteUrl: null,
        renameUrl: null,
        chatUrl: '/api/v1/assistant/contract/chat',
        threadStateUrl: null,
      }
    case 'case_analysis_init':
      // 单 session 默认：list/create/delete/rename 都 null（路由 sessionId 驱动）
      return {
        listUrl: null,
        createUrl: null,
        deleteUrl: null,
        renameUrl: null,
        chatUrl: '/api/v1/case/init-analysis',
        threadStateUrl: null,
      }
    default: {
      const exhaustive: never = scope
      throw new Error(`未知 scope: ${exhaustive}`)
    }
  }
}

/**
 * 解析最终 API 端点：scope 默认 + 业务方覆盖（apiEndpoints）
 *
 * 覆盖语义：apiEndpoints 字段值
 *   - undefined：取默认
 *   - null：显式禁用
 *   - 字符串/函数：按业务方提供的值
 */
function resolveApiEndpoints(
  scope: DomainScope,
  override?: DomainAgentApiEndpoints,
): ResolvedApiConfig {
  const defaults = defaultApiEndpoints(scope)
  if (!override) return defaults
  return {
    listUrl: 'listUrl' in override ? (override.listUrl ?? null) : defaults.listUrl,
    chatUrl: override.chatUrl ?? defaults.chatUrl,
    createUrl: 'createUrl' in override ? (override.createUrl ?? null) : defaults.createUrl,
    deleteUrl: 'deleteUrl' in override ? (override.deleteUrl ?? null) : defaults.deleteUrl,
    renameUrl: 'renameUrl' in override ? (override.renameUrl ?? null) : defaults.renameUrl,
    threadStateUrl: 'threadStateUrl' in override ? (override.threadStateUrl ?? null) : defaults.threadStateUrl,
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

  // 解析最终 API 端点：scope 默认 + 业务方 apiEndpoints 覆盖
  const apiConfig = resolveApiEndpoints(scope, config.apiEndpoints)

  // ── 会话状态（来自 useChatSessionManager 模式） ──
  const sessions = ref<SessionItem[]>([])
  const currentSessionId = ref<string>(fixedSessionIdRef?.value ?? '')
  const isSessionLoading = ref(false)
  const initialized = ref(false)

  // effectScope 管理（每 session 独立 scope）
  // currentChat 是 WrappedChat（useStreamChat 实例 + sendMessage/resumeInterrupt/stopGeneration），
  // 与 useQueueDispatcher.deps.currentChat 类型对齐（共用 ./types.ts）
  let currentScope: EffectScope | null = null
  const currentChat = shallowRef<WrappedChat | null>(null)
  let switchCounter = 0

  function disposeCurrentChat() {
    if (currentScope) {
      // 先 abort SSE 连接防止 scope 停止后还有旧 callback 写入已分离的 reactive map，
      // 导致新 switchSession 创建的子 Agent 分桶收不到实时事件（CoT 不显示的根因之一）。
      currentChat.value?.stop()
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
    if (!apiConfig.listUrl) {
      console.warn('[useDomainAgentSession] fetchSessions 调用但 listUrl=null，已忽略')
      return
    }
    const url = apiConfig.listUrl(caseId, moduleName)
    const result = await useApiFetch<SessionItem[]>(url)
    if (result) {
      sessions.value = result
    }
  }

  async function createSession(title?: string): Promise<string> {
    if (isSingleSessionMode) {
      throw new Error('[useDomainAgentSession] 单 session 模式不支持 createSession，sessionId 由业务方提供')
    }
    if (!apiConfig.createUrl) {
      throw new Error('[useDomainAgentSession] createSession 调用但 createUrl=null')
    }

    const body: Record<string, any> = {}
    if (scope === 'case') {
      body.caseId = caseId
      body.title = title
      // case 模块对话需要传 moduleName 给后端
      if (moduleName) body.moduleName = moduleName
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

    // case scope 端点按 moduleName 分流：模块对话走 module-session（type=3），
    // 小索走 xiaosuo-session（type=1）。defaultApiEndpoints 的 createUrl 默认是
    // 后者，moduleName 非空时改路由到前者。
    const createUrl = (scope === 'case' && moduleName
        && apiConfig.createUrl === '/api/v1/case/analysis/xiaosuo-session')
        ? '/api/v1/case/analysis/module-session'
        : apiConfig.createUrl

    const result = await useApiFetch<{ sessionId: string; title: string }>(
      createUrl,
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

    // 子流 CoT 历史恢复：在创建 useStreamChat 之前先拉 thread state，
    // 把 subAgentThreads 通过 initialSubThreads 选项灌入，让 SubAgentChainOfThought
    // 卡片在页面刷新后能从历史消息复原（之前因为这里没拉 thread API，
    // 子流 subThreadsMap 永远是空，CoT 卡完全不渲染）。
    //
    // 仅 case scope 默认有 thread state API；其他 scope 通过
    // `apiEndpoints.threadStateUrl` 显式注入；为 null 时跳过、保持原行为。
    let initialSubThreads: Array<{
      toolCallId: string
      agentName: string
      threadId: string
      messages: Record<string, unknown>[]
    }> | undefined
    if (apiConfig.threadStateUrl) {
      try {
        const data = await useApiFetch<{
          subAgentThreads?: Array<{
            toolCallId: string
            agentName: string
            threadId: string
            messages: Record<string, unknown>[]
          }>
        }>(apiConfig.threadStateUrl(sessionId))
        if (data?.subAgentThreads?.length) {
          initialSubThreads = data.subAgentThreads
        }
      } catch (err) {
        // 历史恢复属于增强体验，失败不阻断对话；让 useStreamChat 仍然按
        // 主流 LangGraph SDK 路径继续工作。
        console.warn('[useDomainAgentSession] fetch thread state failed', err)
      }

      // 切换在拉历史期间被新一轮 switchSession 抢占 → 直接放弃此次结果
      if (currentSwitch !== switchCounter) return
    }

    const newScope = effectScope()
    const streamChat = newScope.run(() =>
      useStreamChat({
        apiUrl: apiConfig.chatUrl,
        threadId: sessionId,
        messagesKey: 'messages',
        // 业务自定义事件钩子直接注入：useStreamChat 已先消费 status_change，
        // 剩余 custom_event 透传给业务方按 name 分发
        onCustomEvent: config.onCustomEvent,
        initialSubThreads,
      }),
    )!

    if (currentSwitch !== switchCounter) {
      newScope.stop()
      return
    }

    currentScope = newScope
    // 在 streamChat 上叠加 sendMessage / resumeInterrupt / stopGeneration，
    // 类型 WrappedChat（dispatcher 共用同一类型，定义在 ./types.ts）
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
    if (!apiConfig.deleteUrl) {
      console.warn('[useDomainAgentSession] deleteSession 调用但 deleteUrl=null，已忽略')
      return
    }

    await stopActiveRun(sessionId).catch(() => {})

    // case scope 端点按 moduleName 分流：模块对话（type=3）走 module-session
    // 端点；小索（type=1）走 xiaosuo-session 端点。defaultApiEndpoints 默认是
    // 后者，moduleName 非空时改路由到前者（与 createSession 同步）。
    const baseUrl = apiConfig.deleteUrl(sessionId)
    const deleteUrl = (scope === 'case' && moduleName
        && baseUrl === `/api/v1/case/analysis/xiaosuo-session/${sessionId}`)
        ? `/api/v1/case/analysis/module-session/${sessionId}`
        : baseUrl

    await useApiFetch(deleteUrl, { method: 'DELETE' })

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
    if (!apiConfig.renameUrl) {
      console.warn('[useDomainAgentSession] renameSession 调用但 renameUrl=null，已忽略')
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
    // 子 Agent 分桶 map（getter：每次访问拿当前 chat 实例的 reactive map，
    // 跟随 currentChat 切换；调用方应再用 getter 包一层 provide 才能响应式贯穿）
    get subThreadsMap() { return (currentChat.value as any)?.subThreadsMap ?? {} },
    /**
     * 合成工具卡片（按 parentMessageId 索引）。
     * 业务组件传给 AiChat 的 :extra-tool-calls。当前来源：
     *   - 模块对话摘要进度事件（saveAnalysisResult 工具）
     *   - 文书模板选择 interrupt（draftDocument 工具触发，前端内嵌渲染）
     *
     * 用 computed 而非 getter：getter 调用结果在 vue 模板的 prop 绑定中不带响应依赖，
     * map 内部 mutation 不会触发父→子 prop 更新；必须 computed 让模板能追踪到 currentChat
     * 与底层 reactive map 的依赖链，mutation 才能正确驱动子组件重渲染。
     */
    syntheticToolCalls: computed(() => (currentChat.value as any)?.syntheticToolCalls ?? {}),

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
