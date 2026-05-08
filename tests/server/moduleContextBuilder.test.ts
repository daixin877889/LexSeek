import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCasesFindUnique = vi.fn()
const mockCaseAnalysesFindMany = vi.fn()

// Mock Nuxt auto-imported prisma global
vi.stubGlobal('prisma', {
  cases: { findUnique: (...args: any[]) => mockCasesFindUnique(...args) },
  caseAnalyses: { findMany: (...args: any[]) => mockCaseAnalysesFindMany(...args) },
})

vi.mock('~~/server/utils/db', () => ({
  prisma: {
    cases: { findUnique: (...args: any[]) => mockCasesFindUnique(...args) },
    caseAnalyses: { findMany: (...args: any[]) => mockCaseAnalysesFindMany(...args) },
  },
}))
vi.mock('~~/server/services/material/materialPipeline.service', () => ({
  getMaterialListWithSummariesService: vi.fn().mockResolvedValue([
    { name: '合同', type: 2, summary: '约定 6 月前交付' },
  ]),
}))
vi.mock('~~/server/services/memory/memory.service', () => ({
  recallMemoryService: vi.fn().mockResolvedValue([
    { id: 'm1', text: '被告承认逾期', score: 0.9, metadata: {} },
  ]),
}))

describe('buildContextSegments', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('输出 4 段（角色/档案/摘要/动态），顺序正确', async () => {
    mockCasesFindUnique.mockResolvedValue({
      id: 1, title: '张李纠纷', courtName: '朝阳法院',
      plaintiff: ['张三'], defendant: ['李四'],
      summary: '房屋租赁纠纷', status: 3,
    })
    mockCaseAnalysesFindMany.mockResolvedValue([
      { analysisType: 'claim_analysis', summary: '原告主张租金+违约金，证据链完整' },
    ])

    const { buildContextSegments } = await import('~~/server/services/workflow/context/moduleContextBuilder')
    const segs = await buildContextSegments({
      caseId: 1,
      agentName: 'risk_assessment',
      userQuery: '这个案件违约风险如何',
    })

    expect(segs.roleAndFlow).toBeDefined()
    expect(segs.caseProfile).toContain('朝阳法院')
    expect(segs.caseProfile).toContain('张李纠纷')
    expect(segs.moduleSummaries).toContain('claim_analysis')
    expect(segs.moduleSummaries).toContain('原告主张租金+违约金')
    expect(segs.moduleSummaries).toContain('search_case_analysis')
    expect(segs.dynamicContext).toContain('被告承认逾期')
  })

  it('无 summary 的旧版本条目被跳过', async () => {
    mockCasesFindUnique.mockResolvedValue({
      id: 1, title: 'x', courtName: 'y', summary: 'z', status: 1,
      plaintiff: ['a'], defendant: ['b'],
    })
    mockCaseAnalysesFindMany.mockResolvedValue([
      { analysisType: 'legacy_no_summary', summary: null },
    ])
    const { buildContextSegments } = await import('~~/server/services/workflow/context/moduleContextBuilder')
    const segs = await buildContextSegments({ caseId: 1, agentName: 'x', userQuery: 'q' })
    expect(segs.moduleSummaries).toBe('')
  })

  it('caseProfile JSON 字段字典序稳定', async () => {
    mockCasesFindUnique.mockResolvedValue({
      id: 1, title: 'x', courtName: 'y', summary: 'z', status: 1,
      plaintiff: ['a'], defendant: ['b'],
    })
    mockCaseAnalysesFindMany.mockResolvedValue([])
    const { buildContextSegments } = await import('~~/server/services/workflow/context/moduleContextBuilder')
    const s1 = await buildContextSegments({ caseId: 1, agentName: 'x', userQuery: 'q' })
    const s2 = await buildContextSegments({ caseId: 1, agentName: 'x', userQuery: 'q' })
    expect(s1.caseProfile).toBe(s2.caseProfile)
  })

  it('无分析产物时 moduleSummaries 为空串', async () => {
    mockCasesFindUnique.mockResolvedValue({ id: 1, title: 'x' })
    mockCaseAnalysesFindMany.mockResolvedValue([])
    const { buildContextSegments } = await import('~~/server/services/workflow/context/moduleContextBuilder')
    const segs = await buildContextSegments({ caseId: 1, agentName: 'x', userQuery: 'q' })
    expect(segs.moduleSummaries).toBe('')
  })
})
