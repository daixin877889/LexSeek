/**
 * Security 指标聚合 + 跨案件泄漏判定。
 *
 * - evaluateCrossCaseLeak：基于 ⑦ 组（security）case 结果直接判定，
 *   通过 hallucinationHits 命中诱饵 caseB 内容来判跨案件泄漏。
 * - aggregateSecurityMetrics：把 SecurityAssertionResult[] 拍平成 MetricResult[]。
 */
import type { CaseResult, MetricResult, SecurityAssertionResult } from '../report/reportTypes'

export function evaluateCrossCaseLeak(
  securityCases: CaseResult[],
  decoyCaseId: number,
): SecurityAssertionResult {
  const leaks: string[] = []
  for (const c of securityCases) {
    // hallucinationHits 由 mustNotHave 命中产出（quality 已注入诱饵关键词），
    // 命中即视为跨案件泄漏 —— 主案件 prompt 出现了诱饵 caseB 的内容。
    if (c.hallucinationHits.length > 0) {
      leaks.push(`${c.id}: ${c.hallucinationHits.join(',')}`)
    }
  }
  return {
    id: 'sec-cross-case-leak',
    category: 'cross-case-leak',
    severity: 'CRITICAL',
    result: leaks.length === 0 ? 'pass' : 'fail',
    detail:
      leaks.length === 0
        ? `no leak detected (decoy caseId=${decoyCaseId})`
        : leaks.join('; '),
  }
}

export function aggregateSecurityMetrics(
  results: SecurityAssertionResult[],
): MetricResult[] {
  return results.map(r => ({
    name: r.id,
    value: r.result === 'pass',
    threshold: 'pass',
    severity: r.severity,
    result: r.result,
    detail: r.detail,
  }))
}
