// tests/eval/metrics/qualityMetrics.ts
import type { CaseResult, MetricResult } from '../report/reportTypes'

export interface FactsInput {
  answer: string
  mustHave: string[]
  mustNotHave?: string[]
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

export function evaluateFactsCase(input: FactsInput): FactsResult {
  const ansN = normalize(input.answer)
  const hits: string[] = []
  const misses: string[] = []
  for (const kw of input.mustHave) {
    if (ansN.includes(normalize(kw))) hits.push(kw)
    else misses.push(kw)
  }
  const hallucinations: string[] = []
  for (const bad of input.mustNotHave ?? []) {
    if (ansN.includes(normalize(bad))) hallucinations.push(bad)
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
