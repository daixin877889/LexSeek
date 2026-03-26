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
      const type = m?.type ?? m?._type
      if (type === 'human') return new HumanMessage(m)
      if (type === 'ai') return new AIMessage(m)
      if (type === 'tool') return new ToolMessage(m)
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
 * 工具错误状态使用 result.status === 'error'（与现有实现一致）。
 */
function matchToolCalls(
  aiMessage: AIMessage,
  toolResultsMap: Map<string, any>,
): ToolCallWithResult[] {
  const toolCalls = (aiMessage as any).tool_calls ?? []
  if (!toolCalls.length) return []

  return toolCalls.map((tc: any) => {
    const result = toolResultsMap.get(tc.id ?? '')
    const hasError = result && result.status === 'error'

    return {
      id: tc.id ?? '',
      name: tc.name,
      args: tc.args ?? {},
      result: result ?? undefined,
      state: hasError ? 'output-error' : result ? 'output-available' : 'input-available',
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
    const toolResultsMap = new Map<string, any>()
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
