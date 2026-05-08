import type Redis from 'ioredis'
import pLimit from 'p-limit'
import { z } from 'zod'
import { getRedisClient } from '~~/server/lib/redis'
import { createChatModel } from '../node/chatModelFactory'
import { getValidNodeConfig } from '../node/node.service'
import { writeMemoryService, type MemoryWriteInput } from './memory.service'
import { getCheckpointer } from '~~/server/services/workflow/checkpointer'

const EXTRACT_NODE = 'search_intent_router'

const DEBOUNCE_MS = 30 * 1000
const QUEUE_KEY = 'consolidator:due'

/** writeMemoryService 内含 embedding API 调用，并发须保守避免 rate-limit */
const PERSIST_CONCURRENCY = 4
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

const extractionSchema = z.object({
  facts: z.array(z.object({
    subjectKey: z.string(),
    text: z.string(),
    confidence: z.number().min(0).max(1),
  })),
  preferences: z.array(z.object({
    subjectKey: z.string(),
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
  const items: MemoryWriteInput[] = []
  for (const f of extracted.facts) {
    if (f.confidence < 0.6) continue
    items.push({
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
    items.push({
      caseId,
      kind: 'preference',
      text: p.text,
      subjectKey: p.subjectKey,
      confidence: p.confidence,
      source: 'consolidator',
    })
  }
  for (const n of extracted.dialogueNotes) {
    items.push({
      caseId,
      kind: 'dialogue_note',
      text: n.text,
      source: 'consolidator',
    })
  }
  if (items.length === 0) return
  // 三段无依赖：拍平后 pLimit 并发，省去 18 次串行 embedding+pgvector 写
  const limit = pLimit(PERSIST_CONCURRENCY)
  await Promise.all(items.map(item => limit(() => writeMemoryService(item))))
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
1. 事实（facts）：客观信息，每条配 subjectKey + confidence 0-1
2. 偏好（preferences）：用户对输出/流程的偏好，每条配 subjectKey + confidence 0-1（subjectKey 必须用下方"preferences 的 subjectKey 命名空间"列出的固定值）
3. 对话要点（dialogueNotes）：其它值得记住的上下文

## subjectKey 命名规范（铁律）

facts 的 subjectKey 必须严格使用以下 \`fact.<域>.<具体>\` 命名空间，**禁止自创**（如 "plaintiff.name"、"contract.totalAmount" 等不符合规范的命名一律禁止）：

- \`fact.party.plaintiff_name\` — 原告/甲方公司全称
- \`fact.party.defendant_name\` — 被告/乙方公司全称
- \`fact.contract.signed_at\` — 主合同签订日期
- \`fact.contract.total_amount\` — 主合同总金额
- \`fact.contract.supplement\` — 补充协议关键事实
- \`fact.payment.first\` — 首付款金额/凭证
- \`fact.delivery.overdue\` — 逾期交付天数/事实
- \`fact.delivery.acknowledgement\` — 对方对逾期/事实的承认
- \`fact.dispute.amount\` — 争议金额
- \`fact.evidence.<类型>\` — 证据材料（如 fact.evidence.wechat / fact.evidence.bank_receipt）
- \`fact.case.<域>\` — 案件级元数据（fact.case.court / fact.case.stage / fact.case.case_no_first / fact.case.case_no_second / fact.case.judge_first / fact.case.judge_second 等）
- \`fact.<其他>.<具体>\` — 上述未覆盖的事实

preferences 的 subjectKey 命名空间：

- \`preference.contact.method\` — 沟通方式偏好（电话/邮件/微信等）
- \`preference.timeline.target\` — 结案时间期望
- \`preference.strategy.attitude\` — 诉讼/和解倾向
- \`preference.disclosure.<域>\` — 信息披露偏好
- \`preference.report.format\` — 报告输出格式偏好
- \`preference.<其他>.<具体>\` — 其他偏好

对话内容：
${joined}

仅输出符合 schema 的 JSON；不要编造；confidence 低于 0.6 的不要输出；subjectKey 必须严格遵守上述命名规范。`
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
  await Promise.all(sessionIds.map(sid => limit(() => consolidateSession(sid))))
}
