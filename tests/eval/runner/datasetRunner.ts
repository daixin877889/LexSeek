/**
 * Eval runner（独立工具脚本，非 server runtime production code）。
 *
 * 单次会话执行器：调用真实 caseMainAgent.runCaseChat，消费 SSE 流，
 * 通过 LLMUsageCallbackHandler 采集本次新增的 token usage。
 *
 * 设计要点：
 *  - handler 由 caller 构造并复用（跨 case 累积记录），本函数只负责切片本次新增
 *  - prompt / cache 字段做多协议兼容（DeepSeek prompt_cache_hit_tokens、Anthropic
 *    cache_read_input_tokens、OpenAI prompt_tokens_details.cached_tokens）
 *  - systemPromptTokens 不在此处采集，由 Task 20 的 stab-prompt-hash 复用
 *    buildContextSegments 输出单独计算
 */

import { runCaseChat } from '~~/server/services/workflow/agents/caseMainAgent'
import type { LLMUsageCallbackHandler } from '~~/server/services/workflow/callbacks/LLMUsageCallbackHandler'
import { consumeAgentSseStream } from '../utils/sseConsumer'

export interface RunCaseInput {
  caseId: number
  userId: number
  /** 取自 fx.caseA.sessions[i]，作为 LangGraph thread_id */
  sessionId: string
  question: string
  isWarmup?: boolean
}

export interface RunCaseOutput {
  threadId: string
  answer: string
  latencyMs: number
  promptTokens: number
  cacheHitTokens: number
}

export async function runOneChat(
  input: RunCaseInput,
  handler: LLMUsageCallbackHandler,
): Promise<RunCaseOutput> {
  handler.setWarmup(input.isWarmup ?? false)
  const before = handler.getRecords().length
  const startedAt = Date.now()

  // CaseAgentOptions: { userId, caseId, thinking?, signal?, callbacks? }
  // callbacks 通过 agent.stream 的 RunnableConfig 透传到底层 LLM
  const stream = await runCaseChat(input.sessionId, input.question, {
    caseId: input.caseId,
    userId: input.userId,
    callbacks: [handler],
  })

  const consumed = await consumeAgentSseStream(stream)
  const latencyMs = Date.now() - startedAt

  const newRecords = handler.getRecords().slice(before)
  const promptTokens = newRecords.reduce(
    (s, r) => s + (r.usage.prompt_tokens ?? r.usage.input_tokens ?? 0),
    0,
  )
  const cacheHitTokens = newRecords.reduce(
    (s, r) =>
      s
      + (r.usage.prompt_cache_hit_tokens
        ?? r.usage.cache_read_input_tokens
        ?? r.usage.prompt_tokens_details?.cached_tokens
        ?? 0),
    0,
  )

  return {
    threadId: consumed.threadId,
    answer: consumed.finalAnswer,
    latencyMs,
    promptTokens,
    cacheHitTokens,
  }
}
