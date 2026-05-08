/**
 * DELETE /api/v1/cases/memories/:memoryId 测试
 *
 * **Feature: case-memory-extension**
 * **Validates: spec §3.3 DELETE 严格限制 source=manual_user + 案件 owner**
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeMemoryService } from '~~/server/services/memory/memory.service'
import { prisma } from '~~/server/utils/db'
import { ensureTestUser, ensureTestCase, cleanupTestData } from '../../assistant/test-db-helper'

// 全局 stub（模拟 Nuxt nitro 自动导入），必须在 import handler 前设置
;(globalThis as any).resError = (_e: any, code: number, message: string) => ({ code, success: false, message, data: null })
;(globalThis as any).resSuccess = (_e: any, message: string, data: any) => ({ code: 0, success: true, message, data })
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).getRouterParam = (e: any, k: string) => e.__params?.[k]

// 动态 import handler（必须在 globalThis stub 设置之后）
const { default: handler } = await import(
    '../../../../server/api/v1/cases/memories/[memoryId].delete'
)

const makeEvent = (userId: number, memoryId: string) => ({
    context: { auth: { user: { id: userId } } },
    __params: { memoryId },
}) as any

describe('DELETE /:memoryId', () => {
    let userId: number
    let otherUserId: number
    let caseId: number

    beforeEach(async () => {
        userId = await ensureTestUser()
        otherUserId = await ensureTestUser()
        caseId = await ensureTestCase(userId)
    })

    afterEach(async () => {
        await prisma.$executeRawUnsafe(
            `DELETE FROM case_memories WHERE metadata->>'caseId' = $1`,
            String(caseId),
        )
        await cleanupTestData()
    })

    it('source=manual_user 且 owner → 软删 OK', async () => {
        const { id } = await writeMemoryService({ caseId, kind: 'fact', text: '我手动添加的记忆', source: 'manual_user' })

        const res: any = await handler(makeEvent(userId, id))
        expect(res.success).toBe(true)

        const rows = await prisma.$queryRawUnsafe<Array<{ metadata: any }>>(
            `SELECT metadata FROM case_memories WHERE id = $1::uuid`, id,
        )
        expect(rows[0]!.metadata.invalidatedAt).toBeTruthy()
    })

    it('source=manual（AI 写的）→ 403', async () => {
        const { id } = await writeMemoryService({ caseId, kind: 'fact', text: 'AI 提取的记忆', source: 'manual' })

        const res: any = await handler(makeEvent(userId, id))
        expect(res.code).toBe(403)
    })

    it('非案件 owner → 403', async () => {
        const { id } = await writeMemoryService({ caseId, kind: 'fact', text: '我手动添加的记忆', source: 'manual_user' })

        const res: any = await handler(makeEvent(otherUserId, id))
        expect(res.code).toBe(403)
    })

    it('memoryId 不存在 → 404', async () => {
        const res: any = await handler(makeEvent(userId, '00000000-0000-0000-0000-000000000000'))
        expect(res.code).toBe(404)
    })
})
