/**
 * buildContextSegments 模块段单测（真实 DB）
 *
 * 验证 2026-05-06 重写后的"已分析模块"段：
 * - summary 非空：直接显示 summary 摘要
 * - summary 缺失但 analysisResult 非空：降级用 result 前 500 字 + 标识"（暂无独立摘要，正文节选）"
 * - summary 与 analysisResult 都为 null：输出"（暂无内容）"
 * - 段头含 search_case_analysis 工具的 analysis_type 参数提示
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { CaseMaterialType } from '#shared/types/case'
import { MaterialStatus } from '#shared/types/material'
import {
  buildContextSegments,
  buildSystemPromptForAgent,
  toCachedPrompt,
} from '~~/server/services/agent-platform/context/moduleContextBuilder'
import * as memoryService from '~~/server/services/memory/memory.service'
import * as materialPipeline from '~~/server/services/material/materialPipeline.service'

const cleanup = {
  caseIds: [] as number[],
  analysisIds: [] as number[],
  materialIds: [] as number[],
  sessionIds: [] as number[], // caseSessions.id (FK 父表)
  textRecordIds: [] as number[],
  docRecordIds: [] as number[],
  imgRecordIds: [] as number[],
  asrRecordIds: [] as number[],
}

afterEach(async () => {
  if (cleanup.textRecordIds.length) {
    await prisma.textContentRecords.deleteMany({ where: { id: { in: cleanup.textRecordIds } } })
    cleanup.textRecordIds = []
  }
  if (cleanup.docRecordIds.length) {
    await prisma.docRecognitionRecords.deleteMany({ where: { id: { in: cleanup.docRecordIds } } })
    cleanup.docRecordIds = []
  }
  if (cleanup.imgRecordIds.length) {
    await prisma.imageRecognitionRecords.deleteMany({ where: { id: { in: cleanup.imgRecordIds } } })
    cleanup.imgRecordIds = []
  }
  if (cleanup.asrRecordIds.length) {
    await prisma.asrRecords.deleteMany({ where: { id: { in: cleanup.asrRecordIds } } })
    cleanup.asrRecordIds = []
  }
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

async function seedMaterial(caseId: number, fields: { name: string; type: CaseMaterialType; status: MaterialStatus; ossFileId?: number | null; summary?: string | null }) {
  const m = await prisma.caseMaterials.create({
    data: {
      caseId,
      name: fields.name,
      type: fields.type,
      status: fields.status,
      ossFileId: fields.ossFileId ?? null,
    },
  })
  cleanup.materialIds.push(m.id)

  // summary 已在 2026-05-06 从 caseMaterials 迁移到识别记录表，按 type 分发到对应表
  if (fields.summary !== undefined && fields.summary !== null) {
    const caseRow = await prisma.cases.findUnique({ where: { id: caseId }, select: { userId: true } })
    if (!caseRow) throw new Error('seedMaterial: case not found')
    const userId = caseRow.userId
    if (fields.type === CaseMaterialType.CASE_CONTENT) {
      const r = await prisma.textContentRecords.create({
        data: { userId, caseId, materialId: m.id, content: '', summary: fields.summary, status: 2 },
      })
      cleanup.textRecordIds.push(r.id)
    } else if (fields.ossFileId != null) {
      if (fields.type === CaseMaterialType.DOCUMENT) {
        const r = await prisma.docRecognitionRecords.create({
          data: { userId, ossFileId: fields.ossFileId, summary: fields.summary, status: 2 },
        })
        cleanup.docRecordIds.push(r.id)
      } else if (fields.type === CaseMaterialType.IMAGE) {
        const r = await prisma.imageRecognitionRecords.create({
          data: { userId, ossFileId: fields.ossFileId, summary: fields.summary, status: 2 },
        })
        cleanup.imgRecordIds.push(r.id)
      } else if (fields.type === CaseMaterialType.AUDIO) {
        const r = await prisma.asrRecords.create({
          data: { userId, ossFileId: fields.ossFileId, summary: fields.summary, status: 2 },
        })
        cleanup.asrRecordIds.push(r.id)
      }
    }
  }
  return m
}

describe('buildContextSegments - 材料段', () => {
  it('段头含 search_case_materials 工具的 sourceId / query 参数提示', async () => {
    const caseId = await seedCase()
    await seedMaterial(caseId, { name: 'm1', type: CaseMaterialType.CASE_CONTENT, status: MaterialStatus.COMPLETED, summary: 's' })

    const segs = await buildContextSegments({ caseId, agentName: 'caseMain', userQuery: '' })

    expect(segs.dynamicContext).toContain('search_case_materials 工具')
    expect(segs.dynamicContext).toContain('sourceId 填下面括号中的值')
    expect(segs.dynamicContext).toContain('query 填关键词跨材料搜索')
  })

  it('PENDING / PROCESSING / FAILED 状态的材料也展示在清单中（不再被过滤）', async () => {
    const caseId = await seedCase()
    await seedMaterial(caseId, { name: '已识别', type: CaseMaterialType.CASE_CONTENT, status: MaterialStatus.COMPLETED, summary: 'a' })
    await seedMaterial(caseId, { name: '识别中', type: CaseMaterialType.DOCUMENT, status: MaterialStatus.PROCESSING, ossFileId: 9001 })
    await seedMaterial(caseId, { name: '待识别', type: CaseMaterialType.IMAGE, status: MaterialStatus.PENDING, ossFileId: 9002 })
    await seedMaterial(caseId, { name: '识别失败', type: CaseMaterialType.AUDIO, status: MaterialStatus.FAILED, ossFileId: 9003 })

    const segs = await buildContextSegments({ caseId, agentName: 'caseMain', userQuery: '' })

    expect(segs.dynamicContext).toContain('**已识别**')
    expect(segs.dynamicContext).toContain('**识别中**')
    expect(segs.dynamicContext).toContain('**待识别**')
    expect(segs.dynamicContext).toContain('**识别失败**')
    expect(segs.dynamicContext).toContain('— 已识别 — ')
    expect(segs.dynamicContext).toContain('— 识别中 — ')
    expect(segs.dynamicContext).toContain('— 待识别 — ')
    expect(segs.dynamicContext).toContain('— 识别失败 — ')
  })

  it('CASE_CONTENT（文本）：sourceId 用 material.id', async () => {
    const caseId = await seedCase()
    const mat = await seedMaterial(caseId, { name: '文本材料', type: CaseMaterialType.CASE_CONTENT, status: MaterialStatus.COMPLETED, summary: 's' })

    const segs = await buildContextSegments({ caseId, agentName: 'caseMain', userQuery: '' })

    expect(segs.dynamicContext).toContain(`sourceId=${mat.id}`)
  })

  it('DOCUMENT / IMAGE / AUDIO：sourceId 用 ossFileId', async () => {
    const caseId = await seedCase()
    await seedMaterial(caseId, { name: '文档', type: CaseMaterialType.DOCUMENT, status: MaterialStatus.COMPLETED, ossFileId: 7001, summary: 'a' })
    await seedMaterial(caseId, { name: '图片', type: CaseMaterialType.IMAGE, status: MaterialStatus.COMPLETED, ossFileId: 7002, summary: 'b' })
    await seedMaterial(caseId, { name: '音频', type: CaseMaterialType.AUDIO, status: MaterialStatus.COMPLETED, ossFileId: 7003, summary: 'c' })

    const segs = await buildContextSegments({ caseId, agentName: 'caseMain', userQuery: '' })

    expect(segs.dynamicContext).toContain('sourceId=7001')
    expect(segs.dynamicContext).toContain('sourceId=7002')
    expect(segs.dynamicContext).toContain('sourceId=7003')
  })

  it('材料 ossFileId 为 null（异常数据）：sourceId 标"未生成"', async () => {
    const caseId = await seedCase()
    await seedMaterial(caseId, { name: '损坏数据', type: CaseMaterialType.DOCUMENT, status: MaterialStatus.FAILED, ossFileId: null })

    const segs = await buildContextSegments({ caseId, agentName: 'caseMain', userQuery: '' })

    expect(segs.dynamicContext).toContain('sourceId=未生成')
  })

  it('summary 缺失时按 status 降级文字：COMPLETED=摘要生成中 / PROCESSING=识别中 / PENDING=待识别 / FAILED=识别失败', async () => {
    const caseId = await seedCase()
    await seedMaterial(caseId, { name: 'st3', type: CaseMaterialType.CASE_CONTENT, status: MaterialStatus.COMPLETED, summary: null })
    await seedMaterial(caseId, { name: 'st2', type: CaseMaterialType.DOCUMENT, status: MaterialStatus.PROCESSING, ossFileId: 8001 })
    await seedMaterial(caseId, { name: 'st1', type: CaseMaterialType.DOCUMENT, status: MaterialStatus.PENDING, ossFileId: 8002 })
    await seedMaterial(caseId, { name: 'st4', type: CaseMaterialType.DOCUMENT, status: MaterialStatus.FAILED, ossFileId: 8003 })

    const segs = await buildContextSegments({ caseId, agentName: 'caseMain', userQuery: '' })

    expect(segs.dynamicContext).toContain('（摘要生成中）')
    expect(segs.dynamicContext).toContain('（识别中，待识别完成后可查全文）')
    expect(segs.dynamicContext).toContain('（待识别，上传中或排队中）')
    expect(segs.dynamicContext).toContain('（识别失败，可联系客服重新处理）')
  })
})

describe('buildContextSegments - caseId=null 退化路径', () => {
  it('caseId=null：仅返回 roleAndFlow，其余三段为空', async () => {
    const segs = await buildContextSegments({
      caseId: null,
      agentName: 'assistantAgent',
      userQuery: 'hello',
      roleAndFlowTemplate: '我是法律助手',
    })

    expect(segs.roleAndFlow).toBe('我是法律助手')
    expect(segs.caseProfile).toBe('')
    expect(segs.moduleSummaries).toBe('')
    expect(segs.dynamicContext).toBe('')
  })

  it('caseId=null + 无 template：roleAndFlow 也为空字符串', async () => {
    const segs = await buildContextSegments({
      caseId: null,
      agentName: 'assistantAgent',
      userQuery: '',
    })

    expect(segs.roleAndFlow).toBe('')
  })

  it('caseId 存在但 case 找不到（caseRecord 为 null）：四段全空兜底', async () => {
    // 用一个不存在的 caseId（远超已有自增 id 范围）
    const segs = await buildContextSegments({
      caseId: 99_999_999,
      agentName: 'caseMain',
      userQuery: '',
    })

    expect(segs.roleAndFlow).toBe('')
    expect(segs.caseProfile).toBe('')
    expect(segs.moduleSummaries).toBe('')
    expect(segs.dynamicContext).toBe('')
  })

  it('非空 userQuery：以 query 参数调用 recallMemoryService 1 次', async () => {
    const caseId = await seedCase()
    const spy = vi.spyOn(memoryService, 'recallMemoryService').mockResolvedValueOnce([])
    try {
      await buildContextSegments({
        caseId,
        agentName: 'caseMain',
        userQuery: '案件总结',
      })

      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({
        caseId,
        query: '案件总结',
        topK: 5,
      }))
    }
    finally {
      spy.mockRestore()
    }
  })

  it('recallMemoryService 抛错时：catch 兜底返空，不影响其它段', async () => {
    const caseId = await seedCase()
    const spy = vi.spyOn(memoryService, 'recallMemoryService').mockRejectedValueOnce(new Error('boom'))
    try {
      const segs = await buildContextSegments({
        caseId,
        agentName: 'caseMain',
        userQuery: '查询关键词',
      })
      // 抛错走 catch=>[] → 段不会含记忆段头
      expect(segs.dynamicContext).not.toContain('## 相关案件记忆')
      // 案件档案仍正常
      expect(segs.caseProfile).toContain('## 案件档案')
    }
    finally {
      spy.mockRestore()
    }
  })

  it('getMaterialListWithSummariesService 抛错时：catch 兜底返空，材料段不出现', async () => {
    const caseId = await seedCase()
    const spy = vi.spyOn(materialPipeline, 'getMaterialListWithSummariesService').mockRejectedValueOnce(new Error('boom'))
    try {
      const segs = await buildContextSegments({
        caseId,
        agentName: 'caseMain',
        userQuery: '',
      })
      expect(segs.dynamicContext).not.toContain('## 案件材料清单')
      // 案件档案仍正常
      expect(segs.caseProfile).toContain('## 案件档案')
    }
    finally {
      spy.mockRestore()
    }
  })

  it('案件记忆命中时：dynamicContext 含"## 相关案件记忆"段头与命中条目', async () => {
    const caseId = await seedCase()
    const now = new Date().toISOString()
    const spy = vi.spyOn(memoryService, 'recallMemoryService').mockResolvedValueOnce([
      { id: 'mem-a', text: '记忆条目甲', score: 0.9, metadata: { id: 'mem-a', caseId, kind: 'fact', createdAt: now } },
      { id: 'mem-b', text: '记忆条目乙', score: 0.85, metadata: { id: 'mem-b', caseId, kind: 'fact', createdAt: now } },
    ])

    try {
      const segs = await buildContextSegments({
        caseId,
        agentName: 'caseMain',
        userQuery: '查询',
      })

      expect(segs.dynamicContext).toContain('## 相关案件记忆')
      expect(segs.dynamicContext).toContain('记忆条目甲')
      expect(segs.dynamicContext).toContain('记忆条目乙')
    }
    finally {
      spy.mockRestore()
    }
  })
})

describe('toCachedPrompt', () => {
  it('roleAndFlow / caseProfile 标 1h cache，moduleSummaries 标 5m cache，dynamic 不标', () => {
    const cached = toCachedPrompt({
      roleAndFlow: 'role',
      caseProfile: 'profile',
      moduleSummaries: 'modules',
      dynamicContext: 'dyn',
    })

    expect(cached).toEqual([
      { text: 'role', cache: { ttl: '1h' } },
      { text: 'profile', cache: { ttl: '1h' } },
      { text: 'modules', cache: { ttl: '5m' } },
      { text: 'dyn' },
    ])
  })

  it('空段被跳过，不进入 cache prompt', () => {
    const cached = toCachedPrompt({
      roleAndFlow: 'role',
      caseProfile: '',
      moduleSummaries: '',
      dynamicContext: '',
    })

    expect(cached).toEqual([{ text: 'role', cache: { ttl: '1h' } }])
  })
})

describe('buildSystemPromptForAgent', () => {
  it('anthropic SDK：systemMessage.content 是 content blocks 数组（含 cache_control）', async () => {
    const built = await buildSystemPromptForAgent('anthropic', {
      caseId: null,
      agentName: 'assistantAgent',
      userQuery: '',
      roleAndFlowTemplate: '我是法律助手',
    })

    expect(Array.isArray(built.systemMessage.content)).toBe(true)
    const blocks = built.systemMessage.content as Array<Record<string, unknown>>
    expect(blocks[0]).toMatchObject({ type: 'text', text: '我是法律助手' })
    expect(blocks[0]?.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' })
    expect(built.plainText).toBe('我是法律助手')
  })

  it('openai SDK：systemMessage.content 是纯文本字符串', async () => {
    const built = await buildSystemPromptForAgent('openai', {
      caseId: null,
      agentName: 'assistantAgent',
      userQuery: '',
      roleAndFlowTemplate: '我是法律助手',
    })

    expect(typeof built.systemMessage.content).toBe('string')
    expect(built.systemMessage.content).toBe('我是法律助手')
    expect(built.plainText).toBe('我是法律助手')
  })
})
