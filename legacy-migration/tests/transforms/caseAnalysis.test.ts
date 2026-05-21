import { describe, expect, it } from 'vitest'
import type { LCaseAnalysis } from '../../src/legacyTypes'
import { mapCaseAnalysis } from '../../src/transforms/caseAnalysis'

const now = new Date('2026-05-17T00:00:00Z')
const base = {
  id: 1, caseId: 7, analysisType: 'case_summary', analysisProcess: 'p',
  analysisResult: '结果', isActive: 1, generationType: 1, userId: 5, version: 2,
  sessionId: 'sess-1', title: 't', usageToken: 1500, messageId: 'm',
  keywords: [], summary: '摘要', vectorIds: ['v'], lastEmbeddingAt: now,
  status: 0, startedAt: now, completedAt: now, createdAt: null, updatedAt: null, deletedAt: null,
} as unknown as LCaseAnalysis

describe('mapCaseAnalysis', () => {
  it('isActive Int→Boolean，status 0→1，pointDeducted=true，tokens=usageToken', () => {
    const r = mapCaseAnalysis(base, 12, 'sess-1', now)
    expect(r.nodeId).toBe(12)
    expect(r.sessionId).toBe('sess-1')
    expect(r.isActive).toBe(true)
    expect(r.status).toBe(1)
    expect(r.pointDeducted).toBe(true)
    expect(r.tokens).toBe(1500)
    expect(r.tokenCount).toBeNull()
    expect(r.originalResult).toBeNull()
    expect(r.createdAt).toEqual(now)
    expect('analysisProcess' in r).toBe(false)
  })
  it('status 映射：旧 2→新 2、旧 3→新 3', () => {
    expect(mapCaseAnalysis({ ...base, status: 2 } as LCaseAnalysis, 12, 's', now).status).toBe(2)
    expect(mapCaseAnalysis({ ...base, status: 3 } as LCaseAnalysis, 12, 's', now).status).toBe(3)
  })
})
