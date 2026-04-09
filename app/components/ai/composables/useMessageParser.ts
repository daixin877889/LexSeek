import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'

// --- Types ---

export interface ToolCallWithResult {
  id: string
  name: string
  args: Record<string, any>
  result?: any
  state: 'input-available' | 'output-available' | 'output-error'
}

export interface ParsedMessage {
  id: string
  type: 'human' | 'ai' | 'tool' | 'system'
  content: string
  thinking?: string
  toolCalls?: ToolCallWithResult[]
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

export function useMessageParser(messages: MaybeRef<any[]>) {
  const parsedMessages = computed<ParsedMessage[]>(() => {
    const raw = toValue(messages)
    if (!raw?.length) return []

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
          if (injector?.startsWith('ModuleContext') || injector?.startsWith('CaseMaterial')) {
            return false
          }
        }

        return true
      })
      .map((m, idx) => {
        const msgType = (m as any)._getType?.() ?? (m as any).type

        if (msgType === 'human') {
          return {
            id: m.id ?? `human-${idx}`,
            type: 'human' as const,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            raw: m,
          }
        }
        if (msgType === 'ai') {
          const content = Array.isArray(m.content)
            ? m.content
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text)
                .join('')
            : (m.content as string)
          const toolCalls = matchToolCalls(m, toolResultsMap)
          // 提取 thinking（需在 skip 检查前执行，否则纯 thinking 阶段的消息会被误过滤）
          const thinking = extractThinking(m, false)
          // 跳过无内容、无 toolCalls、无 thinking 的 AI 消息（流式中断时保存的中间状态）
          if (!content && !toolCalls.length && !thinking) return null

          return {
            id: m.id ?? `ai-${idx}`,
            type: 'ai' as const,
            content,
            thinking,
            toolCalls,
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
