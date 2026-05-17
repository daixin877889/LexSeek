import { describe, expect, it } from 'vitest'
import type { LCaseMaterial } from '../../src/legacyTypes'
import { mapCaseMaterial, mapTextContentRecord } from '../../src/transforms/caseMaterial'

const now = new Date('2026-05-17T00:00:00Z')
const baseMat = {
  id: 1, userId: 5, caseId: 7, name: '材料', type: 1, content: '正文',
  ossFileId: null, asrRecordId: null, materialGroup: null,
  keywords: [], summary: '摘要', vectorIds: ['v'], lastEmbeddingAt: now, lastEditAt: null,
  createdAt: now, updatedAt: now, deletedAt: null,
} as unknown as LCaseMaterial

describe('mapCaseMaterial', () => {
  it('新增 isEncrypted=false、status=3、draftId=null；丢弃 content/userId 等', () => {
    const r = mapCaseMaterial(baseMat)
    expect(r.isEncrypted).toBe(false)
    expect(r.status).toBe(3)
    expect(r.draftId).toBeNull()
    expect('content' in r).toBe(false)
    expect('userId' in r).toBe(false)
  })
})

describe('mapTextContentRecord', () => {
  it('type=1 文本材料产出 text_content_records，vectorIds 重置、lastEmbeddingAt 重置', () => {
    const r = mapTextContentRecord(baseMat)
    expect(r).not.toBeNull()
    expect(r!.materialId).toBe(1)
    expect(r!.userId).toBe(5)
    expect(r!.caseId).toBe(7)
    expect(r!.content).toBe('正文')
    expect(r!.vectorIds).toEqual([])
    expect(r!.lastEmbeddingAt).toBeNull()
    expect(r!.status).toBe(2)
  })
  it('非文本材料（type=2）不产出 text_content_records', () => {
    expect(mapTextContentRecord({ ...baseMat, type: 2 } as LCaseMaterial)).toBeNull()
  })
})
