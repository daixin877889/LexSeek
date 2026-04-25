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
import { extractPromptTokens, extractCacheHitTokens } from '~~/server/services/workflow/callbacks/LLMUsageCallbackHandler'
import { consumeAgentSseStream } from '../utils/sseConsumer'
import { getToolCallsFromThread } from '../utils/traceReader'

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
  /**
   * 本次 chat 新增的 tool_call 名称列表（chat 前后从 langgraph.checkpoint_blobs
   * snapshot 取差集）。同一 sessionId 跑多个 case 时不会被前面 case 的累积污染。
   */
  toolCalls: string[]
}

export async function runOneChat(
  input: RunCaseInput,
  handler: LLMUsageCallbackHandler,
): Promise<RunCaseOutput> {
  handler.setWarmup(input.isWarmup ?? false)
  const before = handler.getRecords().length
  const startedAt = Date.now()

  // chat 前 snapshot 该 thread 已累积的 tool_call 数（含历史轮次），
  // chat 后取 slice(beforeLen) 即为本轮新增 —— 同 sessionId 多 case 串行跑时
  // 才能正确按"本次 chat"切片，不被前一轮 case 的累积调用污染。
  const beforeToolCalls = await getToolCallsFromThread(input.sessionId).catch(() => [])
  const beforeToolLen = beforeToolCalls.length

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
  const promptTokens = newRecords.reduce((s, r) => s + extractPromptTokens(r.usage), 0)
  const cacheHitTokens = newRecords.reduce((s, r) => s + extractCacheHitTokens(r.usage), 0)

  // LangGraph 真实 thread_id 来自传给 runCaseChat 的 sessionId（PostgresSaver 持久化用），
  // sseConsumer 解析的 threadId 仅当后端在 SSE 中明确回传 thread_id 才有值。
  // 兜底取 sessionId 保证 traceReader 能正确从 langgraph.checkpoint_blobs 读到本次跑的消息。
  const afterToolCalls = await getToolCallsFromThread(input.sessionId).catch(() => [])
  const toolCalls = afterToolCalls.slice(beforeToolLen).map(t => t.name)

  return {
    threadId: consumed.threadId || input.sessionId,
    answer: consumed.finalAnswer,
    latencyMs,
    promptTokens,
    cacheHitTokens,
    toolCalls,
  }
}
