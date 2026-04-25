import { describe, it, expect } from 'vitest'
import { aggregateTaskMetrics } from './taskMetrics'
import type { CaseResult } from '../report/reportTypes'

const mkCase = (over: Partial<CaseResult>): CaseResult => ({
  id: 'x',
  group: 'memory',
  question: 'q',
  answer: 'a',
  mustHaveHits: [],
  mustHaveMisses: [],
  hallucinationHits: [],
  toolCalls: [],
  tokens: {},
  latencyMs: 0,
  result: 'pass',
  ...over,
})

describe('aggregateTaskMetrics', () => {
  it('toolCallAccuracy 80% → CRITICAL pass', () => {
    const cases: CaseResult[] = [
      mkCase({ id: '1', expectedTools: ['search_case_memory'], toolCalls: ['search_case_memory'] }),
      mkCase({ id: '2', expectedTools: ['search_case_memory'], toolCalls: ['search_case_memory'] }),
      mkCase({ id: '3', expectedTools: ['search_case_memory'], toolCalls: ['search_case_memory'] }),
      mkCase({ id: '4', expectedTools: ['search_case_memory'], toolCalls: ['search_case_memory'] }),
      mkCase({ id: '5', expectedTools: ['search_case_memory'], toolCalls: [] }),
    ]
    const m = aggregateTaskMetrics(cases)
    const acc = m.find(x => x.name === 'toolCallAccuracy')!
    expect(acc.value).toBeCloseTo(0.8, 4)
    expect(acc.severity).toBe('CRITICAL')
    expect(acc.result).toBe('pass')
  })

  it('toolCallAccuracy 低于 80% → CRITICAL fail', () => {
    const cases: CaseResult[] = [
      mkCase({ id: '1', expectedTools: ['t1'], toolCalls: ['t1'] }),
      mkCase({ id: '2', expectedTools: ['t1'], toolCalls: [] }),
      mkCase({ id: '3', expectedTools: ['t1'], toolCalls: [] }),
    ]
    const m = aggregateTaskMetrics(cases)
    const acc = m.find(x => x.name === 'toolCallAccuracy')!
    expect(acc.result).toBe('fail')
    expect(acc.severity).toBe('CRITICAL')
  })

  it('scenarioPassRate 90% → CRITICAL pass', () => {
    const cases: CaseResult[] = [
      ...Array.from({ length: 9 }, (_, i) => mkCase({ id: `p${i}`, result: 'pass' })),
      mkCase({ id: 'f1', result: 'fail' }),
    ]
    const m = aggregateTaskMetrics(cases)
    const pr = m.find(x => x.name === 'scenarioPassRate')!
    expect(pr.value).toBeCloseTo(0.9, 4)
    expect(pr.severity).toBe('CRITICAL')
    expect(pr.result).toBe('pass')
  })

  it('scenarioPassRate 低于 90% → CRITICAL fail', () => {
    const cases: CaseResult[] = [
      ...Array.from({ length: 8 }, (_, i) => mkCase({ id: `p${i}`, result: 'pass' })),
      mkCase({ id: 'f1', result: 'fail' }),
      mkCase({ id: 'f2', result: 'fail' }),
    ]
    const m = aggregateTaskMetrics(cases)
    const pr = m.find(x => x.name === 'scenarioPassRate')!
    expect(pr.result).toBe('fail')
  })

  it('空数组 → 默认 1 pass', () => {
    const m = aggregateTaskMetrics([])
    expect(m.find(x => x.name === 'toolCallAccuracy')!.value).toBe(1)
    expect(m.find(x => x.name === 'scenarioPassRate')!.value).toBe(1)
  })

  it('expectedTools 多工具：必须全部命中才计 hit', () => {
    const cases: CaseResult[] = [
      mkCase({ id: '1', expectedTools: ['a', 'b'], toolCalls: ['a', 'b'] }),
      mkCase({ id: '2', expectedTools: ['a', 'b'], toolCalls: ['a'] }),
    ]
    const m = aggregateTaskMetrics(cases)
    const acc = m.find(x => x.name === 'toolCallAccuracy')!
    expect(acc.value).toBeCloseTo(0.5, 4)
    expect(acc.detail).toBe('1/2')
  })
})
