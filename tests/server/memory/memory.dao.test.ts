/**
 * memory.dao 测试
 *
 * **Feature: case-memory-extension**
 * **Validates: spec §3.1 软去重 DAO**
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { findActiveMemoryBySubjectDAO, listMemoriesDAO, softDeleteMemoryDAO } from '~~/server/services/memory/memory.dao'
import { writeMemoryService } from '~~/server/services/memory/memory.service'
import { ensureTestUser, ensureTestCase, cleanupTestData } from '../assistant/test-db-helper'

describe('findActiveMemoryBySubjectDAO', () => {
  let userId: number
  let caseId: number

  beforeEach(async () => {
    userId = await ensureTestUser()
    caseId = await ensureTestCase(userId)
  })

  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM case_memories WHERE metadata->>'caseId' = $1`,
      String(caseId),
    )
    await cleanupTestData()
  })

  it('返回同 subjectKey 最新未失效记录', async () => {
    await writeMemoryService({
      caseId,
      kind: 'fact',
      text: '原告住北京',
      subjectKey: 'plaintiff.address',
      source: 'manual',
    })
    const found = await findActiveMemoryBySubjectDAO(caseId, 'plaintiff.address')
    expect(found?.text).toBe('原告住北京')
  })

  it('subjectKey 不存在返回 null', async () => {
    const found = await findActiveMemoryBySubjectDAO(caseId, 'nonexistent.key')
    expect(found).toBeNull()
  })

  it('已失效记录不返回（仅返回最新版）', async () => {
    await writeMemoryService({
      caseId,
      kind: 'fact',
      text: '原告住北京',
      subjectKey: 'plaintiff.address',
      source: 'manual',
    })
    // 写入第二条同 subjectKey，第一条会被自动 invalidate
    await writeMemoryService({
      caseId,
      kind: 'fact',
      text: '原告住上海',
      subjectKey: 'plaintiff.address',
      source: 'manual',
    })
    const found = await findActiveMemoryBySubjectDAO(caseId, 'plaintiff.address')
    expect(found?.text).toBe('原告住上海')
  })
})

describe('listMemoriesDAO', () => {
  let userId: number
  let caseId: number

  beforeEach(async () => {
    userId = await ensureTestUser()
    caseId = await ensureTestCase(userId)
  })

  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM case_memories WHERE metadata->>'caseId' = $1`,
      String(caseId),
    )
    await cleanupTestData()
  })

  it('按 createdAt DESC 返回；分页 limit 生效', async () => {
    for (let i = 0; i < 5; i++) {
      await writeMemoryService({
        caseId,
        kind: 'fact',
        text: `事实${i}`,
        subjectKey: `key.${i}`,
        source: 'manual',
      })
      await new Promise(r => setTimeout(r, 10)) // 保证 createdAt 严格不同
    }
    const res = await listMemoriesDAO(caseId, { limit: 3 })
    expect(res.memories).toHaveLength(3)
    expect(res.memories[0]!.text).toBe('事实4') // 最新的在前
    expect(res.nextCursor).toBeTruthy()
  })

  it('按 source 筛选', async () => {
    await writeMemoryService({
      caseId,
      kind: 'fact',
      text: 'manual A',
      subjectKey: 'a',
      source: 'manual',
    })
    await writeMemoryService({
      caseId,
      kind: 'fact',
      text: 'auto B',
      subjectKey: 'b',
      source: 'auto_extract',
    })
    const res = await listMemoriesDAO(caseId, { source: 'manual' })
    expect(res.memories).toHaveLength(1)
    expect(res.memories[0]!.text).toBe('manual A')
  })

  it('默认不含失效记录；includeInvalidated=true 包含', async () => {
    await writeMemoryService({
      caseId,
      kind: 'fact',
      text: 'v1',
      subjectKey: 'x',
      source: 'manual',
    })
    await writeMemoryService({
      caseId,
      kind: 'fact',
      text: 'v2',
      subjectKey: 'x',
      source: 'manual',
    })

    const r1 = await listMemoriesDAO(caseId, {})
    expect(r1.memories.map(m => m.text)).toEqual(['v2'])

    const r2 = await listMemoriesDAO(caseId, { includeInvalidated: true })
    expect(r2.memories.map(m => m.text).sort()).toEqual(['v1', 'v2'])
  })

  it('cursor 分页：第二页接续上一页', async () => {
    for (let i = 0; i < 5; i++) {
      await writeMemoryService({
        caseId,
        kind: 'fact',
        text: `事实${i}`,
        subjectKey: `key.${i}`,
        source: 'manual',
      })
      await new Promise(r => setTimeout(r, 10))
    }
    const page1 = await listMemoriesDAO(caseId, { limit: 3 })
    expect(page1.memories.map(m => m.text)).toEqual(['事实4', '事实3', '事实2'])
    expect(page1.nextCursor).toBeTruthy()

    const page2 = await listMemoriesDAO(caseId, { limit: 3, cursor: page1.nextCursor })
    expect(page2.memories.map(m => m.text)).toEqual(['事实1', '事实0'])
    expect(page2.nextCursor).toBeUndefined() // 最后一页无 nextCursor
  })
})

describe('softDeleteMemoryDAO', () => {
  let userId: number
  let caseId: number

  beforeEach(async () => {
    userId = await ensureTestUser()
    caseId = await ensureTestCase(userId)
  })

  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM case_memories WHERE metadata->>'caseId' = $1`,
      String(caseId),
    )
    await cleanupTestData()
  })

  it('软删后 metadata.invalidatedAt 被设；id 仍存在', async () => {
    const { id } = await writeMemoryService({
      caseId,
      kind: 'fact',
      text: '待删除',
      subjectKey: 'kk',
      source: 'manual_user',
    })

    await softDeleteMemoryDAO(id)

    const rows = await prisma.$queryRawUnsafe<Array<{ metadata: any }>>(
      `SELECT metadata FROM case_memories WHERE id = $1::uuid`,
      id,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.metadata.invalidatedAt).toBeTruthy()
  })

  it('软删后召回链路自动过滤（listMemoriesDAO 默认不返回）', async () => {
    const { id } = await writeMemoryService({
      caseId,
      kind: 'fact',
      text: '待删条目',
      subjectKey: 'soft.delete.recall',
      source: 'manual_user',
    })

    await softDeleteMemoryDAO(id)

    // listMemoriesDAO 默认 includeInvalidated=false，应过滤掉
    const r1 = await listMemoriesDAO(caseId, {})
    expect(r1.memories.find(m => m.id === id)).toBeUndefined()

    // includeInvalidated=true 时仍可见
    const r2 = await listMemoriesDAO(caseId, { includeInvalidated: true })
    expect(r2.memories.find(m => m.id === id)).toBeDefined()
  })
})
