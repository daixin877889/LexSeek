/**
 * memory.dao 测试
 *
 * **Feature: case-memory-extension**
 * **Validates: spec §3.1 软去重 DAO**
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { findActiveMemoryBySubjectDAO } from '~~/server/services/memory/memory.dao'
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
