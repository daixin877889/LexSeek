import { z } from 'zod'
import { getRedisClient } from '~~/server/lib/redis'
import { createChatModel } from '../node/chatModelFactory'
import { writeMemoryService } from './memory.service'
import { getCheckpointer } from '~~/server/services/workflow/checkpointer'

const DEBOUNCE_MS = 30 * 1000
const QUEUE_KEY = 'consolidator:due'

interface LangGraphMessage {
  getType(): string
  content: string | unknown
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
  const haiku = createChatModel({
    sdkType: 'anthropic',
    modelName: 'claude-haiku-4-5-20251001',
    apiKey: process.env.ANTHROPIC_API_KEY!,
    streaming: false,
    temperature: 0,
  })
  const extractPrompt = buildExtractPrompt(messages)
  return haiku.withStructuredOutput(extractionSchema).invoke(extractPrompt)
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
      .filter((m) => m.getType() === 'human' || m.getType() === 'ai')
      .slice(-limit)
      .map((m) => ({
        role: m.getType(),
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
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
