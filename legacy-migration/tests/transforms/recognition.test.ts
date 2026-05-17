import { describe, expect, it } from 'vitest'
import type { LAsrRecord, LDocRecognition } from '../../src/legacyTypes'
import { transformAsrRecord, transformDocRecognition } from '../../src/transforms/recognition'

const now = new Date('2026-05-17T00:00:00Z')

describe('transformAsrRecord', () => {
  it('vectorIds 重置为 []、lastEmbeddingAt 重置为 null、新增 tempFilePath=null', () => {
    const o = {
      id: 1, userId: 1, ossFileId: 2, asrTasksId: null, status: 2,
      audioUrl: 'url', audioDuration: 60, result: {}, jsonOssFileId: null,
      speakers: [], keywords: ['k'], summary: 's', vectorIds: ['v1', 'v2'],
      lastEmbeddingAt: now, lastEditAt: null, createdAt: null, updatedAt: null, deletedAt: null,
    } as unknown as LAsrRecord
    const r = transformAsrRecord(o, now)
    expect(r.vectorIds).toEqual([])
    expect(r.lastEmbeddingAt).toBeNull()
    expect(r.tempFilePath).toBeNull()
    expect(r.createdAt).toEqual(now)
  })
})

describe('transformDocRecognition', () => {
  it('createdAt 为 null 兜底迁移时刻，vectorIds 重置', () => {
    const o = {
      id: 1, userId: 1, ossFileId: 2, status: 2, htmlContent: null, markdownContent: null,
      keywords: [], summary: null, vectorIds: ['v'], lastEmbeddingAt: now, lastEditAt: null,
      createdAt: null, updatedAt: null, deletedAt: null,
    } as unknown as LDocRecognition
    const r = transformDocRecognition(o, now)
    expect(r.vectorIds).toEqual([])
    expect(r.lastEmbeddingAt).toBeNull()
    expect(r.createdAt).toEqual(now)
  })
})
