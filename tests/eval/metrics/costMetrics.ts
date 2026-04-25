import type { LLMUsageRecord } from '~~/server/services/workflow/callbacks/LLMUsageCallbackHandler'
import type { MetricResult } from '../report/reportTypes'

export interface CostInput {
  usageRecords: readonly LLMUsageRecord[]
  systemPromptTokensSamples: number[]
  totalPromptTokensSamples: number[]
  memoryRecallLatencies: number[]
  analysisSummaryLatencies: number[]
  anthropicProtocolSecondCacheRead: number
  openaiProtocolSecondCachedTokens: number
}

export function aggregateCostMetrics(input: CostInput): MetricResult[] {
  const results: MetricResult[] = []
  const nonWarmup = input.usageRecords.filter(r => !r.isWarmup)

  // systemPromptTokensAvg
  const sysAvg = avg(input.systemPromptTokensSamples)
  results.push({
    name: 'systemPromptTokensAvg',
    value: round(sysAvg),
    threshold: '< 4000',
    severity: 'WARN',
    result: sysAvg < 4000 ? 'pass' : 'fail',
  })

  // totalPromptTokensAvg
  const totAvg = avg(input.totalPromptTokensSamples)
  results.push({
    name: 'totalPromptTokensAvg',
    value: round(totAvg),
    threshold: '< 6000',
    severity: 'WARN',
    result: totAvg < 6000 ? 'pass' : 'fail',
  })

  // cacheHitRate (DeepSeek prompt_cache_hit_tokens / prompt_tokens)
  const sumPromptTokens = nonWarmup.reduce((s, r) => s + (r.usage.prompt_tokens ?? 0), 0)
  const sumCacheHit = nonWarmup.reduce((s, r) => s + (r.usage.prompt_cache_hit_tokens ?? 0), 0)
  const cacheHitRate = sumPromptTokens > 0 ? sumCacheHit / sumPromptTokens : 0
  results.push({
    name: 'cacheHitRate',
    value: round(cacheHitRate, 4),
    threshold: '>= 0.6',
    severity: 'CRITICAL',
    result: cacheHitRate >= 0.6 ? 'pass' : 'fail',
    detail: `hit=${sumCacheHit}, total=${sumPromptTokens}`,
  })

  // anthropic / openai 协议布尔
  results.push({
    name: 'anthropicCacheStructureOk',
    value: input.anthropicProtocolSecondCacheRead > 0,
    threshold: '> 0',
    severity: 'WARN',
    result: input.anthropicProtocolSecondCacheRead > 0 ? 'pass' : 'fail',
  })
  results.push({
    name: 'openaiCacheStructureOk',
    value: input.openaiProtocolSecondCachedTokens > 0,
    threshold: '> 0',
    severity: 'WARN',
    result: input.openaiProtocolSecondCachedTokens > 0 ? 'pass' : 'fail',
  })

  // p95 latencies
  const memP95 = percentile(input.memoryRecallLatencies, 0.95)
  results.push({
    name: 'memoryRecallLatencyP95',
    value: round(memP95),
    threshold: '< 500ms',
    severity: 'WARN',
    result: memP95 < 500 ? 'pass' : 'fail',
  })

  const sumP95 = percentile(input.analysisSummaryLatencies, 0.95)
  results.push({
    name: 'analysisSummaryLatencyP95',
    value: round(sumP95),
    threshold: '< 3000ms',
    severity: 'WARN',
    result: sumP95 < 3000 ? 'pass' : 'fail',
  })

  return results
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]!
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]!
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo)
}

function round(v: number, decimals = 0): number {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}
