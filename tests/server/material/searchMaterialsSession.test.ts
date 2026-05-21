/**
 * searchMaterialsByCaseOrDraftService 会话归属分支测试
 *
 * **Feature: assistant-file-reading**
 */
import { describe, it, expect } from 'vitest'
import { searchMaterialsByCaseOrDraftService } from '~~/server/services/material/materialPipeline.service'

describe('searchMaterialsByCaseOrDraftService（sessionId 归属）', () => {
  it('三个归属维度全空时返回空数组', async () => {
    const r = await searchMaterialsByCaseOrDraftService(
      1,
      { caseId: null, draftId: null, sessionId: null },
      { k: 5 },
    )
    expect(r).toEqual([])
  })

  it('传 sessionId 但会话无材料时返回空数组', async () => {
    const r = await searchMaterialsByCaseOrDraftService(
      1,
      { caseId: null, draftId: null, sessionId: `sess-search-${Date.now()}` },
      { query: '随便搜', k: 5 },
    )
    expect(r).toEqual([])
  })
})
