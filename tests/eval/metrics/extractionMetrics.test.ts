import { describe, expect, it } from 'vitest'
import {
  aggregateExtractionMetrics,
  evaluateExtraction,
} from './extractionMetrics'

describe('evaluateExtraction', () => {
  it('全命中 + 无幻觉 → recall=1, precision=1', () => {
    const r = evaluateExtraction(
      [
        {
          subjectKey: 'fact.party.plaintiff_name',
          text: '甲方为天利科技公司',
          confidence: 0.9,
        },
      ],
      {
        expectedExtractions: [
          {
            subjectKey: 'fact.party.plaintiff_name',
            valueKeywords: ['天利', '科技'],
            minConfidence: 0.7,
          },
        ],
        forbiddenExtractions: [],
      },
    )
    expect(r.recall).toBe(1)
    expect(r.precision).toBe(1)
    expect(r.recallHits).toBe(1)
    expect(r.recallMisses).toBe(0)
  })

  it('置信度低于阈值 → 不算命中', () => {
    const r = evaluateExtraction(
      [{ subjectKey: 'fact.x', text: 'x 是 y', confidence: 0.5 }],
      {
        expectedExtractions: [
          {
            subjectKey: 'fact.x',
            valueKeywords: ['x'],
            minConfidence: 0.7,
          },
        ],
        forbiddenExtractions: [],
      },
    )
    expect(r.recall).toBe(0)
    expect(r.recallMisses).toBe(1)
  })

  it('forbiddenExtractions 命中 → precision 下降', () => {
    const r = evaluateExtraction(
      [{ subjectKey: 'fact.bad', text: '不该抽的', confidence: 0.9 }],
      { expectedExtractions: [], forbiddenExtractions: ['fact.bad'] },
    )
    expect(r.precision).toBe(0)
    expect(r.precisionMisses).toBe(1)
  })
})

describe('aggregateExtractionMetrics', () => {
  it('extractionPrecision < 95% → CRITICAL fail', () => {
    const m = aggregateExtractionMetrics([
      {
        transcriptId: 'a',
        recallHits: 5,
        recallMisses: 0,
        precisionMisses: 1,
        totalExtracted: 5,
        recall: 1,
        precision: 0.8,
        detail: '',
      },
    ])
    const p = m.find(x => x.name === 'extractionPrecision')!
    expect(p.severity).toBe('CRITICAL')
    expect(p.result).toBe('fail')
  })
})
