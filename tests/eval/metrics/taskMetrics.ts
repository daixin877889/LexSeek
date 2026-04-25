import type { CaseResult, MetricResult } from '../report/reportTypes'

export function aggregateTaskMetrics(cases: CaseResult[]): MetricResult[] {
  const withExpected = cases.filter(c => c.expectedTools && c.expectedTools.length > 0)
  let hits = 0
  for (const c of withExpected) {
    const allCalled = c.expectedTools!.every(t => c.toolCalls.includes(t))
    if (allCalled) hits++
  }
  const acc = withExpected.length === 0 ? 1 : hits / withExpected.length

  const passCount = cases.filter(c => c.result === 'pass').length
  const passRate = cases.length === 0 ? 1 : passCount / cases.length

  return [
    {
      name: 'toolCallAccuracy',
      value: round(acc, 4),
      threshold: '>= 0.8',
      severity: 'CRITICAL',
      result: acc >= 0.8 ? 'pass' : 'fail',
      detail: `${hits}/${withExpected.length}`,
    },
    {
      name: 'scenarioPassRate',
      value: round(passRate, 4),
      threshold: '>= 0.9',
      severity: 'CRITICAL',
      result: passRate >= 0.9 ? 'pass' : 'fail',
      detail: `${passCount}/${cases.length}`,
    },
  ]
}

function round(v: number, decimals = 0): number {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}
