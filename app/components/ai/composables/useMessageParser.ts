import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'
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
 * 已经是 BaseMessage 实例的消息直接透传。
 */
export function coerceRawMessages(raw: any[]): BaseMessage[] {
  if (!raw?.length) return []
  return raw
    .map((m: any) => {
      if (m instanceof HumanMessage || m instanceof AIMessage || m instanceof ToolMessage)
        return m
      // 兼容 stream.values 中以 {type:"tool", data:{...}} 嵌套格式存储的 tool message
      const inner = m.data ?? m
      const type = inner.type ?? inner._type
      if (type === 'human') return new HumanMessage(inner)
      if (type === 'ai') return new AIMessage(inner)
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
 * 提取 AIMessage 中的推理/思考文本。
 * 支持两种传输格式：
 * - contentBlocks 中 type === 'reasoning'（LGP transport 路径）
 * - content 数组中 type === 'thinking'（FetchStreamTransport 路径）
 */
function extractThinking(message: AIMessage): string | undefined {
  // 格式 1: contentBlocks（LGP transport 路径）
  if ('contentBlocks' in message) {
    const text = (message as any).contentBlocks
      .filter((b: any) => b.type === 'reasoning')
      .map((b: any) => b.reasoning)
      .join('')
    if (text) return text
  }
  // 格式 2: content 数组中的 thinking 块（FetchStreamTransport 路径）
  if (Array.isArray(message.content)) {
    const text = message.content
      .filter((b: any) => b.type === 'thinking')
      .map((b: any) => b.thinking)
      .join('')
    if (text) return text
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

    // 预计算 ToolMessage 索引
    const toolResultsMap = new Map<string, ToolMessage>()
    for (const m of baseMessages) {
      if (m instanceof ToolMessage) {
        toolResultsMap.set((m as any).tool_call_id, m)
      }
    }

    return baseMessages
      .filter((m) => !(m instanceof ToolMessage)) // ToolMessage 合并到 AI 消息
      .map((m, _idx) => {
        if (m instanceof HumanMessage) {
          return {
            id: m.id ?? `human-${_idx}`,
            type: 'human' as const,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            raw: m,
          }
        }
        if (m instanceof AIMessage) {
          const content = Array.isArray(m.content)
            ? m.content
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text)
                .join('')
            : (m.content as string)

          return {
            id: m.id ?? `ai-${_idx}`,
            type: 'ai' as const,
            content,
            thinking: extractThinking(m),
            toolCalls: matchToolCalls(m, toolResultsMap),
            raw: m,
          }
        }
        return {
          id: (m as any).id ?? `msg-${_idx}`,
          type: 'system' as const,
          content: typeof m.content === 'string' ? m.content : '',
          raw: m,
        }
      })
  })

  return { parsedMessages }
}
