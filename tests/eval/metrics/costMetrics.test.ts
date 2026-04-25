import { describe, it, expect } from 'vitest'
import type { LLMUsageRecord } from '~~/server/services/workflow/callbacks/LLMUsageCallbackHandler'
import { aggregateCostMetrics } from './costMetrics'

const baseRecord = (over: Partial<LLMUsageRecord>): LLMUsageRecord => ({
  tag: 'main',
  runId: 'r',
  usage: {},
  latencyMs: 100,
  isWarmup: false,
  ts: 0,
  ...over,
})

describe('aggregateCostMetrics', () => {
  it('计算 DeepSeek cacheHitRate', () => {
    const records: LLMUsageRecord[] = [
      baseRecord({ usage: { prompt_tokens: 1000, prompt_cache_hit_tokens: 600 } }),
      baseRecord({ usage: { prompt_tokens: 2000, prompt_cache_hit_tokens: 1500 } }),
    ]
    const m = aggregateCostMetrics({
      usageRecords: records,
      systemPromptTokensSamples: [3000, 3500],
      totalPromptTokensSamples: [4500, 5000],
      memoryRecallLatencies: [],
      analysisSummaryLatencies: [],
      anthropicProtocolSecondCacheRead: 1500,
      openaiProtocolSecondCachedTokens: 1200,
    })
    const cacheHit = m.find(x => x.name === 'cacheHitRate')!
    expect(cacheHit.value).toBeCloseTo((600 + 1500) / (1000 + 2000), 4)
    expect(cacheHit.severity).toBe('CRITICAL')
    expect(cacheHit.result).toBe('pass')
  })

  it('排除 isWarmup 记录', () => {
    const records: LLMUsageRecord[] = [
      baseRecord({ isWarmup: true, usage: { prompt_tokens: 1000, prompt_cache_hit_tokens: 0 } }),
      baseRecord({ isWarmup: false, usage: { prompt_tokens: 1000, prompt_cache_hit_tokens: 800 } }),
    ]
    const m = aggregateCostMetrics({
      usageRecords: records,
      systemPromptTokensSamples: [],
      totalPromptTokensSamples: [],
      memoryRecallLatencies: [],
      analysisSummaryLatencies: [],
      anthropicProtocolSecondCacheRead: 0,
      openaiProtocolSecondCachedTokens: 0,
    })
    const cacheHit = m.find(x => x.name === 'cacheHitRate')!
    expect(cacheHit.value).toBeCloseTo(0.8, 4)
  })

  it('cacheHitRate 低于 60% → CRITICAL fail', () => {
    const records: LLMUsageRecord[] = [
      baseRecord({ usage: { prompt_tokens: 1000, prompt_cache_hit_tokens: 400 } }),
    ]
    const m = aggregateCostMetrics({
      usageRecords: records,
      systemPromptTokensSamples: [],
      totalPromptTokensSamples: [],
      memoryRecallLatencies: [],
      analysisSummaryLatencies: [],
      anthropicProtocolSecondCacheRead: 0,
      openaiProtocolSecondCachedTokens: 0,
    })
    const cacheHit = m.find(x => x.name === 'cacheHitRate')!
    expect(cacheHit.result).toBe('fail')
  })

  it('p95 latency 计算', () => {
    const m = aggregateCostMetrics({
      usageRecords: [],
      systemPromptTokensSamples: [],
      totalPromptTokensSamples: [],
      memoryRecallLatencies: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],
      analysisSummaryLatencies: [],
      anthropicProtocolSecondCacheRead: 0,
      openaiProtocolSecondCachedTokens: 0,
    })
    const lat = m.find(x => x.name === 'memoryRecallLatencyP95')!
    expect(lat.value as number).toBeGreaterThanOrEqual(900)
    expect(lat.value as number).toBeLessThanOrEqual(1000)
  })
})
