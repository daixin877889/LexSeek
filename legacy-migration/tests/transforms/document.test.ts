import { describe, expect, it } from 'vitest'
import type { LCaseAnalysis } from '../../src/legacyTypes'
import { mapFreeformDraft } from '../../src/transforms/document'

const base = {
  id: 100, caseId: 5, userId: 7, analysisType: 'complaint',
  analysisResult: '# 起诉状\n正文...', title: '第1版', version: 1, isActive: 1,
  createdAt: new Date('2025-03-01T00:00:00Z'),
  updatedAt: new Date('2025-03-02T00:00:00Z'),
  deletedAt: null,
} as unknown as LCaseAnalysis

const MIGRATED_AT = new Date('2026-05-19T00:00:00Z')

describe('mapFreeformDraft', () => {
  it('文书记录映射为自由文书草稿（mode=freeform、无模板、正文存 content）', () => {
    const r = mapFreeformDraft(base, MIGRATED_AT, '起诉状')
    expect(r.mode).toBe('freeform')
    expect(r.templateId).toBeNull()
    expect(r.content).toBe('# 起诉状\n正文...')
    expect(r.sessionId).toBe('legacy-doc-100')
    expect(r.status).toBe('completed')
    expect(r.caseId).toBe(5)
    expect(r.userId).toBe(7)
  })

  it('标题用文书类型中文名（version=1 不带版本后缀）', () => {
    const r = mapFreeformDraft(base, MIGRATED_AT, '起诉状')
    expect(r.title).toBe('起诉状')
  })

  it('多版本时标题带「第N版」后缀', () => {
    const r = mapFreeformDraft({ ...base, version: 3 } as LCaseAnalysis, MIGRATED_AT, '起诉状')
    expect(r.title).toBe('起诉状（第3版）')
  })

  it('metadata 记录 legacy 溯源信息', () => {
    const r = mapFreeformDraft(base, MIGRATED_AT, '起诉状')
    expect(r.metadata).toMatchObject({
      legacy: true,
      legacyAnalysisId: 100,
      legacyAnalysisType: 'complaint',
      legacyVersion: 1,
      legacyIsActive: true,
    })
  })

  it('时间戳兜底：旧 createdAt 为空时回退到 updatedAt', () => {
    const r = mapFreeformDraft({ ...base, createdAt: null } as unknown as LCaseAnalysis, MIGRATED_AT, '起诉状')
    expect(r.createdAt).toEqual(new Date('2025-03-02T00:00:00Z'))
  })
})
