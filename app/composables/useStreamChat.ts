/**
 * 泛型流管理底层 composable
 *
 * 将 useCaseChat 和 useInitAnalysis 共同的
 * FetchStreamTransport + useStream + computed 包装 + interrupt 解包
 * 抽取为可复用的泛型 composable。
 *
 * @langchain/vue 技术细节：
 * - FetchStreamTransport 路径走 useStreamCustom（非 useStreamLGP）
 * - useStreamCustom 返回的 values/interrupt/messages 是 ES6 getter（非 Ref）
 * - getter 内部读取 shallowRef.value，外层 computed 通过 Vue activeEffect 追踪
 * - interruptComputed 只依赖 isLoading（已知 bug：stream.custom.js:49-52）
 *   → 必须从 values.__interrupt__ 读取 interrupt 数据
 */

import { useStream, FetchStreamTransport } from '@langchain/vue'
import type { UseStreamCustomOptions } from '@langchain/vue'
import { AIMessage, ToolMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import type { AgentRunStatus, AgentEvent, AgentCustomEvent, AgentStatusEvent } from '#shared/types/agentRun'
import type { AnalysisSummaryPayload } from '#shared/types/agentEvent'
import { SYNTHETIC_TOOL_GENERATE_SUMMARY } from '#shared/types/agentEvent'
import type { ToolCallWithResult } from '~/components/ai/composables/useMessageParser'

export interface SubThreadState {
  agentName: string
  threadId: string
  messages: any[]          // 子 thread 消息（AIMessage / ToolMessage 等）
  status: 'running' | 'completed' | 'failed'
  error?: string
  runIdToInnerToolCallId: Map<string, string>
}

export function createEmptyBucket(agentName: string, threadId: string): SubThreadState {
  return {
    agentName,
    threadId,
    messages: [],
    status: 'running',
    runIdToInnerToolCallId: new Map(),
  }
}

export function mergeEventIntoBucket(bucket: SubThreadState, ev: AgentEvent) {
  if (ev.type === 'custom_event') {
    const cev = ev as AgentCustomEvent
    switch (cev.name) {
      case 'sub_agent_token': {
        const md = cev.metadata
        if (!md?.messageId) return
        // ⚠️ Vue 3 reactive 不代理 LangChain BaseMessage 实例（targetTypeMap INVALID），
        // 直接 `instance.content = ...` 不触发响应 → 流式累积不渲染，下一次 push
        // 触发数组 set 时才一次性显示之前累积的所有 token。
        // 用 plain object 让 reactive 代理生效，extractThinking / mapMessagesToSteps
        // 都用 `_getType?.() ?? type` 兜底兼容。
        const idx = bucket.messages.findIndex((m: any) => m.id === md.messageId && (m.type === 'ai' || m._getType?.() === 'ai'))
        if (idx >= 0) {
          const m = bucket.messages[idx] as any
          m.content = (typeof m.content === 'string' ? m.content : '') + (md.delta ?? '')
        } else {
          bucket.messages.push({ type: 'ai', id: md.messageId, content: md.delta ?? '' } as any)
        }
        return
      }
      case 'sub_agent_thinking_token': {
        // thinking/reasoning 增量累到 additional_kwargs.reasoning_content 字段，
        // mapMessagesToSteps 内的 extractThinking 走格式 3 直接渲染"思考"step
        const md = cev.metadata
        if (!md?.messageId) return
        const delta = md.delta ?? ''
        if (!delta) return
        const idx = bucket.messages.findIndex((m: any) => m.id === md.messageId && (m.type === 'ai' || m._getType?.() === 'ai'))
        if (idx >= 0) {
          const m = bucket.messages[idx] as any
          m.additional_kwargs = m.additional_kwargs ?? {}
          const prev = typeof m.additional_kwargs.reasoning_content === 'string'
            ? m.additional_kwargs.reasoning_content
            : ''
          m.additional_kwargs.reasoning_content = prev + delta
        } else {
          bucket.messages.push({
            type: 'ai',
            id: md.messageId,
            content: '',
            additional_kwargs: { reasoning_content: delta },
          } as any)
        }
        return
      }
      case 'sub_agent_tool_start': {
        const d = cev.data as { innerToolCallId?: string; input?: unknown; cbRunId?: string; toolName?: string }
        if (d?.cbRunId && d?.innerToolCallId) {
          bucket.runIdToInnerToolCallId.set(d.cbRunId, d.innerToolCallId)
        }
        // 新逻辑：为每个 tool_call 创建独立 AIMessage，
        // 让 mapMessagesToSteps 跑中也能渲染 tool_call step。
        //
        // 关键 bug 修复（5check v5）：stage 适配器场景下，stage:running 直接发
        // SUB_AGENT_TOOL_START，没有 token 在先。旧逻辑"找不到 AI 跳过"
        // 会让 tool_call 全部丢失，CoT 卡空白。
        //
        // 注意：缺 toolName 时（旧版后端 / 兼容路径）不注入，避免污染
        if (d?.innerToolCallId && d?.toolName) {
          // input 是 string 时尝试 JSON.parse；不合法保留原 string
          let parsedArgs: unknown = d.input
          if (typeof d.input === 'string') {
            try { parsedArgs = JSON.parse(d.input) } catch { /* 保留原 string */ }
          }
          // 幂等：扫整个 messages 看有没有同 innerToolCallId 的 tool_call
          const exists = bucket.messages.some((m: any) =>
            (m._getType?.() === 'ai' || m.type === 'ai')
              && Array.isArray(m.tool_calls)
              && m.tool_calls.some((c: any) => c?.id === d.innerToolCallId),
          )
          if (!exists) {
            // 始终为每个 tool_call 创建独立的空 AIMessage（plain object 让 reactive 生效）
            bucket.messages.push({
              type: 'ai',
              id: d.cbRunId ?? d.innerToolCallId,
              content: '',
              tool_calls: [{ id: d.innerToolCallId, name: d.toolName, args: parsedArgs }],
            } as any)
          }
        }
        return
      }
      case 'sub_agent_tool_end': {
        const d = cev.data as { cbRunId?: string; output?: any }
        if (!d?.cbRunId) return
        const innerToolCallId = bucket.runIdToInnerToolCallId.get(d.cbRunId)
        if (!innerToolCallId) return
        // plain object（同 sub_agent_token 修复）
        bucket.messages.push({
          type: 'tool',
          tool_call_id: innerToolCallId,
          content: typeof d.output === 'string' ? d.output : JSON.stringify(d.output ?? null),
        } as any)
        return
      }
      default: return
    }
  }
  if (ev.type === 'status_change') {
    const sev = ev as AgentStatusEvent
    if (sev.status === 'completed') { bucket.status = 'completed'; return }
    if (sev.status === 'failed')    { bucket.status = 'failed'; bucket.error = sev.error; return }
  }
}

export interface StreamChatOptions {
    /** SSE API 端点 */
    apiUrl: string
    /** LangGraph thread ID */
    threadId?: string
    /** 状态对象中的消息字段名（默认 'messages'） */
    messagesKey?: string
    /** 自定义事件回调 */
    onCustomEvent?: (data: unknown) => void
    /** 初始状态值（用于从 checkpoint 恢复） */
    initialValues?: Record<string, unknown>
    /** 历史子代理 thread 列表（用于页面刷新后恢复子代理思考链） */
    initialSubThreads?: Array<{
        toolCallId: string
        agentName: string
        threadId: string
        messages: Record<string, unknown>[]
    }>
    /**
     * 子流跑完时（status_change=completed）用 checkpoint 替换实时累积的 bucket.messages。
     *
     * 实时累积来源是 LLM token 流（含 tool_use input_json delta），跑完后展示的"得出结论"
     * 等 step 内容会跟刷新后的 checkpoint 不一致。hydrate 一次让两种场景视觉对齐。
     * 返回 null 时跳过替换（保留实时数据）。
     */
    hydrateSubBucket?: (toolCallId: string) => Promise<{ messages: Record<string, unknown>[] } | null>
}

export function useStreamChat<T extends Record<string, unknown> = Record<string, unknown>>(options: StreamChatOptions) {
    const transport = new FetchStreamTransport({
        apiUrl: options.apiUrl,
    })

    // 代理 agent run 状态，用于 UI 失败反馈
    const runStatus = ref<AgentRunStatus | 'idle'>('idle')
    const runError = ref<string>('')

    // 子 Agent 分桶：按 parentToolCallId 归集子 Agent 事件
    const subThreadsMap = reactive<Record<string, SubThreadState>>({})
    // 同一 toolCallId 只 hydrate 一次：兜底 publishStatusChange 与 callback handleChainEnd
    // 都触发 completed 时避免重复拉完整 history + 全量替换 messages 引发 CoT 重渲染
    const hydratedSubBuckets = new Set<string>()

    /**
     * 合成工具卡片：按 parentMessageId（触发该卡片的 AIMessage.id）分组。
     *
     * 当前唯一来源：模块对话 saveAnalysisResult 工具发出的 ANALYSIS_SUMMARY 事件，
     * 用于让 useMessageParser 把"生成结果摘要"卡片合成到 save_analysis_result 同一条 AIMessage 的 toolCalls 末尾。
     *
     * - phase='start'：push 一条 input-available 状态的 ToolCallWithResult
     * - phase='end' (success=true)：原条切到 output-available，result 携带 summary 文本
     * - phase='end' (success=false)：原条切到 output-error，result 携带 error 描述
     */
    const syntheticToolCalls = reactive<Record<string, ToolCallWithResult[]>>({})

    // 历史恢复：将 loadHistory 返回的 subAgentThreads 灌入 subThreadsMap
    if (options.initialSubThreads?.length) {
        for (const sub of options.initialSubThreads) {
            subThreadsMap[sub.toolCallId] = {
                agentName: sub.agentName,
                threadId: sub.threadId,
                messages: sub.messages,
                status: 'completed',
                runIdToInnerToolCallId: new Map(),
            }
        }
    }

    function handleAgentEvent(ev: AgentEvent) {
        if (!ev.metadata?.parentToolCallId) return
        const md = ev.metadata
        const b = subThreadsMap[md.parentToolCallId]
            ?? (subThreadsMap[md.parentToolCallId] = createEmptyBucket(md.agentName, md.threadId))
        mergeEventIntoBucket(b, ev)
        // 子流跑完瞬间用 checkpoint 替换实时累积的 messages（实时累 token 流含 tool_use
        // input_json，跟刷新后从 LangGraph checkpoint 读的 content array 形态不一致；
        // 替换后两种场景视觉对齐）。hydrate 是 best-effort，失败保留实时数据并允许重试。
        if (
            ev.type === 'status_change'
            && (ev as AgentStatusEvent).status === 'completed'
            && options.hydrateSubBucket
        ) {
            const toolCallId = md.parentToolCallId
            if (!hydratedSubBuckets.has(toolCallId)) {
                hydratedSubBuckets.add(toolCallId)
                options.hydrateSubBucket(toolCallId)
                    .then((result) => {
                        if (result?.messages?.length && subThreadsMap[toolCallId]) {
                            subThreadsMap[toolCallId]!.messages = result.messages
                        }
                    })
                    .catch((err: unknown) => {
                        hydratedSubBuckets.delete(toolCallId)
                        console.warn('[useStreamChat] hydrateSubBucket 失败', err)
                    })
            }
        }
    }

    const streamOptions: UseStreamCustomOptions<T> = {
        transport: transport as any,
        threadId: options.threadId,
        messagesKey: options.messagesKey ?? 'messages',
        onCustomEvent: (data: unknown) => {
            // 子 Agent 事件拦截：有 parentToolCallId 则分桶，不落主 thread
            if (data && typeof data === 'object' && 'metadata' in data) {
                const ev = data as AgentEvent
                if (ev.metadata?.parentToolCallId) {
                    handleAgentEvent(ev)
                    return
                }
            }
            if (
                data
                && typeof data === 'object'
                && 'type' in data
                && (data as { type: unknown }).type === 'status_change'
            ) {
                const evt = data as { type: 'status_change'; status: AgentRunStatus; error?: string }
                runStatus.value = evt.status
                if (evt.status === 'failed') {
                    runError.value = evt.error || '执行失败'
                } else if (evt.status === 'cancelled') {
                    runError.value = ''  // 用户主动取消不弹 toast
                }
                return  // status_change 不透传给外部 onCustomEvent
            }

            // 摘要进度事件拦截：合成工具卡片，挂到 parentMessageId 对应的 AIMessage
            if (
                data
                && typeof data === 'object'
                && 'name' in data
                && (data as { name: unknown }).name === 'analysis_summary'
            ) {
                const payload = (data as unknown as { data: AnalysisSummaryPayload }).data
                const list = syntheticToolCalls[payload.parentMessageId] ?? []
                let mutated = false
                if (payload.phase === 'start') {
                    if (!list.some(t => t.id === payload.toolCallId)) {
                        list.push({
                            id: payload.toolCallId,
                            name: SYNTHETIC_TOOL_GENERATE_SUMMARY,
                            args: { analysisId: payload.analysisId },
                            state: 'input-available',
                        })
                        mutated = true
                    }
                } else {
                    const idx = list.findIndex(t => t.id === payload.toolCallId)
                    if (idx >= 0) {
                        const result = payload.success
                            ? { success: true, summary: payload.summary }
                            : { success: false, error: payload.error }
                        list[idx] = {
                            ...list[idx]!,
                            result,
                            state: payload.success ? 'output-available' : 'output-error',
                        }
                        mutated = true
                    }
                }
                // reactive 数组的内部 mutation 不触发依赖重算，需重新赋一个新引用；
                // 但仅在确实变更时赋值，避免重复 phase=start 触发空 reactive 抖动
                if (mutated) {
                    syntheticToolCalls[payload.parentMessageId] = [...list]
                }
                return  // 不透传给外部 onCustomEvent
            }

            options.onCustomEvent?.(data)
        },
        initialValues: options.initialValues as T | undefined,
        onError: (error: any) => {
            console.error('[useStreamChat] 流错误:', error)
            // spec §8.1 #1 P0 follow-up：前端 fetch 错误（网络/4xx/5xx）
            // 应本地将 runStatus 置为 'failed'，让 dispatcher 的 watch 触发暂停分支、
            // UI 层展示失败状态，避免队列卡死 + 用户无感知。
            runStatus.value = 'failed'
            runError.value = typeof error === 'string'
                ? error
                : (error?.message || '流错误')
        },
    }

    // 使用 any 断言访问底层 stream，避免泛型推断导致的类型错误
    // （WithClassMessages 将部分方法包装为 Ref，泛型上下文下 TS 无法准确区分）
    const s = useStream<T>(streamOptions as any) as any

    // 标记历史消息是否已加载
    const hasHistoryLoaded = ref(false)
    watch(() => s.values, (values: unknown) => {
        if (values && !hasHistoryLoaded.value) {
            hasHistoryLoaded.value = true
        }
    })

    // interrupt 帧 messages 保留：LangGraph SDK 在 streamMode='values' 下，
    // interrupt 触发的某些帧只携带 __interrupt__ 而把 messages 字段覆写为 []，
    // 导致前端消息列表瞬间清空、内联渲染的 AiToolRenderer 被卸载（TemplateSelectCard
    // 等 interrupt 卡片随之无处挂载）。在这里 cache 上一帧非空 messages，当前帧为空
    // 但 __interrupt__ 存在时回退使用 cache，保留消息列表完整性。
    const lastNonEmptyMessages = shallowRef<BaseMessage[]>([])
    watch(() => s.messages, (msgs: any) => {
        if (Array.isArray(msgs) && msgs.length > 0) {
            lastNonEmptyMessages.value = msgs as BaseMessage[]
        }
    }, { immediate: true })

    return {
        // 状态
        messages: computed((): BaseMessage[] => {
            void s.values // 显式触发 streamValues.value 的 track
            const current = s.messages as BaseMessage[]
            if (Array.isArray(current) && current.length > 0) return current
            // 当前帧 messages 为空：若同时 __interrupt__ 存在（典型场景）
            // 则回退到上一帧的快照，避免 UI 突然失去整列消息
            const v = s.values as any
            if (v?.__interrupt__?.length && lastNonEmptyMessages.value.length > 0) {
                return lastNonEmptyMessages.value
            }
            return current ?? []
        }),
        values: computed(() => s.values as T | undefined),
        isLoading: s.isLoading,   // shallowRef，直接透传
        error: s.error,           // shallowRef，直接透传
        hasHistoryLoaded,
        runStatus,
        runError,

        /**
         * 统一 interrupt 解包（CRITICAL：绕过 Vue 响应式 bug）
         *
         * 不能用 stream.interrupt（依赖 interruptComputed，只追踪 isLoading）
         * 必须从 stream.values（依赖 streamValues shallowRef）的 __interrupt__ 读取
         *
         * 返回 unwrapped payload（含 type/toolCallId 等业务字段），同时附加
         * `_interruptId`（来自 LangGraph 顶层 id 字段，每个 interrupt 唯一），
         * 让 resolveInterrupt 后能区分"同一个 interrupt 的过渡态"vs"新触发的
         * interrupt"——避免点完按钮后 stream 还没刷新时卡片状态闪回 active。
         */
        interruptData: computed(() => {
            const v = s.values as any
            if (!v?.__interrupt__?.length) return null
            const raw = v.__interrupt__
            // 始终取最后一个：LangGraph state 中 __interrupt__ 可能累计多个 pending
            // 中断（前一个未 resume 又触发新的）。当前活跃的总是数组最后一项。
            const resolved = Array.isArray(raw) ? raw[raw.length - 1] : raw
            const value = resolved?.value ?? resolved
            if (value && typeof value === 'object' && resolved?.id != null) {
                return { ...value, _interruptId: resolved.id }
            }
            return value
        }),

        // 操作
        submit: (input?: any, config?: any) => s.submit(input, config) as Promise<void>,
        /**
         * 把 runStatus 复位到 'idle'，常用于"立场提交后想重新触发 watch(runStatus)
         * completed/failed 分支"等场景，对外提供 public API 取代之前直接写
         * `runStatus.value = 'idle'` 的越界访问。
         */
        reset: () => {
            runStatus.value = 'idle'
            runError.value = ''
        },
        // stop 关闭 SSE 流，同时本地立即将 runStatus 设为 'cancelled'：
        // 因为 SSE 流已关闭，后端发送的 cancelled 事件将收不到，需本地同步状态
        // 以便 watch(runStatus) 的下游逻辑（例如队列派发器的暂停分支）能正确触发。
        stop: () => {
            runStatus.value = 'cancelled'
            return s.stop() as Promise<void>
        },
        reconnect: () => {
            hasHistoryLoaded.value = false
            console.log('[useStreamChat] reconnect called, submitting undefined...')
            const result = s.submit(undefined)
            console.log('[useStreamChat] submit returned:', typeof result)
            return result
        },
        loadHistory: () => {
            hasHistoryLoaded.value = false
            console.log('[useStreamChat] loadHistory called, submitting undefined...')
            const result = s.submit(undefined)
            console.log('[useStreamChat] submit returned:', typeof result)
            return result
        },
        getMessagesMetadata: (msg: any, idx?: number) =>
            s.getMessagesMetadata(msg, idx),

        // 子 Agent 分桶状态
        subThreadsMap,
        handleAgentEvent,

        // 合成工具卡片（按 parentMessageId 索引）
        // 业务方传给 useMessageParser 的第三参 / AiChat 的 extraToolCalls prop
        syntheticToolCalls,
    }
}
