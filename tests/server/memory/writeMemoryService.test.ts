import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { writeMemoryService } from '~~/server/services/memory/memory.service'

describe('writeMemoryService（集成测 · 需测试库）', () => {
  let testCaseId: number
  let testUserId: number
  let testCaseTypeId: number

  beforeEach(async () => {
    // 创建临时测试用户
    const suffix = Date.now().toString().slice(-8)
    const user = await prisma.users.create({
      data: {
        name: `test_memory_user_${suffix}`,
        phone: `199${suffix}`,
        password: 'test_hash',
        status: 1,
      },
    })
    testUserId = user.id

    // 自建 caseType（不依赖 seed，避免被其他测试瞬间清掉）
    const caseType = await prisma.caseTypes.create({
      data: {
        name: `测试类型_memory_${suffix}_${Math.random().toString(36).slice(2, 8)}`,
        priority: 999,
        status: 1,
      },
    })
    testCaseTypeId = caseType.id

    const c = await prisma.cases.create({
      data: { title: 'test case for memory', userId: testUserId, caseTypeId: caseType.id },
    })
    testCaseId = c.id
  })

  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM case_memories WHERE metadata->>'caseId' = $1`,
      testCaseId.toString(),
    )
    await prisma.cases.delete({ where: { id: testCaseId } })
    await prisma.caseTypes.delete({ where: { id: testCaseTypeId } }).catch(() => {})
    await prisma.users.delete({ where: { id: testUserId } })
  })

  it('写入记忆后能查到', async () => {
    const { id } = await writeMemoryService({
      caseId: testCaseId,
      kind: 'fact',
      text: '被告承认 2025-08-14 逾期交货',
      source: 'manual',
    })
    expect(id).toBeTruthy()

    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, text, metadata FROM case_memories WHERE id = $1::uuid`, id,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].text).toBe('被告承认 2025-08-14 逾期交货')
    expect(rows[0].metadata.caseId).toBe(testCaseId)
  })

  it('同 subjectKey 的新记忆触发旧的 invalidatedAt', async () => {
    const { id: oldId } = await writeMemoryService({
      caseId: testCaseId,
      kind: 'fact',
      text: '原告住址：北京',
      subjectKey: 'plaintiff.address',
      source: 'manual',
    })
    const { id: newId } = await writeMemoryService({
      caseId: testCaseId,
      kind: 'fact',
      text: '原告住址：上海（2025-08 变更）',
      subjectKey: 'plaintiff.address',
      source: 'manual',
    })

    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, metadata FROM case_memories
       WHERE metadata->>'caseId' = $1 AND metadata->>'subjectKey' = 'plaintiff.address'
       ORDER BY metadata->>'createdAt' ASC`,
      testCaseId.toString(),
    )
    expect(rows).toHaveLength(2)
    const oldRow = rows.find((r: any) => r.id === oldId)
    const newRow = rows.find((r: any) => r.id === newId)
    expect(oldRow.metadata.invalidatedAt).toBeTruthy()
    expect(newRow.metadata.invalidatedAt).toBeUndefined()
    expect(newRow.metadata.supersedes).toBe(oldId)
  })

  it('tsv 被回填', async () => {
    const { id } = await writeMemoryService({
      caseId: testCaseId,
      kind: 'fact',
      text: '合同约定违约金 10%',
      source: 'manual',
    })
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT tsv IS NOT NULL AS has_tsv FROM case_memories WHERE id = $1::uuid`, id,
    )
    expect(rows[0].has_tsv).toBe(true)
  })
})

describe('updateMemoryService', () => {
  let testCaseId: number
  let testUserId: number
  let testCaseTypeId: number

  beforeEach(async () => {
    const suffix = Date.now().toString().slice(-8)
    const user = await prisma.users.create({
      data: {
        name: `test_memory_user_${suffix}`,
        phone: `199${suffix}`,
        password: 'test_hash',
        status: 1,
      },
    })
    testUserId = user.id

    const caseType = await prisma.caseTypes.create({
      data: {
        name: `测试类型_memory_update_${suffix}_${Math.random().toString(36).slice(2, 8)}`,
        priority: 999,
        status: 1,
      },
    })
    testCaseTypeId = caseType.id

    const c = await prisma.cases.create({
      data: { title: 'test case for update memory', userId: testUserId, caseTypeId: caseType.id },
    })
    testCaseId = c.id
  })

  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM case_memories WHERE metadata->>'caseId' = $1`,
      testCaseId.toString(),
    )
    await prisma.cases.delete({ where: { id: testCaseId } })
    await prisma.caseTypes.delete({ where: { id: testCaseTypeId } }).catch(() => {})
    await prisma.users.delete({ where: { id: testUserId } })
  })

  it('改文本同时同步 tsv', async () => {
    const { updateMemoryService } = await import('~~/server/services/memory/memory.service')
    const { id } = await writeMemoryService({
      caseId: testCaseId,
      kind: 'fact',
      text: '原文本',
      source: 'manual',
    })
    await updateMemoryService(id, { text: '新文本 with 合同' })
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT text, tsv::text AS tsv_text FROM case_memories WHERE id = $1::uuid`,
      id,
    )
    expect(rows[0].text).toBe('新文本 with 合同')
    expect(rows[0].tsv_text).toBeTruthy()
  })

  it('invalidate: true 打失效时间戳', async () => {
    const { updateMemoryService } = await import('~~/server/services/memory/memory.service')
    const { id } = await writeMemoryService({
      caseId: testCaseId,
      kind: 'fact',
      text: 'x',
      source: 'manual',
    })
    await updateMemoryService(id, { invalidate: true })
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT metadata FROM case_memories WHERE id = $1::uuid`,
      id,
    )
    expect(rows[0].metadata.invalidatedAt).toBeTruthy()
  })

  it('指定当前案件时拒绝更新其他案件记忆', async () => {
    const { updateMemoryService } = await import('~~/server/services/memory/memory.service')
    const otherCase = await prisma.cases.create({
      data: { title: 'other case for update memory', userId: testUserId, caseTypeId: testCaseTypeId },
    })

    try {
      const { id } = await writeMemoryService({
        caseId: otherCase.id,
        kind: 'fact',
        text: '其他案件原文本',
        source: 'manual',
      })

      await expect(updateMemoryService(
        id,
        { text: '不应写入' },
        { expectedCaseId: testCaseId, userId: testUserId },
      )).rejects.toThrow('记忆不属于当前案件')

      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT text FROM case_memories WHERE id = $1::uuid`,
        id,
      )
      expect(rows[0].text).toBe('其他案件原文本')
    } finally {
      await prisma.$executeRawUnsafe(
        `DELETE FROM case_memories WHERE metadata->>'caseId' = $1`,
        otherCase.id.toString(),
      )
      await prisma.cases.delete({ where: { id: otherCase.id } }).catch(() => {})
    }
  })

  it('指定当前用户时拒绝更新他人案件记忆', async () => {
    const { updateMemoryService } = await import('~~/server/services/memory/memory.service')
    const suffix = `${Date.now().toString().slice(-8)}_${Math.random().toString(36).slice(2, 6)}`
    const otherUser = await prisma.users.create({
      data: {
        name: `test_memory_other_user_${suffix}`,
        phone: `198${Date.now().toString().slice(-8)}`,
        password: 'test_hash',
        status: 1,
      },
    })
    const otherCase = await prisma.cases.create({
      data: { title: 'other user case for update memory', userId: otherUser.id, caseTypeId: testCaseTypeId },
    })

    try {
      const { id } = await writeMemoryService({
        caseId: otherCase.id,
        kind: 'fact',
        text: '他人案件原文本',
        source: 'manual',
      })

      await expect(updateMemoryService(
        id,
        { invalidate: true },
        { expectedCaseId: otherCase.id, userId: testUserId },
      )).rejects.toThrow('无权访问该案件')

      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT metadata FROM case_memories WHERE id = $1::uuid`,
        id,
      )
      expect(rows[0].metadata.invalidatedAt).toBeUndefined()
    } finally {
      await prisma.$executeRawUnsafe(
        `DELETE FROM case_memories WHERE metadata->>'caseId' = $1`,
        otherCase.id.toString(),
      )
      await prisma.cases.delete({ where: { id: otherCase.id } }).catch(() => {})
      await prisma.users.delete({ where: { id: otherUser.id } }).catch(() => {})
    }
  })
})
