import { describe, it, expect } from 'vitest'
import { recencyDecay, subjectVersionScoring } from '~~/server/services/memory/postProcess'
import type { MemoryHit } from '#shared/types/memory'

describe('recencyDecay', () => {
  it('刚创建返回接近 1', () => {
    expect(recencyDecay(new Date().toISOString(), 30)).toBeGreaterThan(0.99)
  })
  it('30 天后约 0.5（半衰期）', () => {
    const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    expect(recencyDecay(past, 30)).toBeGreaterThan(0.45)
    expect(recencyDecay(past, 30)).toBeLessThan(0.55)
  })
})

describe('subjectVersionScoring', () => {
  it('同 subjectKey 旧版降权 ×0.3', () => {
    const hits: MemoryHit[] = [
      { id: '1', text: 'old', score: 0.9, metadata: { id: '1', caseId: 1, kind: 'fact', subjectKey: 'x', createdAt: '2025-01-01T00:00:00Z' } },
      { id: '2', text: 'new', score: 0.85, metadata: { id: '2', caseId: 1, kind: 'fact', subjectKey: 'x', createdAt: '2025-08-01T00:00:00Z' } },
    ]
    const scored = subjectVersionScoring(hits)
    const oldHit = scored.find((h) => h.id === '1')!
    const newHit = scored.find((h) => h.id === '2')!
    expect(newHit.score).toBeGreaterThan(oldHit.score)
  })

  it('失效的 score 置 0', () => {
    const hits: MemoryHit[] = [
      { id: '1', text: 'x', score: 0.9, metadata: { id: '1', caseId: 1, kind: 'fact', invalidatedAt: '2025-08-01T00:00:00Z', createdAt: '2025-01-01T00:00:00Z' } },
    ]
    const scored = subjectVersionScoring(hits)
    expect(scored[0]!.score).toBe(0)
  })
})
