/**
 * softDeleteAssistantSessionDAO 级联软删材料测试
 *
 * **Feature: assistant-file-reading**
 */
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { createMaterialDao, findMaterialsBySessionIdDao } from '~~/server/services/material/material.dao'
import { softDeleteAssistantSessionDAO } from '~~/server/services/assistant/assistantSession.dao'
import { createTestUser, cleanupAllTestData } from '~~/tests/server/material/test-db-helper'

describe('softDeleteAssistantSessionDAO 级联软删材料', () => {
  afterEach(async () => { await cleanupAllTestData() })

  it('删除会话后该会话材料 deletedAt 被置上', async () => {
    const user = await createTestUser()
    const sessionId = `sess-del-${Date.now()}`
    const session = await prisma.caseSessions.create({
      data: { sessionId, scope: 'assistant', userId: user.id, status: 1, type: 1 },
    })
    const material = await createMaterialDao({ sessionId, name: 'M', type: 3 })

    const r = await softDeleteAssistantSessionDAO(sessionId, user.id)
    expect(r.success).toBe(true)
    expect(await findMaterialsBySessionIdDao(sessionId)).toEqual([])

    // 清理本测试直接建的行（createTestUser 由 cleanupAllTestData 清）
    await prisma.caseMaterials.delete({ where: { id: material.id } })
    await prisma.caseSessions.delete({ where: { id: session.id } })
  })
})
