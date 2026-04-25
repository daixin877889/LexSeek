import type Redis from 'ioredis'
import { z } from 'zod'
import { getRedisClient } from '~~/server/lib/redis'
import { createChatModel } from '../node/chatModelFactory'
import { getValidNodeConfig } from '../node/node.service'
import { writeMemoryService } from './memory.service'
import { getCheckpointer } from '~~/server/services/workflow/checkpointer'

const EXTRACT_NODE = 'search_intent_router'

const DEBOUNCE_MS = 30 * 1000
const QUEUE_KEY = 'consolidator:due'

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

const extractionSchema = z.object({
  facts: z.array(z.object({
    subjectKey: z.string(),
    text: z.string(),
    confidence: z.number().min(0).max(1),
  })),
  preferences: z.array(z.object({
    text: z.string(),
    confidence: z.number().min(0).max(1),
  })),
  dialogueNotes: z.array(z.object({ text: z.string() })),
})

type Extracted = z.infer<typeof extractionSchema>

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

export async function consolidateSession(sessionId: string): Promise<void> {
  try {
    const session = await prisma.caseSessions.findUnique({
      where: { sessionId },
      select: { caseId: true },
    })
    if (!session?.caseId) return

    const messages = await loadRecentAgentMessages(sessionId, 20)
    if (messages.length === 0) return

    const extracted = await extractMemoriesFromMessages(messages)
    await persistExtracted(session.caseId, extracted)
  } catch (e) {
    logger.warn('consolidator run 失败（best-effort，下轮自动重试）', { sessionId, error: e })
  }
}

async function extractMemoriesFromMessages(
  messages: Array<{ role: string; content: string }>,
): Promise<Extracted> {
  const config = await getValidNodeConfig(EXTRACT_NODE)
  const apiKey = config.modelApiKeys[0]?.apiKey
  if (!apiKey) throw new Error(`节点 ${EXTRACT_NODE} 未配置 API Key`)
  const model = createChatModel({
    sdkType: config.modelSdkType,
    modelName: config.modelName,
    apiKey,
    baseUrl: config.modelProviderBaseUrl,
    streaming: false,
    temperature: 0,
  })
  const extractPrompt = buildExtractPrompt(messages)
  return model.withStructuredOutput(extractionSchema).invoke(extractPrompt)
}

async function persistExtracted(caseId: number, extracted: Extracted): Promise<void> {
  for (const f of extracted.facts) {
    if (f.confidence < 0.6) continue
    await writeMemoryService({
      caseId,
      kind: 'fact',
      text: f.text,
      subjectKey: f.subjectKey,
      confidence: f.confidence,
      source: 'consolidator',
    })
  }
  for (const p of extracted.preferences) {
    if (p.confidence < 0.6) continue
    await writeMemoryService({
      caseId,
      kind: 'preference',
      text: p.text,
      confidence: p.confidence,
      source: 'consolidator',
    })
  }
  for (const n of extracted.dialogueNotes) {
    await writeMemoryService({
      caseId,
      kind: 'dialogue_note',
      text: n.text,
      source: 'consolidator',
    })
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

function buildExtractPrompt(messages: Array<{ role: string; content: string }>): string {
  const joined = messages.map((m) => `[${m.role}] ${m.content}`).join('\n')
  return `从下面律师与 AI 助手的对话中抽取用户侧的：
1. 事实（facts）：客观信息，每条配 subjectKey（主题指纹，如 "plaintiff.address"）+ confidence 0-1
2. 偏好（preferences）：用户对输出/流程的偏好
3. 对话要点（dialogueNotes）：其它值得记住的上下文

对话内容：
${joined}

仅输出符合 schema 的 JSON；不要编造；confidence 低于 0.6 的不要输出。`
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
  for (const sid of sessionIds) {
    await consolidateSession(sid)
  }
}
