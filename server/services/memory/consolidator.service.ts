import type Redis from 'ioredis'
import pLimit from 'p-limit'
import { getRedisClient } from '~~/server/lib/redis'
import { runMemoryExtractionService } from './memoryExtraction.service'
import { getCheckpointer } from '~~/server/services/workflow/checkpointer'

const DEBOUNCE_MS = 30 * 1000
const QUEUE_KEY = 'consolidator:due'

/** consolidateSession 内含一次 LLM 抽取 + 多次 writeMemoryService，更保守 */
const SESSION_CONCURRENCY = 3

/** LangChain 序列化格式（checkpoint 存储） */
interface SerializedLCMessage {
  lc: number
  type: 'constructor'
  id: string[]
  kwargs: { content: string | unknown }
}

/** 实例化格式（部分场景） */
interface InstantiatedLCMessage {
  getType(): string
  content: string | unknown
}

type LangGraphMessage = SerializedLCMessage | InstantiatedLCMessage

function resolveMessageRole(m: LangGraphMessage): string | null {
  if (typeof (m as InstantiatedLCMessage).getType === 'function') {
    return (m as InstantiatedLCMessage).getType()
  }
  const s = m as SerializedLCMessage
  const className = s.id?.at(-1) ?? ''
  if (className === 'HumanMessage') return 'human'
  if (className === 'AIMessage' || className === 'AIMessageChunk') return 'ai'
  return null
}

function resolveMessageContent(m: LangGraphMessage): string {
  let raw: unknown
  if (typeof (m as InstantiatedLCMessage).getType === 'function') {
    raw = (m as InstantiatedLCMessage).content
  } else {
    raw = (m as SerializedLCMessage).kwargs?.content
  }
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) {
    return raw
      .filter((c): c is { type: string; text: string } => c?.type === 'text')
      .map(c => c.text)
      .join('')
  }
  return JSON.stringify(raw)
}

export async function scheduleConsolidation(params: {
  caseId: number
  sessionId: string
}): Promise<void> {
  const redis = getRedisClient()
  const dueAt = Date.now() + DEBOUNCE_MS
  await redis.zadd(QUEUE_KEY, dueAt, params.sessionId)
}

export async function drainDueSessions(): Promise<string[]> {
  const redis = getRedisClient()
  const now = Date.now()
  const ids: string[] = await redis.zrangebyscore(QUEUE_KEY, 0, now)
  for (const id of ids) await redis.zrem(QUEUE_KEY, id)
  return ids
}

export async function consolidateSession(sessionId: string, knownCaseId?: number): Promise<void> {
  try {
    let caseId = knownCaseId
    if (caseId == null) {
      const session = await prisma.caseSessions.findUnique({
        where: { sessionId },
        select: { caseId: true },
      })
      if (!session?.caseId) return
      caseId = session.caseId
    }

    const messages = await loadRecentAgentMessages(sessionId, 20)
    if (messages.length === 0) return

    // 复用 memoryExtraction 主路径（caseMemoryExtract 节点 + invokeNodeJson）
    await runMemoryExtractionService({ caseId, sessionId, messages })
  } catch (e) {
    logger.warn('consolidator run 失败（best-effort，下轮自动重试）', { sessionId, error: e })
  }
}

async function loadRecentAgentMessages(
  sessionId: string,
  limit: number,
): Promise<Array<{ role: string; content: string }>> {
  try {
    const checkpointer = await getCheckpointer()
    const tuple = await checkpointer.getTuple({ configurable: { thread_id: sessionId } })
    if (!tuple) return []
    const rawMessages = (tuple.checkpoint.channel_values as Record<string, unknown>)?.messages
    const messages: LangGraphMessage[] = Array.isArray(rawMessages) ? (rawMessages as LangGraphMessage[]) : []
    return messages
      .filter((m) => { const r = resolveMessageRole(m); return r === 'human' || r === 'ai' })
      .slice(-limit)
      .map((m) => ({
        role: resolveMessageRole(m)!,
        content: resolveMessageContent(m),
      }))
  } catch {
    return []
  }
}

/**
 * 立即处理指定 caseId 的对话抽取，跳过 debounce 窗口。
 *
 * 用途：
 * - eval 跑 extraction dataset 时同步等待结果（绕过 30s debounce）
 * - 管理后台未来的"立刻整理记忆"按钮
 *
 * 实现：
 *   1. 找出该 caseId 名下所有 case_sessions
 *   2. 从 ZSET 中移除（drain）
 *   3. 同步 await consolidateSession 跑完
 *
 * @param opts.redis 可选注入的独立 redis client（eval 用 db=15 隔离时传入）
 */
export async function processNowService(
  caseId: number,
  opts?: { redis?: Redis },
): Promise<void> {
  const sessions = await prisma.caseSessions.findMany({
    where: { caseId },
    select: { sessionId: true },
  })
  if (sessions.length === 0) return

  const redis = opts?.redis ?? getRedisClient()
  const sessionIds = sessions.map(s => s.sessionId)
  if (sessionIds.length > 0) {
    await redis.zrem(QUEUE_KEY, ...sessionIds)
  }
  // 多 session 并发抽取；consolidateSession 内部 try/catch 已吞错（best-effort），
  // 单个失败不影响其它。SESSION_CONCURRENCY 保守，避免压垮 LLM provider rate-limit。
  const limit = pLimit(SESSION_CONCURRENCY)
  await Promise.all(sessionIds.map(sid => limit(() => consolidateSession(sid, caseId))))
}
