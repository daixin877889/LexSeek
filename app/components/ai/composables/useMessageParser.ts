import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import type { ExtendedToolState } from '~/components/ai-elements/types'
import { splitAttachmentSentinel } from '#shared/utils/attachmentSentinel'

// --- Types ---

export interface ToolCallWithResult {
  id: string
  name: string
  args: Record<string, any>
  result?: any
  /**
   * 'input-paused' 专用于工作流 interrupt（如积分不足）期间，
   * 把未完成工具从 'input-available' 重标记为 'input-paused'，
   * 避免 ToolStatusBadge 持续显示"运行中"动画（用户感知"卡住"的根源）。
   */
  state: ExtendedToolState
}

/**
 * 用户上传附件元数据（与 AttachmentMessageBubble.AttachmentLite 同口径）
 *
 * 通过 LangChain BaseMessage.additional_kwargs.attachments 携带，
 * 前端解析时升级到 ParsedMessage.attachments 一等公民字段，
 * AiMessageListVirtualItem 据此走附件气泡渲染分支。
 *
 * 设计动因（方案 C 混合）：metadata 决定渲染形式，content 仍保留可读文本
 * 让 LLM 直接拿 ossFileId 调工具，不需要后端中间件注入。
 */
export interface ParsedAttachment {
  id: number
  fileName: string
  fileType?: string
  fileSize?: number
  encrypted?: boolean
}

export interface ParsedMessage {
  id: string
  type: 'human' | 'ai' | 'tool' | 'system'
  content: string
  thinking?: string
  toolCalls?: ToolCallWithResult[]
  /** 附件元数据；non-empty 时 AiMessageListVirtualItem 走附件气泡渲染 */
  attachments?: ParsedAttachment[]
  raw: any
}

// --- Helpers ---

interface ParsedHumanContent {
  attachments?: ParsedAttachment[]
  rawContent: string
}

// 模块级 WeakMap：human message 的附件解析含 JSON.parse + 字符串 slice，
// computed 每次 messages 数组重排或 isInterrupted 切换都会重跑；message 实例稳定
// 且 human content 不会变（仅 AIMessage 的 token 会流入），缓存安全。
const humanContentParseCache = new WeakMap<object, ParsedHumanContent>()

// 人类消息一次解析后（attachments + content）就不再变化，直接缓存终态 ParsedMessage[]。
// 数组可能是 1 条（只有 content）或 2 条（attachments + content）。
const humanParsedCache = new WeakMap<object, ParsedMessage[]>()

/**
 * AI 消息缓存条目：保存 ParsedMessage 与解析时的依赖引用快照。
 * 命中检查靠引用相等性（O(toolCalls.length)），比 extractThinking +
 * matchToolCalls + content 提取（每条 O(content blocks)）便宜得多。
 *
 * 流式期间，langgraph-sdk 在 MessageTupleManager 用 `prev.concat(chunk)` 产生
 * 新 AIMessageChunk 实例 → WeakMap key 变化 → 自然 miss → 重新解析（符合预期）。
 * 历史已停的消息实例稳定 → 全部命中，O(n) 解析开销降为 O(1) ref 比较。
 */
interface CachedAIParsed {
  parsedMessage: ParsedMessage
  contentRef: unknown
  toolCallsRef: unknown
  additionalKwargsRef: unknown
  // ⚠️ 不快照 m.contentBlocks——它在 @langchain/core 是 getter，每次访问都返回新数组
  // （base.js:153: `[].map(...).reduce(...)`），纳入快照会让缓存永远 miss。
  // contentBlocks 由 content + response_metadata 派生，content 引用快照已能覆盖其变化。
  responseMetadataRef: unknown
  interrupted: boolean
  extrasRef: ToolCallWithResult[] | undefined
  // 跟此 AIMessage 关联的 ToolMessage 引用（按 tc.id 索引）：
  // 新 ToolMessage 到达时（tc 从 input-available → output-available），
  // m.tool_calls 引用没变但 result 状态需更新，靠这个 map 检测。
  toolResultsRef: ReadonlyMap<string, ToolMessage | undefined>
}

const aiParsedCache = new WeakMap<object, CachedAIParsed>()

function isAIParseCacheValid(
  m: AIMessage,
  cached: CachedAIParsed,
  interrupted: boolean,
  extrasForId: ToolCallWithResult[] | undefined,
  toolResultsMap: Map<string, ToolMessage>,
): boolean {
  if (cached.contentRef !== m.content) return false
  if (cached.toolCallsRef !== (m as any).tool_calls) return false
  if (cached.additionalKwargsRef !== m.additional_kwargs) return false
  if (cached.responseMetadataRef !== m.response_metadata) return false
  if (cached.interrupted !== interrupted) return false
  if (cached.extrasRef !== extrasForId) return false
  const tcs = ((m as any).tool_calls ?? []) as Array<{ id?: string }>
  for (const tc of tcs) {
    const id = tc.id ?? ''
    if (cached.toolResultsRef.get(id) !== toolResultsMap.get(id)) return false
  }
  return true
}

function isParsedAttachment(a: unknown): a is ParsedAttachment {
  return !!a && typeof a === 'object' && typeof (a as ParsedAttachment).id === 'number'
    && typeof (a as ParsedAttachment).fileName === 'string'
}

function parseHumanContent(m: any): ParsedHumanContent {
  const cached = humanContentParseCache.get(m)
  if (cached) return cached

  let attachments: ParsedAttachment[] | undefined
  const attMeta = m.additional_kwargs?.attachments
  if (Array.isArray(attMeta) && attMeta.length > 0) {
    const filtered = attMeta.filter(isParsedAttachment)
    if (filtered.length) attachments = filtered
  }

  // sentinel 解析下沉到 shared splitAttachmentSentinel（前端 / 服务端共用一份）。
  // 优先级：additional_kwargs.attachments 已命中则保留，否则回退 sentinel 解析结果。
  const rawInput = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
  const split = splitAttachmentSentinel(rawInput)
  const rawContent = split.rawContent
  if (!attachments && split.attachments.length > 0) {
    attachments = split.attachments
  }

  const result: ParsedHumanContent = { attachments, rawContent }
  humanContentParseCache.set(m, result)
  return result
}

/**
 * 将 API 返回的字典格式消息转为 BaseMessage 实例。
 * 已经是 BaseMessage 实例（包括 MessageChunk）的消息直接透传。
 */
export function coerceRawMessages(raw: any[]): BaseMessage[] {
  if (!raw?.length) return []
  return raw
    .map((m: any) => {
      // 检查是否已经是消息实例（包括 HumanMessageChunk 等 Chunk 类型）
      const msgType = (m as any)._getType?.()
      if (msgType) return m  // MessageChunk 或 BaseMessage 实例直接返回

      // 兼容 stream.values 中以 {type:"tool", data:{...}} 嵌套格式存储的 tool message
      const inner = m.data ?? m
      const type = inner.type ?? inner._type
      if (type === 'human') return new HumanMessage(inner)
      if (type === 'ai') return new AIMessage(inner)
      if (type === 'system') return new SystemMessage(inner)
      if (type === 'tool') {
        return new ToolMessage({
          content: inner.content,
          tool_call_id: inner.tool_call_id,
          id: inner.id,
        })
      }
      return null
    })
    .filter(Boolean) as BaseMessage[]
}

/**
 * 从 AIMessage 中提取推理/思考文本
 *
 * 支持三种传输格式：
 * - contentBlocks 中 type === 'reasoning'（LGP transport 路径）
 * - content 数组中 type === 'thinking'（FetchStreamTransport 路径）
 * - additional_kwargs.reasoning_content（Ollama/DeepSeek 等模型的额外字段）
 *
 * @param message AIMessage 实例
 * @param lastOnly 是否只取最后一个块（流式增量场景）
 */
export function extractThinking(message: AIMessage, lastOnly: boolean = false): string | undefined {
  // 格式 1: contentBlocks（LGP transport 路径）
  if ('contentBlocks' in message && Array.isArray((message as any).contentBlocks)) {
    const blocks = (message as any).contentBlocks
      .filter((b: any) => b.type === 'reasoning')
    if (blocks.length > 0) {
      const result = lastOnly
        ? blocks[blocks.length - 1]?.reasoning
        : blocks.map((b: any) => b.reasoning).join('')
      return result as string | undefined
    }
  }
  // 格式 2: content 数组中的 thinking 块（FetchStreamTransport 路径）
  if (Array.isArray(message.content)) {
    const blocks = message.content
      .filter((b: any) => b.type === 'thinking')
    if (blocks.length > 0) {
      const result = lastOnly
        ? blocks[blocks.length - 1]?.thinking
        : blocks.map((b: any) => b.thinking).join('')
      return result as string | undefined
    }
  }
  // 格式 3: additional_kwargs.reasoning_content（Ollama/DeepSeek 等模型）
  if ((message as any).additional_kwargs?.reasoning_content) {
    return (message as any).additional_kwargs.reasoning_content as string
  }
  return undefined
}

/**
 * 匹配 AIMessage 的 tool_calls 与对应的 ToolMessage 结果。
 * 工具错误状态从 ToolMessage.content 中检测 { error: true } 或 { success: false }。
 *
 * 同时过滤掉后端 messageIntegrity 中间件抢救出的"合成 tool_call"(LLM hallucinated
 * malformed args 时的占位):它们对用户没有 actionable 价值,LLM 会在下一轮自动 retry
 * 用新 tool_call_id 重新调,显示"假失败"卡片只会让用户困惑。
 *
 * 标记字段(与后端 server/services/agent-platform/middleware/messageIntegrity.middleware.ts
 * 的 RECOVERED_KWARGS_MARKER 对齐):
 *  - AIMessage.additional_kwargs.__recoveredFromInvalidArgs = string[](合成 id 列表)
 *  - ToolMessage.additional_kwargs.__recoveredFromInvalidArgs = true
 */
const RECOVERED_KWARGS_MARKER = '__recoveredFromInvalidArgs'

function matchToolCalls(
  aiMessage: AIMessage,
  toolResultsMap: Map<string, ToolMessage>,
): ToolCallWithResult[] {
  const toolCalls = (aiMessage as any).tool_calls ?? []
  if (!toolCalls.length) return []

  // 双轨兜底:从 AIMessage.additional_kwargs 拿合成 id 列表,同时检查 ToolMessage 自带标记
  const recoveredIds = new Set<string>(
    Array.isArray(aiMessage.additional_kwargs?.[RECOVERED_KWARGS_MARKER])
      ? (aiMessage.additional_kwargs![RECOVERED_KWARGS_MARKER] as string[])
      : [],
  )

  return toolCalls
    .filter((tc: any) => {
      const id = tc.id ?? ''
      if (recoveredIds.has(id)) return false
      const tm = toolResultsMap.get(id)
      if ((tm?.additional_kwargs as any)?.[RECOVERED_KWARGS_MARKER]) return false
      return true
    })
    .map((tc: any) => {
      const toolMsg = toolResultsMap.get(tc.id ?? '')
      // ToolMessage.content 才是实际的工具返回数据
      const content = toolMsg?.content
      // 错误判断：从 content 中检测 { error: true } 或 { success: false }
      // content 可能是 string / object / ContentBlock[]
      const hasError = (() => {
        if (content == null) return false
        // string content，尝试解析后判断
        if (typeof content === 'string') {
          try {
            const parsed = JSON.parse(content)
            return parsed.error === true || parsed.success === false
          } catch { return false }
        }
        // object content（排除 ContentBlock[]）
        if (typeof content === 'object' && !Array.isArray(content)) {
          return (content as any).error === true || (content as any).success === false
        }
        return false
      })()

      return {
        id: tc.id ?? '',
        name: tc.name,
        args: tc.args ?? {},
        result: content,
        state: hasError ? 'output-error' : content !== undefined ? 'output-available' : 'input-available',
      } satisfies ToolCallWithResult
    })
}

/**
 * 构造人类消息的 ParsedMessage[]：附件气泡 + 文字气泡（mockup D1 顺序）。
 * 抽出供缓存层调用——人类消息一次提交后实例稳定，调用一次即可。
 */
function buildHumanParsedMessages(m: any, idx: number): ParsedMessage[] {
  // 附件元数据双路径：metadata.additional_kwargs.attachments 优先，
  // content sentinel `__ATTACHMENTS__\n[json]` 兜底（LangGraph SDK 在
  // stream.submit 序列化 plain object messages 时会丢 additional_kwargs）
  const { attachments, rawContent } = parseHumanContent(m)
  const parts: ParsedMessage[] = []
  if (attachments) {
    parts.push({
      id: `${m.id ?? `human-${idx}`}-attachments`,
      type: 'human' as const,
      content: '',
      attachments,
      raw: m,
    })
  }
  if (rawContent) {
    parts.push({
      id: m.id ?? `human-${idx}`,
      type: 'human' as const,
      content: rawContent,
      raw: m,
    })
  }
  return parts
}

/**
 * 构造 AI 消息的 ParsedMessage：合并 content text + thinking + toolCalls（含 interrupt 重标 +
 * synthetic 合成卡片）。返回 null 表示这条 AIMessage 全空（流式中断的中间状态），上层应过滤。
 *
 * 抽出供缓存层调用——开销主要在 matchToolCalls (含 JSON.parse) 和 extractThinking
 * (遍历 contentBlocks 数组)，缓存命中可省掉。
 */
function buildAIParsedMessage(
  m: any,
  idx: number,
  toolResultsMap: Map<string, ToolMessage>,
  interrupted: boolean,
  extrasForId: ToolCallWithResult[] | undefined,
): ParsedMessage | null {
  const content = Array.isArray(m.content)
    ? m.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('')
    : (m.content as string)
  const rawToolCalls = matchToolCalls(m as any, toolResultsMap)
  // interrupt 期间没有 ToolMessage 返回，工具 state 会永远停在 input-available
  // → 显示"运行中"动画 → 用户感知 UI 卡住。重标记为 input-paused 以去掉动画。
  const toolCalls = interrupted
    ? rawToolCalls.map((tc) =>
        tc.state === 'input-available'
          ? { ...tc, state: 'input-paused' as const }
          : tc,
      )
    : rawToolCalls
  // 提取 thinking（需在 skip 检查前执行，否则纯 thinking 阶段的消息会被误过滤）
  // 注意：不要在这里按工具名过滤 thinking/text —— 真正的"意图识别"LLM 调用
  // 在 server/services/retrieval/intentClassifier.service.ts 内部执行，已通过
  // tags:['internal'] + agentWorker.stripSystemMessages 在 SSE 层剥离，前端收不到。
  // 前端能看到的带 search_* tool_calls 的 AI 消息一律是主 Agent 的主线推理，
  // 必须原样保留 thinking 和 text。
  const thinking = extractThinking(m as any, false)
  // 合并合成工具卡片（按 message.id 匹配）：紧跟在 LLM 真实 tool_calls 之后渲染
  // 用途见 syntheticToolCalls 字段说明（当前唯一场景：模块对话摘要进度卡片）
  const synthetic = extrasForId ?? []
  const allToolCalls = synthetic.length > 0 ? [...toolCalls, ...synthetic] : toolCalls

  // 跳过无内容、无 toolCalls、无 thinking 的 AI 消息（流式中断时保存的中间状态）
  if (!content && !allToolCalls.length && !thinking) return null

  return {
    id: m.id ?? `ai-${idx}`,
    type: 'ai' as const,
    content,
    thinking,
    toolCalls: allToolCalls,
    raw: m,
  }
}

// --- Composable ---

/**
 * @param extraToolCallsByMessageId 合成工具卡片（按 parentMessageId 索引），
 *   会被 concat 到匹配 AIMessage 的 toolCalls 末尾。
 *   当前唯一来源：useStreamChat 拦截 ANALYSIS_SUMMARY SSE 事件后注入的"生成结果摘要"卡片。
 */
export function useMessageParser(
  messages: MaybeRef<any[]>,
  isInterrupted?: MaybeRef<boolean>,
  extraToolCallsByMessageId?: MaybeRef<Record<string, ToolCallWithResult[]> | undefined>,
) {
  const parsedMessages = computed<ParsedMessage[]>(() => {
    const raw = toValue(messages)
    const extras = toValue(extraToolCallsByMessageId) ?? {}

    // 优先注入 orphan 合成卡片（如材料处理 phase=start 时 LLM token 还没到，
    // raw 仍是空数组——这里如果直接 return [] 会让卡片"等到 LLM 开始输出才出现"，
    // 失去保底卡片"立即可见"的意义）。
    const orphanList = extras['__pre_agent__'] ?? []
    const orphanMsg: ParsedMessage | null = orphanList.length > 0
      ? {
          id: '__pre_agent_synthetic__',
          type: 'ai' as const,
          content: '',
          thinking: undefined,
          toolCalls: orphanList,
          raw: null as any,
        }
      : null

    if (!raw?.length) {
      return orphanMsg ? [orphanMsg] : []
    }

    const interrupted = !!toValue(isInterrupted)

    const baseMessages = coerceRawMessages(raw)

    // 预计算 ToolMessage 索引（兼容 ToolMessageChunk）
    const toolResultsMap = new Map<string, ToolMessage>()
    for (const m of baseMessages) {
      const t = (m as any)._getType?.() ?? (m as any).type
      if (t === 'tool') {
        toolResultsMap.set((m as any).tool_call_id, m as ToolMessage)
      }
    }
    const result = baseMessages
      .filter((m) => {
        // 使用 _getType() 判断类型（兼容 MessageChunk 子类）
        const msgType = (m as any)._getType?.() ?? (m as any).type

        // SystemMessage 和 ToolMessage 始终过滤
        if (msgType === 'system' || msgType === 'tool') return false

        // HumanMessage 检测 metadata（注入的上下文消息）
        // 前端兜底定位：仅识别新机制 tag CaseContextSyncMiddleware；
        // 旧 tag（CaseContextMiddleware / ModuleContext* / CaseMaterial*）老数据
        // 由后端 SSE 流（agentSseStream）已过滤，前端不重复兜底（spec §4.3）。
        if (msgType === 'human') {
          const injector = (m as any).response_metadata?.injectedBy
            ?? (m as any).additional_kwargs?.injectedBy
          if (injector === 'CaseContextSyncMiddleware') {
            return false
          }
        }

        return true
      })
      .flatMap((m, idx): ParsedMessage[] | ParsedMessage | null => {
        const msgType = (m as any)._getType?.() ?? (m as any).type

        if (msgType === 'human') {
          // 人类消息一次提交后实例稳定，附件 + 文字都不再变化，直接缓存终态
          const cachedHuman = humanParsedCache.get(m as object)
          if (cachedHuman) return cachedHuman
          const parts = buildHumanParsedMessages(m, idx)
          humanParsedCache.set(m as object, parts)
          return parts
        }
        if (msgType === 'ai') {
          const ai = m as any  // BaseMessage 不带 tool_calls/contentBlocks，整体 cast 一次
          const extrasForId = extras[ai.id ?? '']
          const cachedAI = aiParsedCache.get(m as object)
          if (cachedAI && isAIParseCacheValid(ai, cachedAI, interrupted, extrasForId, toolResultsMap)) {
            return cachedAI.parsedMessage
          }
          const parsed = buildAIParsedMessage(ai, idx, toolResultsMap, interrupted, extrasForId)
          if (!parsed) return null

          // 缓存当前依赖快照（toolResultsRef 仅记录跟此 AIMessage 关联的 ToolMessage 引用）
          const toolResultsRef = new Map<string, ToolMessage | undefined>()
          for (const tc of ((ai.tool_calls ?? []) as Array<{ id?: string }>)) {
            const id = tc.id ?? ''
            toolResultsRef.set(id, toolResultsMap.get(id))
          }
          aiParsedCache.set(m as object, {
            parsedMessage: parsed,
            contentRef: ai.content,
            toolCallsRef: ai.tool_calls,
            additionalKwargsRef: ai.additional_kwargs,
            responseMetadataRef: ai.response_metadata,
            interrupted,
            extrasRef: extrasForId,
            toolResultsRef,
          })
          return parsed
        }
        return {
          id: (m as any).id ?? `msg-${idx}`,
          type: 'system' as const,
          content: typeof m.content === 'string' ? m.content : '',
          raw: m,
        }
      })
      .filter(Boolean) as ParsedMessage[]

    // 把上面构造好的 orphan 合成卡片插到 result 头部（前面已经处理 raw 为空的早返路径）
    if (orphanMsg) {
      return [orphanMsg, ...result]
    }

    return result
  })

  return { parsedMessages }
}
