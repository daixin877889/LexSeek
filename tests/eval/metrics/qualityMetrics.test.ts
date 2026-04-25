// tests/eval/metrics/qualityMetrics.test.ts
import { describe, expect, it } from 'vitest'
import type { CaseResult } from '../report/reportTypes'
import { aggregateQualityMetrics, evaluateFactsCase } from './qualityMetrics'

describe('evaluateFactsCase', () => {
  it('全命中 → factsHitRate=1.0，无幻觉', () => {
    const r = evaluateFactsCase({
      answer: '本案一审法官是张三，案号 (2024)粤0103民初1234号',
      mustHave: ['张三', '(2024)粤0103民初1234号'],
      mustNotHave: ['李四'],
    })
    expect(r.factsHitRate).toBe(1.0)
    expect(r.hallucinationHits).toEqual([])
  })

  it('部分命中 + 幻觉', () => {
    const r = evaluateFactsCase({
      answer: '法官是李四',
      mustHave: ['张三'],
      mustNotHave: ['李四'],
    })
    expect(r.factsHitRate).toBe(0)
    expect(r.hallucinationHits).toEqual(['李四'])
  })

  it('normalization 处理空格 / 全半角', () => {
    const r = evaluateFactsCase({
      answer: '  张  三  ',
      mustHave: ['张三'],
    })
    expect(r.factsHitRate).toBe(1)
  })
})

describe('aggregateQualityMetrics', () => {
  it('hallucinationRate 超过 5% → CRITICAL fail', () => {
    const cases: CaseResult[] = [
      {
        id: 'a',
        group: 'profile',
        question: 'q',
        answer: '',
        mustHaveHits: [],
        mustHaveMisses: [],
        hallucinationHits: ['x'],
        toolCalls: [],
        tokens: {},
        latencyMs: 0,
        result: 'fail',
        factsHitRate: 0,
      },
      ...Array.from(
        { length: 9 },
        (_, i): CaseResult => ({
          id: String(i),
          group: 'profile',
          question: 'q',
          answer: '',
          mustHaveHits: [],
          mustHaveMisses: [],
          hallucinationHits: [],
          toolCalls: [],
          tokens: {},
          latencyMs: 0,
          result: 'pass',
          factsHitRate: 1,
        }),
      ),
    ]
    const metrics = aggregateQualityMetrics(cases)
    const h = metrics.find(m => m.name === 'hallucinationRate')!
    expect(h.severity).toBe('CRITICAL')
    expect(h.result).toBe('fail')
  })
})
