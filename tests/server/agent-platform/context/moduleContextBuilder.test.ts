/**
 * buildContextSegments 模块段单测（真实 DB）
 *
 * 验证 2026-05-06 重写后的"已分析模块"段：
 * - summary 非空：直接显示 summary 摘要
 * - summary 缺失但 analysisResult 非空：降级用 result 前 500 字 + 标识"（暂无独立摘要，正文节选）"
 * - summary 与 analysisResult 都为 null：输出"（暂无内容）"
 * - 段头含 search_case_analysis 工具的 analysis_type 参数提示
 */
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { buildContextSegments } from '~~/server/services/agent-platform/context/moduleContextBuilder'

const cleanup = {
  caseIds: [] as number[],
  analysisIds: [] as number[],
  materialIds: [] as number[],
  sessionIds: [] as number[], // caseSessions.id (FK 父表)
}

afterEach(async () => {
  if (cleanup.materialIds.length) {
    await prisma.caseMaterials.deleteMany({ where: { id: { in: cleanup.materialIds } } })
    cleanup.materialIds = []
  }
  if (cleanup.analysisIds.length) {
    await prisma.caseAnalyses.deleteMany({ where: { id: { in: cleanup.analysisIds } } })
    cleanup.analysisIds = []
  }
  if (cleanup.sessionIds.length) {
    await prisma.caseSessions.deleteMany({ where: { id: { in: cleanup.sessionIds } } })
    cleanup.sessionIds = []
  }
  if (cleanup.caseIds.length) {
    await prisma.cases.deleteMany({ where: { id: { in: cleanup.caseIds } } })
    cleanup.caseIds = []
  }
})

async function seedCase(): Promise<number> {
  // 测试库 userId/caseTypeId 自增 id 从 1000+ 起，必须从已存在的种子记录动态取
  const user = await prisma.users.findFirst()
  const caseType = await prisma.caseTypes.findFirst()
  if (!user || !caseType) throw new Error('seed missing')
  const c = await prisma.cases.create({
    data: {
      userId: user.id,
      caseTypeId: caseType.id,
      title: 'ctx-test-case',
      status: 1,
    },
  })
  cleanup.caseIds.push(c.id)
  return c.id
}

async function seedAnalysis(caseId: number, fields: { analysisType: string, version: number, summary?: string | null, analysisResult?: string | null, updatedAt?: Date }) {
  // caseAnalyses.sessionId → caseSessions.sessionId（FK），必须先建会话
  // nodeId → nodes.id（FK），从已有种子节点取
  const sessionToken = `ana-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const node = await prisma.nodes.findFirst()
  if (!node) throw new Error('seed missing: nodes')
  const session = await prisma.caseSessions.create({
    data: {
      sessionId: sessionToken,
      caseId,
      scope: 'case',
      status: 1,
    },
  })
  cleanup.sessionIds.push(session.id)
  const a = await prisma.caseAnalyses.create({
    data: {
      caseId,
      sessionId: sessionToken,
      nodeId: node.id,
      analysisType: fields.analysisType,
      analysisResult: fields.analysisResult ?? null,
      summary: fields.summary ?? null,
      version: fields.version,
      status: 2,
      isActive: true,
      updatedAt: fields.updatedAt ?? new Date('2026-05-04T14:32:18Z'),
    },
  })
  cleanup.analysisIds.push(a.id)
  return a
}

describe('buildContextSegments - 模块段', () => {
  it('summary 非空：直接显示 summary 摘要', async () => {
    const caseId = await seedCase()
    await seedAnalysis(caseId, {
      analysisType: 'case_summary',
      version: 2,
      summary: '案件核心要点摘要 200 字',
      updatedAt: new Date('2026-05-04T14:32:18Z'),
    })

    const segs = await buildContextSegments({ caseId, agentName: 'caseMain', userQuery: '' })

    expect(segs.moduleSummaries).toContain('### case_summary（v2，更新于 ')
    expect(segs.moduleSummaries).toMatch(/### case_summary（v2，更新于 \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}）/)
    expect(segs.moduleSummaries).toContain('案件核心要点摘要 200 字')
    expect(segs.moduleSummaries).not.toContain('（暂无独立摘要')
  })

  it('summary 缺失但 analysisResult 非空：降级用 result 前 500 字 + 标识"（暂无独立摘要，正文节选）"', async () => {
    const caseId = await seedCase()
    const longResult = '这是一段很长的正文'.repeat(100) // 远超 500 字
    await seedAnalysis(caseId, {
      analysisType: 'chronicle',
      version: 1,
      summary: null,
      analysisResult: longResult,
    })

    const segs = await buildContextSegments({ caseId, agentName: 'caseMain', userQuery: '' })

    expect(segs.moduleSummaries).toContain('### chronicle（v1，更新于 ')
    expect(segs.moduleSummaries).toMatch(/### chronicle（v1，更新于 \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}）/)
    expect(segs.moduleSummaries).toContain('（暂无独立摘要，正文节选）')
    expect(segs.moduleSummaries).toContain('...') // 截断标识
    // 截断到 500 字 + "..."（longResult 900 字 > 500，必发生截断，长度精确到 500）
    const idx = segs.moduleSummaries.indexOf('（暂无独立摘要，正文节选）\n')
    const tail = segs.moduleSummaries.slice(idx + '（暂无独立摘要，正文节选）\n'.length)
    const excerptOnly = tail.split('\n\n')[0]?.replace(/\.\.\.$/, '') ?? ''
    expect(excerptOnly.length).toBe(500)
  })

  it('summary 与 analysisResult 都为 null：输出"（暂无内容）"', async () => {
    const caseId = await seedCase()
    await seedAnalysis(caseId, {
      analysisType: 'cause',
      version: 1,
      summary: null,
      analysisResult: null,
    })

    const segs = await buildContextSegments({ caseId, agentName: 'caseMain', userQuery: '' })

    expect(segs.moduleSummaries).toContain('### cause（v1，更新于 ')
    expect(segs.moduleSummaries).toMatch(/### cause（v1，更新于 \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}）/)
    expect(segs.moduleSummaries).toContain('（暂无内容）')
  })

  it('段头含 search_case_analysis 工具的 analysis_type 参数提示', async () => {
    const caseId = await seedCase()
    await seedAnalysis(caseId, { analysisType: 'evidence', version: 1, summary: 'x' })

    const segs = await buildContextSegments({ caseId, agentName: 'caseMain', userQuery: '' })

    expect(segs.moduleSummaries).toContain('search_case_analysis 工具')
    expect(segs.moduleSummaries).toContain('analysis_type 填模块名')
  })
})
