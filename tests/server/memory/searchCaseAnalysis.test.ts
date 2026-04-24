import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('~~/server/services/memory/retrieveWithReranking', () => ({
  retrieveWithReranking: vi.fn().mockResolvedValue([
    { id: 'a1', text: '风险评估结论', score: 0.9, metadata: { caseId: 1, analysisType: 'risk_assessment', isActive: true } },
  ]),
}))

describe('search_case_analysis tool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('默认 filter.isActive=true，不带历史版本', async () => {
    const { createTool } = await import('~~/server/services/workflow/tools/search_case_analysis.tool')
    const { retrieveWithReranking } = await import('~~/server/services/memory/retrieveWithReranking')
    const t = createTool({ caseId: 42, userId: 1, sessionId: 's' })
    await t.invoke({ query: '违约风险', top_k: 5, include_all_versions: false })
    const call = (retrieveWithReranking as any).mock.calls[0][0]
    expect(call.tableName).toBe('case_analysis_embeddings')
    expect(call.metadataFilter).toEqual({ caseId: 42, isActive: true })
  })

  it('analysis_type 过滤特定模块', async () => {
    const { createTool } = await import('~~/server/services/workflow/tools/search_case_analysis.tool')
    const { retrieveWithReranking } = await import('~~/server/services/memory/retrieveWithReranking')
    const t = createTool({ caseId: 42, userId: 1, sessionId: 's' })
    await t.invoke({ query: 'x', analysis_type: 'risk_assessment', top_k: 3 })
    const call = (retrieveWithReranking as any).mock.calls[0][0]
    expect(call.metadataFilter.analysisType).toBe('risk_assessment')
  })

  it('include_all_versions=true 去掉 isActive 过滤', async () => {
    const { createTool } = await import('~~/server/services/workflow/tools/search_case_analysis.tool')
    const { retrieveWithReranking } = await import('~~/server/services/memory/retrieveWithReranking')
    const t = createTool({ caseId: 42, userId: 1, sessionId: 's' })
    await t.invoke({ query: 'x', include_all_versions: true, top_k: 5 })
    const call = (retrieveWithReranking as any).mock.calls[0][0]
    expect(call.metadataFilter.isActive).toBeUndefined()
  })

  it('enableVersionScoring=false（用 isActive 过滤替代版本链降权）', async () => {
    const { createTool } = await import('~~/server/services/workflow/tools/search_case_analysis.tool')
    const { retrieveWithReranking } = await import('~~/server/services/memory/retrieveWithReranking')
    const t = createTool({ caseId: 42, userId: 1, sessionId: 's' })
    await t.invoke({ query: 'x', top_k: 5 })
    const call = (retrieveWithReranking as any).mock.calls[0][0]
    expect(call.enableVersionScoring).toBe(false)
  })
})
