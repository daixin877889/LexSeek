/**
 * search_case_materials 工具会话归属分支测试
 *
 * **Feature: assistant-file-reading**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

;(globalThis as any).logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }

vi.mock('~~/server/services/material/materialPipeline.service', () => ({
  searchMaterialsByCaseOrDraftService: vi.fn(),
}))
vi.mock('~~/server/services/workflow/context/toolResultTruncator', () => ({
  truncateToolResults: (x: unknown) => x,
}))

import { searchMaterialsByCaseOrDraftService } from '~~/server/services/material/materialPipeline.service'
import { createTool } from '~~/server/services/agent-platform/tools/searchCaseMaterials.tool'

describe('search_case_materials —— 会话归属分支', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('无 caseId/draftId 但有 sessionId 时按 sessionId 检索', async () => {
    ;(searchMaterialsByCaseOrDraftService as any).mockResolvedValue([
      { sourceId: 1, content: '命中片段' },
    ])
    const tool = createTool({ userId: 1, sessionId: 'sess-9' } as any)
    await tool.invoke({ query: '合同金额', k: 5 })
    expect(searchMaterialsByCaseOrDraftService).toHaveBeenCalledWith(
      1,
      { caseId: null, draftId: null, sessionId: 'sess-9' },
      { query: '合同金额', sourceId: undefined, k: 5 },
    )
  })

  it('caseId/draftId/sessionId 全缺时报错', async () => {
    const tool = createTool({ userId: 1, sessionId: '' } as any)
    const raw = await tool.invoke({ query: 'x', k: 5 })
    expect(JSON.stringify(raw)).toContain('search_case_materials')
  })
})
