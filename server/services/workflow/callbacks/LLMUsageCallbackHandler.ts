import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import type { Serialized } from '@langchain/core/load/serializable'
import type { LLMResult } from '@langchain/core/outputs'

export interface RawLLMUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  // DeepSeek 原生
  prompt_cache_hit_tokens?: number
  prompt_cache_miss_tokens?: number
  // Anthropic 协议
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  // OpenAI 协议
  prompt_tokens_details?: {
    cached_tokens?: number
  }
}

export interface LLMUsageRecord {
  tag: string
  runId: string
  usage: RawLLMUsage
  latencyMs: number
  isWarmup: boolean
  ts: number
}

interface HandlerOptions {
  tag: string
  isWarmup: boolean
}

/**
 * 从 LangChain LLM callback 抓取**供应商原始 usage**（不走标准化的 usage_metadata）。
 *
 * 使用方式：在 eval runner 里实例化一次，注册到 chat model 的 callbacks 数组，
 * 跑完后 `getRecords()` 拿全部记录用于 aggregator。
 *
 * 为什么不用 LangChain 标准化的 usage_metadata：DeepSeek 的 `prompt_cache_hit_tokens`
 * 不在标准字段里，只在 `response_metadata.usage` 中。
 */
export class LLMUsageCallbackHandler extends BaseCallbackHandler {
  name = 'LLMUsageCallbackHandler'
  private records: LLMUsageRecord[] = []
  private startTimes = new Map<string, number>()

  constructor(private opts: HandlerOptions) {
    super()
  }

  async handleLLMStart(_llm: Serialized, _prompts: string[], runId: string): Promise<void> {
    this.startTimes.set(runId, Date.now())
  }

  async handleLLMEnd(output: LLMResult, runId: string): Promise<void> {
    const startedAt = this.startTimes.get(runId) ?? Date.now()
    const latencyMs = Date.now() - startedAt
    this.startTimes.delete(runId)

    const gen = output?.generations?.[0]?.[0] as {
      message?: {
        response_metadata?: { usage?: RawLLMUsage }
        usage_metadata?: { input_tokens?: number; output_tokens?: number; total_tokens?: number; input_token_details?: { cache_read?: number; cache_creation?: number } }
      }
    } | undefined
    const responseUsage: RawLLMUsage = gen?.message?.response_metadata?.usage ?? {}
    const stdUsage = gen?.message?.usage_metadata
    // 兜底：DeepSeek 走 Anthropic 协议时 response_metadata.usage 缺 input_tokens / prompt_tokens，
    // 从 LangChain 标准化的 usage_metadata 补齐（input_tokens / output_tokens / cache_read 等）
    const usage: RawLLMUsage = {
      ...responseUsage,
      input_tokens: responseUsage.input_tokens ?? stdUsage?.input_tokens,
      output_tokens: responseUsage.output_tokens ?? stdUsage?.output_tokens,
      prompt_tokens: responseUsage.prompt_tokens ?? stdUsage?.input_tokens,
      cache_read_input_tokens: responseUsage.cache_read_input_tokens ?? stdUsage?.input_token_details?.cache_read,
    }

    this.records.push({
      tag: this.opts.tag,
      runId,
      usage,
      latencyMs,
      isWarmup: this.opts.isWarmup,
      ts: Date.now(),
    })
  }

  getRecords(): readonly LLMUsageRecord[] {
    return this.records
  }

  reset(): void {
    this.records = []
    this.startTimes.clear()
  }

  /** 切换 warmup flag（warmup 阶段结束后调用） */
  setWarmup(isWarmup: boolean): void {
    this.opts.isWarmup = isWarmup
  }
}
