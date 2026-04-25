/**
 * Eval runner（独立工具脚本，非 server runtime production code）。
 * 真实 SSE 协议消费器，对应 server/services/sse/agentSseStream.ts 输出。
 */

export interface SseConsumeResult {
  finalAnswer: string
  threadId: string
  rawEvents: { event: string; data: any }[]
}

/**
 * 消费项目内 agentSseStream 输出的 named-event SSE 流。
 *
 * 协议（参考 server/services/sse/agentSseStream.ts:120-225）：
 *   event: <name>\n
 *   data: <json>\n
 *   \n
 *
 * 已知 event 名：
 *  - values：含 messages 数组（完整快照）
 *  - messages：增量消息
 *  - custom：自定义元数据（含 threadId / status_change / custom_event）
 *
 * finalAnswer 取最后一个 `event: values` 的 messages 数组里最后一条 role='assistant' 的 content。
 * content 可能是 string 或 LangChain ContentBlock[]（{ type: 'text', text } | { type: 'tool_use', ... } 等）。
 */
export async function consumeAgentSseStream(stream: ReadableStream<Uint8Array>): Promise<SseConsumeResult> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const events: { event: string; data: any }[] = []
  let threadId = ''

  const flush = () => {
    while (buf.includes('\n\n')) {
      const idx = buf.indexOf('\n\n')
      const chunk = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const lines = chunk.split('\n')
      let event = ''
      let data = ''
      for (const ln of lines) {
        if (ln.startsWith('event:')) event = ln.slice(6).trim()
        else if (ln.startsWith('data:')) data = ln.slice(5).trim()
      }
      if (!event && !data) continue
      try {
        const parsed = data ? JSON.parse(data) : null
        events.push({ event, data: parsed })
        if (parsed?.threadId && typeof parsed.threadId === 'string') {
          threadId = parsed.threadId
        }
      }
      catch {
        // skip 解析错的 frame
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    flush()
  }
  buf += decoder.decode()
  if (buf.length > 0 && !buf.endsWith('\n\n')) buf += '\n\n'
  flush()

  // 取最后一个 values event 的最后一条 AI 消息
  // 注：LangGraph subgraphs=true 时 event 名带命名空间（'values|model_request:xxx'），用 startsWith
  // 注：LangChain BaseMessage 序列化用 type:'ai'，不是 role:'assistant'
  let finalAnswer = ''
  for (let i = events.length - 1; i >= 0; i--) {
    if (!events[i]!.event.startsWith('values')) continue
    const messages = events[i]!.data?.messages
    if (!Array.isArray(messages)) continue
    for (let j = messages.length - 1; j >= 0; j--) {
      const m = messages[j]
      const isAi = m?.type === 'ai' || m?.role === 'assistant'
      if (!isAi) continue
      if (typeof m.content === 'string' && m.content.length > 0) {
        finalAnswer = m.content
        break
      }
      if (Array.isArray(m.content)) {
        const text = m.content
          .filter((c: any) => c?.type === 'text')
          .map((c: any) => c.text ?? '')
          .join('')
        if (text.length > 0) {
          finalAnswer = text
          break
        }
      }
    }
    if (finalAnswer) break
  }

  return { finalAnswer, threadId, rawEvents: events }
}
