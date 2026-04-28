/**
 * POST /api/v1/case/memories/by-case/:caseId 测试
 *
 * **Feature: case-memory-extension**
 * **Validates: spec §3.3 POST 用户添加（subjectKey 推断 / 校验 / 写入）**
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { ensureTestUser, ensureTestCase, cleanupTestData } from '../../assistant/test-db-helper'

// 全局 stub（模拟 Nuxt nitro 自动导入），必须在 import handler 前设置
;(globalThis as any).resError = (_e: any, code: number, message: string) => ({ code, success: false, message, data: null })
;(globalThis as any).resSuccess = (_e: any, message: string, data: any) => ({ code: 0, success: true, message, data })
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).getRouterParam = (e: any, k: string) => e.__params?.[k]
;(globalThis as any).readBody = async (e: any) => e.__body

// Mock subject inference 服务，避免真实 LLM 调用
vi.mock('~~/server/services/memory/memorySubjectInfer.service', () => ({
    inferSubjectKeyService: vi.fn(),
}))

import { inferSubjectKeyService } from '~~/server/services/memory/memorySubjectInfer.service'

// 动态 import handler（必须在 globalThis stub 和 vi.mock 设置之后）
const { default: handler } = await import(
    '../../../../server/api/v1/case/memories/by-case/[caseId].post'
)

const makeEvent = (userId: number, caseId: number, body: any) => ({
    context: { auth: { user: { id: userId } } },
    __params: { caseId: String(caseId) },
    __body: body,
}) as any

describe('POST /by-case/:caseId', () => {
    let userId: number
    let caseId: number

    beforeEach(async () => {
        userId = await ensureTestUser()
        caseId = await ensureTestCase(userId)
        vi.clearAllMocks()
    })

    afterEach(async () => {
        await prisma.$executeRawUnsafe(
            `DELETE FROM case_memories WHERE metadata->>'caseId' = $1`,
            String(caseId),
        )
        await cleanupTestData()
    })

    it('Body 校验失败 → 400', async () => {
        const res: any = await handler(makeEvent(userId, caseId, { text: '短' /* < 5 字 */, kind: 'fact' }))
        expect(res.code).toBe(400)
    })

    it('subjectKey 提供则直接写入', async () => {
        const res: any = await handler(makeEvent(userId, caseId, {
            text: '原告住北京朝阳区',
            kind: 'fact',
            subjectKey: 'plaintiff.address',
        }))
        expect(res.success).toBe(true)
        expect(res.data.subjectKey).toBe('plaintiff.address')
        expect(res.data.source).toBe('manual_user')
        expect(inferSubjectKeyService).not.toHaveBeenCalled()
    })

    it('subjectKey 缺失则调推断', async () => {
        vi.mocked(inferSubjectKeyService).mockResolvedValueOnce('contract.term')
        const res: any = await handler(makeEvent(userId, caseId, {
            text: '合同约定服务期 2 年',
            kind: 'fact',
        }))
        expect(res.success).toBe(true)
        expect(res.data.subjectKey).toBe('contract.term')
        expect(inferSubjectKeyService).toHaveBeenCalledWith('合同约定服务期 2 年')
    })

    it('推断失败 fallback null subjectKey', async () => {
        vi.mocked(inferSubjectKeyService).mockResolvedValueOnce(null)
        const res: any = await handler(makeEvent(userId, caseId, {
            text: '随手记一笔小事情',
            kind: 'note',
        }))
        expect(res.success).toBe(true)
        expect(res.data.subjectKey).toBeNull()
    })
})
