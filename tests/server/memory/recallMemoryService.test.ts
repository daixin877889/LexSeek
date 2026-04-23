import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { writeMemoryService } from '~~/server/services/memory/memory.service'

// Mock reranker 服务（避免依赖真实 bge-reranker 服务）
vi.mock('~~/server/services/memory/rerankerClient', () => ({
  rerankDocuments: vi.fn((_q, docs) =>
    Promise.resolve(docs.map((d: any, i: number) => ({ id: d.id, score: 1 - i * 0.01 }))),
  ),
}))

describe('recallMemoryService（集成测）', () => {
  let caseId: number

  beforeEach(async () => {
    // ⚠️ 测试库 caseTypeId/userId 从 1000+ 开始，必须动态查询
    const caseType = await prisma.caseTypes.findFirst()
    const user = await prisma.users.findFirst()
    const c = await prisma.cases.create({
      data: { title: 'recall-test', userId: user!.id, caseTypeId: caseType!.id },
    })
    caseId = c.id
  })

  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM case_memories WHERE metadata->>'caseId' = $1`,
      caseId.toString(),
    )
    await prisma.cases.delete({ where: { id: caseId } })
    vi.clearAllMocks()
  })

  it('按 query 语义召回（至少返回匹配记忆）', async () => {
    await writeMemoryService({ caseId, kind: 'fact', text: '合同约定 6 月前交付违约金 10%', source: 'manual' })
    await writeMemoryService({ caseId, kind: 'fact', text: '原告住址在北京朝阳', source: 'manual' })

    const { recallMemoryService } = await import('~~/server/services/memory/memory.service')
    const hits = await recallMemoryService({ caseId, query: '违约金' })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.text).toContain('违约金')
  })

  it('caseId 硬过滤：不跨案件', async () => {
    const caseType = await prisma.caseTypes.findFirst()
    const user = await prisma.users.findFirst()
    const otherCase = await prisma.cases.create({
      data: { title: 'other-recall', userId: user!.id, caseTypeId: caseType!.id },
    })
    await writeMemoryService({ caseId, kind: 'fact', text: 'case A memory', source: 'manual' })
    await writeMemoryService({ caseId: otherCase.id, kind: 'fact', text: 'case B memory', source: 'manual' })

    const { recallMemoryService } = await import('~~/server/services/memory/memory.service')
    const hits = await recallMemoryService({ caseId, query: 'memory' })
    expect(hits.every((h) => h.metadata.caseId === caseId)).toBe(true)

    // 清理 otherCase
    await prisma.$executeRawUnsafe(
      `DELETE FROM case_memories WHERE metadata->>'caseId' = $1`,
      otherCase.id.toString(),
    )
    await prisma.cases.delete({ where: { id: otherCase.id } })
  })

  it('includeInvalidated=false（默认）过滤失效记忆', async () => {
    const { id } = await writeMemoryService({
      caseId, kind: 'fact', text: '旧事实', subjectKey: 's1', source: 'manual',
    })
    // 写入新版本会自动 invalidate 旧版本
    await writeMemoryService({
      caseId, kind: 'fact', text: '新事实', subjectKey: 's1', source: 'manual',
    })

    const { recallMemoryService } = await import('~~/server/services/memory/memory.service')
    const hits = await recallMemoryService({ caseId, query: '事实' })
    expect(hits.every((h) => h.id !== id)).toBe(true)
  })

  it('includeInvalidated=true 时能看到失效的', async () => {
    await writeMemoryService({ caseId, kind: 'fact', text: '旧', subjectKey: 's2', source: 'manual' })
    await writeMemoryService({ caseId, kind: 'fact', text: '新', subjectKey: 's2', source: 'manual' })

    const { recallMemoryService } = await import('~~/server/services/memory/memory.service')
    const hitsAll = await recallMemoryService({
      caseId, query: '新或旧', includeInvalidated: true,
    })
    expect(hitsAll.length).toBeGreaterThanOrEqual(2)
  })
})
