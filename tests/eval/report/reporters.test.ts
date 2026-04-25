import { describe, it, expect } from 'vitest'
import { writeJsonReport } from './jsonReporter'
import { writeMarkdownReport } from './markdownReporter'
import type { EvalReport, MetricResult } from './reportTypes'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 25 项锁定指标：cost 5 + quality 5 + task 4 + extraction 4 + security 4 + stability 3 = 25
function makeMetric(name: string, severity: 'CRITICAL' | 'WARN', result: 'pass' | 'fail'): MetricResult {
  return { name, value: result === 'pass' ? 1 : 0, threshold: '>= 1', severity, result }
}

const sampleReport: EvalReport = {
  version: '1.0',
  runAt: '2026-04-25T14:30:12+08:00',
  commit: 'abc123',
  durationMs: 12000,
  summary: {
    totalCritical: 2,
    passedCritical: 1,
    totalWarn: 1,
    passedWarn: 1,
    criticalFailures: ['cacheHitRate'],
    overallPass: false,
  },
  metrics: {
    cost: [
      { name: 'cacheHitRate', value: 0.4, threshold: '>= 0.6', severity: 'CRITICAL', result: 'fail' },
      makeMetric('systemPromptTokensAvg', 'WARN', 'pass'),
      makeMetric('totalTokensAvg', 'WARN', 'pass'),
      makeMetric('costPerCaseAvg', 'WARN', 'pass'),
      makeMetric('latencyP95', 'WARN', 'pass'),
    ],
    quality: [
      makeMetric('factsHitRate', 'CRITICAL', 'pass'),
      makeMetric('citationCorrect', 'CRITICAL', 'pass'),
      makeMetric('hallucinationRate', 'CRITICAL', 'pass'),
      makeMetric('relevanceScore', 'WARN', 'pass'),
      makeMetric('judgeStability', 'WARN', 'pass'),
    ],
    task: [
      makeMetric('toolCallAccuracy', 'CRITICAL', 'pass'),
      makeMetric('versionChainCorrect', 'CRITICAL', 'pass'),
      makeMetric('moduleScopeIsolation', 'CRITICAL', 'pass'),
      makeMetric('moduleSwitchAtomic', 'WARN', 'pass'),
    ],
    extraction: [
      makeMetric('extractionRecall', 'CRITICAL', 'pass'),
      makeMetric('extractionPrecision', 'WARN', 'pass'),
      makeMetric('chunkBoundaryStable', 'WARN', 'pass'),
      makeMetric('idempotencyCheck', 'CRITICAL', 'pass'),
    ],
    security: [
      makeMetric('crossCaseLeak', 'CRITICAL', 'pass'),
      makeMetric('roleEscalation', 'CRITICAL', 'pass'),
      makeMetric('unsafeFileRefuse', 'CRITICAL', 'pass'),
      makeMetric('promptHashStability', 'WARN', 'pass'),
    ],
    stability: [
      makeMetric('promptHashOverRuns', 'WARN', 'pass'),
      makeMetric('switchActiveAtomic', 'WARN', 'pass'),
      makeMetric('oldDataGraceful', 'WARN', 'pass'),
    ],
  },
  cases: [{
    id: 'q-profile-01',
    group: 'profile',
    question: '本案一审法官？',
    answer: '本案一审法官为张三...'.repeat(50),
    factsHitRate: 1.0,
    mustHaveHits: ['张三'],
    mustHaveMisses: [],
    hallucinationHits: [],
    toolCalls: [],
    tokens: { prompt: 3200 },
    latencyMs: 1200,
    result: 'pass',
  }],
  extractions: [],
  securityAssertions: [],
  errored: [],
}

describe('jsonReporter', () => {
  it('输出完整 JSON 含 cases.answer 全文', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eval-report-'))
    try {
      const path = await writeJsonReport(sampleReport, dir)
      const content = await readFile(path, 'utf-8')
      const parsed = JSON.parse(content)
      expect(parsed.cases[0].answer).toBe(sampleReport.cases[0].answer)
      expect(parsed.summary.overallPass).toBe(false)
      // 验证 25 项指标完整保留
      const totalMetrics =
        parsed.metrics.cost.length +
        parsed.metrics.quality.length +
        parsed.metrics.task.length +
        parsed.metrics.extraction.length +
        parsed.metrics.security.length +
        parsed.metrics.stability.length
      expect(totalMetrics).toBe(25)
    }
    finally {
      await rm(dir, { recursive: true })
    }
  })
})

describe('markdownReporter', () => {
  it('节选 answer 前 200 字 + 不含 emoji', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eval-report-'))
    try {
      const path = await writeMarkdownReport(sampleReport, dir, { excerptAnswers: true, excerptLength: 200 })
      const content = await readFile(path, 'utf-8')
      // 不含 emoji
      expect(content).not.toContain('❌')
      expect(content).not.toContain('✅')
      expect(content).not.toContain('⚠️')
      // 含文字标签
      expect(content).toContain('[FAIL]')
      expect(content).toContain('cacheHitRate')
      // answer 应被节选（原文超过 200 字符）
      expect(content.includes(sampleReport.cases[0].answer)).toBe(false)
    }
    finally {
      await rm(dir, { recursive: true })
    }
  })
})
