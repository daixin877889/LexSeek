import { describe, expect, it } from 'vitest'
import type { LCase, LCaseSession } from '../../src/legacyTypes'
import { transformCase, transformCaseSession } from '../../src/transforms/case'

const ts = {
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-02T00:00:00Z'),
  deletedAt: null,
}

describe('transformCase', () => {
  const oldCase = {
    id: 7, title: '案件', content: '内容', userId: 1, caseTypeId: 2,
    plaintiff: null, defendant: null, caseNumber: '(2025)001', status: 1,
    completedAt: null, closedAt: null, ...ts,
  } as unknown as LCase

  it('caseTypeId 经重映射，丢弃 caseNumber/completedAt/closedAt，新增字段填默认', () => {
    const r = transformCase(oldCase, 50)
    expect(r).not.toBeNull()
    expect(r!.caseTypeId).toBe(50)
    expect(r!.isDemo).toBe(false)
    expect(r!.stance).toBe('plaintiff')
    expect(r!.summary).toBeNull()
    expect('caseNumber' in r!).toBe(false)
  })
  it('caseTypeId 重映射失败（传 null）返回 null（由迁移器跳过/兜底）', () => {
    expect(transformCase(oldCase, null)).toBeNull()
  })
})

describe('transformCaseSession', () => {
  it('scope=case、status=2、type=1，userId 取传入的反查值', () => {
    const oldSession = { id: 3, caseId: 7, sessionId: 'sess-1', ...ts } as unknown as LCaseSession
    const r = transformCaseSession(oldSession, 1)
    expect(r.scope).toBe('case')
    expect(r.status).toBe(2)
    expect(r.type).toBe(1)
    expect(r.userId).toBe(1)
    expect(r.caseId).toBe(7)
  })
})
