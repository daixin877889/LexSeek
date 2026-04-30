import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import type { ExtendedToolState } from '~/components/ai-elements/types'

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
 */
function matchToolCalls(
  aiMessage: AIMessage,
  toolResultsMap: Map<string, ToolMessage>,
): ToolCallWithResult[] {
  const toolCalls = (aiMessage as any).tool_calls ?? []
  if (!toolCalls.length) return []

  return toolCalls.map((tc: any) => {
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
    if (!raw?.length) return []

    const interrupted = !!toValue(isInterrupted)
    const extras = toValue(extraToolCallsByMessageId) ?? {}

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
        if (msgType === 'human') {
          const injector = (m as any).response_metadata?.injectedBy as string | undefined
          if (injector?.startsWith('ModuleContext') || injector?.startsWith('CaseMaterial') || injector?.startsWith('SubAgentContext') || injector === 'CaseContextMiddleware') {
            return false
          }
        }

        return true
      })
      .flatMap((m, idx): ParsedMessage[] | ParsedMessage | null => {
        const msgType = (m as any)._getType?.() ?? (m as any).type

        if (msgType === 'human') {
          // 阶段 5 方案 C：附件元数据来源两条路径
          //   1. 优先：LangChain 标准 additional_kwargs.attachments（理想路径）
          //   2. fallback：content sentinel `__ATTACHMENTS__\n[json]` 解析
          //      （LangGraph SDK 在 stream.submit 序列化普通 plain object 的
          //       messages 时**会丢弃 additional_kwargs 字段**，因此 content
          //       sentinel 是当前 transport 实际可靠的承载方式）
          let attachments: ParsedAttachment[] | undefined
          const attMeta = (m as any).additional_kwargs?.attachments
          if (Array.isArray(attMeta) && attMeta.length > 0) {
            attachments = attMeta
              .filter(
                (a): a is ParsedAttachment =>
                  a && typeof a === 'object' && typeof a.id === 'number' && typeof a.fileName === 'string',
              )
            if (!attachments.length) attachments = undefined
          }

          // content 中剥离 sentinel 段（让用户文字气泡只显示原话）；
          // 同时若 metadata 没拿到 attachments，从这里 parse JSON 兜底
          const ATTACH_SENTINEL = '__ATTACHMENTS__\n'
          let rawContent = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
          if (rawContent.startsWith(ATTACH_SENTINEL)) {
            const newlineIdx = rawContent.indexOf('\n', ATTACH_SENTINEL.length)
            const sentinelJson = newlineIdx === -1
              ? rawContent.slice(ATTACH_SENTINEL.length)
              : rawContent.slice(ATTACH_SENTINEL.length, newlineIdx)
            // 兜底：metadata 没拿到时从 sentinel JSON 解析
            if (!attachments) {
              try {
                const arr = JSON.parse(sentinelJson)
                if (Array.isArray(arr) && arr.length > 0) {
                  const filtered = arr.filter(
                    (a): a is ParsedAttachment =>
                      a && typeof a === 'object' && typeof a.id === 'number' && typeof a.fileName === 'string',
                  )
                  if (filtered.length) attachments = filtered
                }
              } catch {
                // sentinel JSON parse 失败，忽略
              }
            }
            // 剥离 sentinel 段，rawContent 仅保留用户原话
            if (newlineIdx === -1) {
              rawContent = ''
            } else {
              rawContent = rawContent.slice(newlineIdx + 1).replace(/^\n+/, '')
            }
          }

          // 单条 LangChain message → 展开为两条 ParsedMessage：
          //   ① 附件气泡（仅当 attachments 非空）
          //   ② 用户文字（仅当 rawContent 非空）
          // 顺序对齐 mockup D1：附件先于文字（视觉上"先看到上传了什么，再看到留言"）
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
        if (msgType === 'ai') {
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
          const synthetic = extras[m.id ?? ''] ?? []
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
        return {
          id: (m as any).id ?? `msg-${idx}`,
          type: 'system' as const,
          content: typeof m.content === 'string' ? m.content : '',
          raw: m,
        }
      })
      .filter(Boolean) as ParsedMessage[]

    return result
  })

  return { parsedMessages }
}
