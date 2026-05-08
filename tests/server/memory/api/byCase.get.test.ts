/**
 * GET /api/v1/case/memories/by-case/:caseId 测试
 *
 * **Feature: case-memory-extension**
 * **Validates: spec §3.3 GET API 权限 / 分页 / 筛选**
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
;(globalThis as any).getQuery = (e: any) => e.__query ?? {}

// 动态 import handler（必须在 globalThis stub 设置之后）
const { default: handler } = await import(
    '../../../../server/api/v1/case/memories/by-case/[caseId].get'
)

const makeEvent = (userId: number, caseId: number, query: any = {}) => ({
    context: { auth: { user: { id: userId } } },
    __params: { caseId: String(caseId) },
    __query: query,
}) as any

describe('GET /by-case/:caseId', () => {
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

    it('未登录 → 401', async () => {
        const res: any = await handler({ context: { auth: {} }, __params: { caseId: String(caseId) } } as any)
        expect(res.code).toBe(401)
    })

    it('非 owner → 403', async () => {
        const res: any = await handler(makeEvent(otherUserId, caseId))
        expect(res.code).toBe(403)
    })

    it('owner 正常返回列表', async () => {
        await writeMemoryService({ caseId, kind: 'fact', text: '原告住北京', subjectKey: 'a', source: 'manual' })
        await writeMemoryService({ caseId, kind: 'fact', text: '被告是公司', subjectKey: 'b', source: 'manual' })

        const res: any = await handler(makeEvent(userId, caseId))
        expect(res.success).toBe(true)
        expect(res.data.memories).toHaveLength(2)
    })

    it('source 筛选', async () => {
        await writeMemoryService({ caseId, kind: 'fact', text: '原告住北京', subjectKey: 'a', source: 'manual' })
        await writeMemoryService({ caseId, kind: 'fact', text: '被告是公司', subjectKey: 'b', source: 'auto_extract' })

        const res: any = await handler(makeEvent(userId, caseId, { source: 'manual' }))
        expect(res.data.memories).toHaveLength(1)
        expect(res.data.memories[0]!.text).toBe('原告住北京')
    })
})
