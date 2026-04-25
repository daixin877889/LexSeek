/**
 * traceReader —— 从 LangGraph PostgresSaver 的 checkpoint 存储里解析某个 thread
 * 跑过的所有 tool_calls，供 eval 评测 task 指标（"该工具被调用过吗？"）。
 *
 * 数据真相（已 grep 验证 prisma/migrations/20260422132440_langchain + 真实 blob）：
 *   - LangGraph PostgresSaver 把 channel 数据按 (thread_id, channel_ns, channel, version)
 *     拆分到 `langgraph.checkpoint_blobs`；messages 通道 channel='messages'、
 *     type='json'、blob 是 UTF-8 编码的 LangChain serialized messages 数组。
 *   - 同一 thread 的 messages 是累积的；version 越新内容越全。本实现取
 *     最大 version 一行作为最终消息列表。
 *   - 每条 AIMessage 的 tool_calls 在 `kwargs.tool_calls`：
 *     `{ name, args, id, type: 'tool_call' }`。
 *
 * 注：agent_runs 表没有 state/checkpoint 字段（v1 plan 旧假设错误），
 * checkpoint 实际位于独立 `langgraph` schema。
 */
import { prisma } from '~~/server/utils/db'

export interface ToolCallTrace {
  name: string
  args: Record<string, unknown>
  id?: string
  result?: string
}

interface SerializedMessage {
  lc?: number
  type?: string
  id?: string[]
  kwargs?: {
    tool_calls?: Array<{ name?: string, args?: Record<string, unknown>, id?: string }>
  }
}

interface BlobRow {
  blob: Buffer | null
}

/**
 * 读取指定 LangGraph thread 的所有 tool_calls。
 *
 * @param threadId LangGraph thread_id（即 sessionId 在 PostgresSaver 中的标识）
 * @returns tool_calls 列表（按消息顺序）；thread 不存在时返回 `[]`
 */
export async function getToolCallsFromThread(threadId: string): Promise<ToolCallTrace[]> {
  // 取该 thread 在 messages 通道下 version 最大的那行 blob（version 是 TEXT 但
  // PostgresSaver 写入时是单调递增的整数字符串，按字典序与按整数排序结果一致；
  // 显式 ::int 转换保险）。
  const rows = await prisma.$queryRawUnsafe<BlobRow[]>(
    `SELECT blob
       FROM langgraph.checkpoint_blobs
      WHERE thread_id = $1
        AND channel = 'messages'
        AND type = 'json'
      ORDER BY (version)::int DESC
      LIMIT 1`,
    threadId,
  )

  if (rows.length === 0 || !rows[0].blob) return []

  let messages: SerializedMessage[]
  try {
    const text = Buffer.from(rows[0].blob).toString('utf8')
    const parsed = JSON.parse(text)
    messages = Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }

  const calls: ToolCallTrace[] = []
  for (const msg of messages) {
    const tcs = msg?.kwargs?.tool_calls
    if (!Array.isArray(tcs)) continue
    for (const tc of tcs) {
      if (!tc?.name) continue
      calls.push({
        name: tc.name,
        args: tc.args ?? {},
        id: tc.id,
      })
    }
  }
  return calls
}
