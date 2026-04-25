/**
 * Eval fixture builder 单元测试。
 *
 * 在 ls_eval 库（已 prisma:push + seedData.sql 21 nodes / 7 caseTypes / 17 models）
 * 上构建 fixture，验证：
 *   1. caseA 包含 8 材料 / 15 记忆 / 3 active+historical 分析 / 1 旧分析 / 3 sessions
 *   2. caseB（诱饵）包含 3 材料 / 3 记忆 / 2 分析
 *   3. caseC ARCHIVED status=999
 *   4. caseA 旧分析 summary 为 null
 *   5. 同 seed 产同 memoryIds（确定性）
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { buildFixture } from './buildFixture'

const OWNER_USER_ID = 1

describe('buildFixture', () => {
  beforeAll(() => {
    if (!(process.env.DATABASE_URL ?? '').includes('ls_eval')) {
      throw new Error('buildFixture 测试必须连 ls_eval 库（DATABASE_URL 不含 ls_eval）')
    }
  })

  it('caseA 含 8 材料 / 15 记忆 / 3 active + 3 historical 分析 / 1 旧分析 / 3 sessions', async () => {
    const fx = await buildFixture({ cleanFirst: true, deterministicSeed: 42, ownerUserId: OWNER_USER_ID })

    expect(fx.caseA.materialIds).toHaveLength(8)
    expect(fx.caseA.memoryIds).toHaveLength(15)
    expect(fx.caseA.analysisIds).toHaveLength(3)
    expect(fx.caseA.analysisHistoricalIds).toHaveLength(3)
    expect(fx.caseA.sessions).toHaveLength(3)
    expect(typeof fx.caseA.analysisLegacyId).toBe('number')

    // DB 实际行数与返回 id 一致
    const matCount = await prisma.caseMaterials.count({ where: { caseId: fx.caseA.id } })
    expect(matCount).toBe(8)

    // 记忆通过 raw SQL 计数（避免 Unsupported 列拉全字段）
    const memRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM case_memories WHERE metadata->>'caseId' = $1`,
      String(fx.caseA.id),
    )
    expect(Number(memRows[0]!.count)).toBe(15)

    // 3 active + 3 historical + 1 legacy = 7 条
    const anaCount = await prisma.caseAnalyses.count({ where: { caseId: fx.caseA.id } })
    expect(anaCount).toBe(7)

    const sessCount = await prisma.caseSessions.count({ where: { caseId: fx.caseA.id } })
    expect(sessCount).toBe(3)
  })

  it('caseB 诱饵 3 材料 / 3 记忆 / 2 分析', async () => {
    const fx = await buildFixture({ cleanFirst: true, deterministicSeed: 42, ownerUserId: OWNER_USER_ID })

    expect(fx.caseB.materialIds).toHaveLength(3)
    expect(fx.caseB.memoryIds).toHaveLength(3)
    expect(fx.caseB.analysisIds).toHaveLength(2)

    const matCount = await prisma.caseMaterials.count({ where: { caseId: fx.caseB.id } })
    expect(matCount).toBe(3)

    const anaCount = await prisma.caseAnalyses.count({ where: { caseId: fx.caseB.id } })
    expect(anaCount).toBe(2)
  })

  it('caseC ARCHIVED status=999', async () => {
    const fx = await buildFixture({ cleanFirst: true, deterministicSeed: 42, ownerUserId: OWNER_USER_ID })

    const c = await prisma.cases.findUniqueOrThrow({ where: { id: fx.caseC.id } })
    expect(c.status).toBe(999)
    expect(typeof fx.caseC.materialId).toBe('number')
    expect(typeof fx.caseC.memoryId).toBe('string')
  })

  it('caseA 旧分析 summary 为 null', async () => {
    const fx = await buildFixture({ cleanFirst: true, deterministicSeed: 42, ownerUserId: OWNER_USER_ID })

    const legacy = await prisma.caseAnalyses.findUniqueOrThrow({ where: { id: fx.caseA.analysisLegacyId } })
    expect(legacy.summary).toBeNull()
    expect(legacy.analysisType).toBe('legacy_analysis')
  })

  it('同 seed 产同 memoryIds（确定性）', async () => {
    const fx1 = await buildFixture({ cleanFirst: true, deterministicSeed: 42, ownerUserId: OWNER_USER_ID })
    const ids1 = [...fx1.caseA.memoryIds]
    const fx2 = await buildFixture({ cleanFirst: true, deterministicSeed: 42, ownerUserId: OWNER_USER_ID })
    expect(fx2.caseA.memoryIds).toEqual(ids1)
  })
})
