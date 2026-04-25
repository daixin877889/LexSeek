export type Severity = 'CRITICAL' | 'WARN'
export type Result = 'pass' | 'fail' | 'errored'

export interface MetricResult {
  name: string
  value: number | boolean | string
  threshold?: string
  severity: Severity
  result: Result
  detail?: string
}

export interface CaseResult {
  id: string
  group: string
  question: string
  answer: string
  factsHitRate?: number
  mustHaveHits: string[]
  mustHaveMisses: string[]
  hallucinationHits: string[]
  toolCalls: string[]
  expectedTools?: string[]
  tokens: { prompt?: number; completion?: number; cacheHit?: number }
  latencyMs: number
  threadId?: string
  judgeResult?: {
    overall: number
    score_facts: number
    score_citation: number
    score_no_hallucination: number
    score_relevance: number
    reasoning: string
    repeats: number
    stdev: number
    unstable: boolean
  }
  result: Result
}

export interface ExtractionResult {
  transcriptId: string
  recallHits: number
  recallMisses: number
  precisionMisses: number
  totalExtracted: number
  recall: number
  precision: number
  versionChainCorrect?: boolean
  detail: string
}

export interface SecurityAssertionResult {
  id: string
  category: string
  severity: Severity
  result: Result
  detail: string
}

export interface EvalReport {
  version: '1.0'
  runAt: string
  commit: string
  durationMs: number
  summary: {
    totalCritical: number
    passedCritical: number
    totalWarn: number
    passedWarn: number
    criticalFailures: string[]
    overallPass: boolean
  }
  metrics: {
    cost: MetricResult[]
    quality: MetricResult[]
    task: MetricResult[]
    extraction: MetricResult[]
    security: MetricResult[]
    stability: MetricResult[]
  }
  cases: CaseResult[]
  extractions: ExtractionResult[]
  securityAssertions: SecurityAssertionResult[]
  errored: { id: string; reason: string }[]
}
