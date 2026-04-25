// tests/eval/metrics/qualityMetrics.ts
import type { CaseResult, MetricResult } from '../report/reportTypes'

/**
 * mustHave / mustNotHave 元素：
 * - string：要求该字串出现（命中即 hit）
 * - string[]：表示 OR（任一字串出现即 hit）—— 用于多种合法表述（如
 *   `['2024-03-15', '2024年3月15日']`、`['张某', '张三']`）
 */
export type FactKeyword = string | string[]

export interface FactsInput {
  answer: string
  mustHave: FactKeyword[]
  mustNotHave?: FactKeyword[]
}

export interface FactsResult {
  factsHitRate: number
  mustHaveHits: string[]
  mustHaveMisses: string[]
  hallucinationHits: string[]
}

function normalize(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase()
}

function keywordToLabel(kw: FactKeyword): string {
  return Array.isArray(kw) ? kw.join('|') : kw
}

function keywordHits(ansN: string, kw: FactKeyword): boolean {
  if (Array.isArray(kw)) return kw.some(k => ansN.includes(normalize(k)))
  return ansN.includes(normalize(kw))
}

export function evaluateFactsCase(input: FactsInput): FactsResult {
  const ansN = normalize(input.answer)
  const hits: string[] = []
  const misses: string[] = []
  for (const kw of input.mustHave) {
    if (keywordHits(ansN, kw)) hits.push(keywordToLabel(kw))
    else misses.push(keywordToLabel(kw))
  }
  const hallucinations: string[] = []
  for (const bad of input.mustNotHave ?? []) {
    if (keywordHits(ansN, bad)) hallucinations.push(keywordToLabel(bad))
  }
  return {
    factsHitRate: input.mustHave.length === 0 ? 1 : hits.length / input.mustHave.length,
    mustHaveHits: hits,
    mustHaveMisses: misses,
    hallucinationHits: hallucinations,
  }
}

export function aggregateQualityMetrics(cases: CaseResult[]): MetricResult[] {
  const factsCases = cases.filter(c => c.factsHitRate !== undefined)
  const allHits = factsCases.reduce((s, c) => s + c.mustHaveHits.length, 0)
  const allTotal = factsCases.reduce(
    (s, c) => s + c.mustHaveHits.length + c.mustHaveMisses.length,
    0,
  )
  const factsHitRate = allTotal > 0 ? allHits / allTotal : 0

  const totalCases = cases.length || 1
  const hallucCount =
    cases.reduce((s, c) => s + c.hallucinationHits.length, 0) +
    cases.filter(c => (c.judgeResult?.score_no_hallucination ?? 5) <= 2).length
  const hallucinationRate = hallucCount / totalCases

  const overallSum = cases.reduce((s, c) => {
    if (c.judgeResult) return s + c.judgeResult.overall
    if (c.factsHitRate !== undefined) return s + c.factsHitRate * 5
    return s
  }, 0)
  const qualityScore = overallSum / totalCases

  return [
    {
      name: 'qualityScore',
      value: round(qualityScore, 2),
      threshold: '>= 4.0',
      severity: 'WARN',
      result: qualityScore >= 4.0 ? 'pass' : 'fail',
    },
    {
      name: 'factsHitRate',
      value: round(factsHitRate, 4),
      threshold: '>= 0.8',
      severity: 'WARN',
      result: factsHitRate >= 0.8 ? 'pass' : 'fail',
    },
    {
      name: 'hallucinationRate',
      value: round(hallucinationRate, 4),
      threshold: '<= 0.05',
      severity: 'CRITICAL',
      result: hallucinationRate <= 0.05 ? 'pass' : 'fail',
    },
  ]
}

function round(v: number, decimals = 0): number {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}
