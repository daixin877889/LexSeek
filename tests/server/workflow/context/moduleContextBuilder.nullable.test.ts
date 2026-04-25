/**
 * buildContextSegments nullable caseId 测试
 *
 * **Feature: context-segments-rollout Phase 0**
 *
 * 验证 caseId=null 场景：
 * - 不查询任何案件相关数据（cases / caseAnalyses / materials / memory）
 * - 仅返回 roleAndFlow 段（其余段为空字符串）
 * - 用于 assistantAgent 等无案件上下文的通用助手
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCasesFindUnique = vi.fn()
const mockCaseAnalysesFindMany = vi.fn()
const mockGetMaterialList = vi.fn()
const mockRecallMemory = vi.fn()

// Nuxt 自动导入的 prisma 在测试环境用 stubGlobal 兜底
vi.stubGlobal('prisma', {
  cases: { findUnique: (...args: any[]) => mockCasesFindUnique(...args) },
  caseAnalyses: { findMany: (...args: any[]) => mockCaseAnalysesFindMany(...args) },
})

vi.mock('~~/server/services/material/materialPipeline.service', () => ({
  getMaterialListWithSummariesService: (...args: any[]) => mockGetMaterialList(...args),
}))
vi.mock('~~/server/services/memory/memory.service', () => ({
  recallMemoryService: (...args: any[]) => mockRecallMemory(...args),
}))

describe('buildContextSegments - nullable caseId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('caseId=null 不抛错且 caseProfile/moduleSummaries/dynamicContext 为空', async () => {
    const { buildContextSegments } = await import('~~/server/services/workflow/context/moduleContextBuilder')

    const segs = await buildContextSegments({
      caseId: null,
      agentName: 'assistantMain',
      userQuery: '帮我查一下民法典关于违约金的规定',
    })

    expect(segs.roleAndFlow).toBe('')
    expect(segs.caseProfile).toBe('')
    expect(segs.moduleSummaries).toBe('')
    expect(segs.dynamicContext).toBe('')

    // 关键：caseId=null 时不能触发任何案件查询（防止 N+1 / 误命中）
    expect(mockCasesFindUnique).not.toHaveBeenCalled()
    expect(mockCaseAnalysesFindMany).not.toHaveBeenCalled()
    expect(mockGetMaterialList).not.toHaveBeenCalled()
    expect(mockRecallMemory).not.toHaveBeenCalled()
  })

  it('caseId=null 但提供 roleAndFlowTemplate 时仍返回 roleAndFlow 段', async () => {
    const { buildContextSegments } = await import('~~/server/services/workflow/context/moduleContextBuilder')

    const template = '# 角色\n你是一个法律助手，提供专业的法律咨询。'
    const segs = await buildContextSegments({
      caseId: null,
      agentName: 'assistantMain',
      userQuery: 'q',
      roleAndFlowTemplate: template,
    })

    expect(segs.roleAndFlow).toBe(template)
    expect(segs.caseProfile).toBe('')
    expect(segs.moduleSummaries).toBe('')
    expect(segs.dynamicContext).toBe('')
    expect(mockCasesFindUnique).not.toHaveBeenCalled()
  })
})
