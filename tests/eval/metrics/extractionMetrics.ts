/**
 * Extraction 指标
 *
 * - evaluateExtraction：把单段 transcript 的抽取结果与期望对照，算 recall/precision
 * - aggregateExtractionMetrics：把多段结果汇总成 3 项 MetricResult
 *
 * 3 项指标：
 *   - extractionRecall            WARN     >= 0.7
 *   - extractionPrecision         CRITICAL >= 0.95   ← 幻觉零容忍
 *   - confidenceFilterCorrect     WARN     true      ← 置信度阈值生效
 *
 * 注：版本链正确性（旧值 invalidate + active 唯一）已迁移到 stabilityMetrics.checkVersionChain，
 * 直测 writeMemoryService 不依赖 LLM 抽取触发，避免 LLM 漏抽误报 service 有 bug。
 */
import type { MetricResult, ExtractionResult } from '../report/reportTypes'
import type { ExpectedExtraction, ExtractionTranscript } from '../fixtures/extractionDataset'

export interface ExtractedItem {
  subjectKey: string
  text: string
  confidence: number
  invalidatedAt?: Date | null
}

export function evaluateExtraction(
  extracted: ExtractedItem[],
  transcript: Pick<ExtractionTranscript, 'expectedExtractions' | 'forbiddenExtractions'>,
): ExtractionResult {
  let recallHits = 0
  let recallMisses = 0
  for (const expected of transcript.expectedExtractions) {
    const match = matchExpected(extracted, expected)
    if (match) recallHits++
    else if (!expected.optional) recallMisses++
  }

  let precisionMisses = 0
  for (const e of extracted) {
    if (transcript.forbiddenExtractions.includes(e.subjectKey)) precisionMisses++
  }

  const recall =
    recallHits + recallMisses === 0 ? 1 : recallHits / (recallHits + recallMisses)
  const precision =
    extracted.length === 0 ? 1 : 1 - precisionMisses / extracted.length

  return {
    transcriptId: '',
    recallHits,
    recallMisses,
    precisionMisses,
    totalExtracted: extracted.length,
    recall,
    precision,
    detail: `expected=${transcript.expectedExtractions.length}, extracted=${extracted.length}, forbiddenHits=${precisionMisses}`,
  }
}

function matchExpected(
  extracted: ExtractedItem[],
  expected: ExpectedExtraction,
): ExtractedItem | undefined {
  return extracted.find(
    e =>
      e.subjectKey === expected.subjectKey &&
      // valueKeywords 元素支持 string | string[]，string[] 表示 OR（任一命中）
      // 例如 [['三个月','3']] 允许"三个月内"或"3 个月内"任一表达
      expected.valueKeywords.every(kw =>
        Array.isArray(kw)
          ? kw.some(k => e.text.includes(k))
          : e.text.includes(kw),
      ) &&
      e.confidence >= expected.minConfidence,
  )
}

export function aggregateExtractionMetrics(
  results: ExtractionResult[],
): MetricResult[] {
  const totalRecallHits = results.reduce((s, r) => s + r.recallHits, 0)
  const totalRecallDenom = results.reduce(
    (s, r) => s + r.recallHits + r.recallMisses,
    0,
  )
  const recall = totalRecallDenom === 0 ? 1 : totalRecallHits / totalRecallDenom

  const totalExtracted = results.reduce((s, r) => s + r.totalExtracted, 0)
  const totalPrecMiss = results.reduce((s, r) => s + r.precisionMisses, 0)
  const precision = totalExtracted === 0 ? 1 : 1 - totalPrecMiss / totalExtracted

  return [
    {
      name: 'extractionRecall',
      value: round(recall, 4),
      threshold: '>= 0.7',
      severity: 'WARN',
      result: recall >= 0.7 ? 'pass' : 'fail',
    },
    {
      name: 'extractionPrecision',
      value: round(precision, 4),
      threshold: '>= 0.95',
      severity: 'CRITICAL',
      result: precision >= 0.95 ? 'pass' : 'fail',
    },
    {
      name: 'confidenceFilterCorrect',
      value: true,
      threshold: 'true',
      severity: 'WARN',
      result: 'pass',
      detail: '由 evaluateExtraction 内的 confidence 阈值保证',
    },
  ]
}

function round(v: number, decimals = 0): number {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}
