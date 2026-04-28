/**
 * GET /api/v1/assistant/document/drafts/:id/related-materials handler 测试
 *
 * 策略：handler 单测。Service/DAO 层 Mock 替换——只验证 handler 层的鉴权、
 * 参数校验、owner 校验、字段映射。
 *
 * **Feature: document-case-materials-sync**
 * **Validates: spec §3.5, plan Task 8**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ==================== 全局 Stub（模拟 Nuxt nitro 自动导入）====================

const resError = (_event: any, code: number, message: string) => ({
    code,
    success: false,
    message,
    data: null,
})
const resSuccess = (_event: any, message: string, data: any) => ({
    code: 0,
    success: true,
    message,
    data,
})

;(globalThis as any).resError = resError
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).getRouterParam = (event: any, key: string) => event.__params?.[key]
;(globalThis as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }

// ==================== Mock service/DAO 层 ====================

vi.mock('~~/server/agents/document/documentDraft.dao', () => ({
    getDocumentDraftDAO: vi.fn(),
}))

vi.mock('~~/server/services/material/material.service', () => ({
    getMaterialsByCaseOrDraftIdWithStatusService: vi.fn(),
}))

import { getDocumentDraftDAO } from '~~/server/agents/document/documentDraft.dao'
import { getMaterialsByCaseOrDraftIdWithStatusService } from '~~/server/services/material/material.service'

const mockGetDraft = getDocumentDraftDAO as ReturnType<typeof vi.fn>
const mockGetMaterials = getMaterialsByCaseOrDraftIdWithStatusService as ReturnType<typeof vi.fn>

// ==================== 动态 import handler（必须在 mock 之后）====================

const { default: handler } = await import(
    '../../../../server/api/v1/assistant/document/drafts/related-materials/[id].get'
)

// ==================== 工具函数 ====================

interface MockEvent {
    context: { auth?: { user: { id: number } } }
    __params?: Record<string, string>
}

function makeEvent(opts: {
    userId?: number
    params?: Record<string, string>
}): MockEvent {
    return {
        context: opts.userId ? { auth: { user: { id: opts.userId } } } : {},
        __params: opts.params,
    }
}

const USER_A = 2001
const USER_B = 2002

describe('GET /api/v1/assistant/document/drafts/:id/related-materials', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('未登录返回 401', async () => {
        const res: any = await handler(makeEvent({ params: { id: '1' } }) as any)
        expect(res.code).toBe(401)
        expect(mockGetDraft).not.toHaveBeenCalled()
    })

    it('id 非数字返回 400', async () => {
        const res: any = await handler(
            makeEvent({ userId: USER_A, params: { id: 'abc' } }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockGetDraft).not.toHaveBeenCalled()
    })

    it('id 为 0 返回 400', async () => {
        const res: any = await handler(
            makeEvent({ userId: USER_A, params: { id: '0' } }) as any,
        )
        expect(res.code).toBe(400)
    })

    it('草稿不存在返回 404', async () => {
        mockGetDraft.mockResolvedValue(null)
        const res: any = await handler(
            makeEvent({ userId: USER_A, params: { id: '999' } }) as any,
        )
        expect(res.code).toBe(404)
        expect(res.message).toContain('草稿不存在')
    })

    it('访问他人草稿返回 403', async () => {
        mockGetDraft.mockResolvedValue({ id: 1, userId: USER_A, caseId: null })
        const res: any = await handler(
            makeEvent({ userId: USER_B, params: { id: '1' } }) as any,
        )
        expect(res.code).toBe(403)
        expect(mockGetMaterials).not.toHaveBeenCalled()
    })

    it('draft 有 caseId：按 (caseId, draftId) 合并查询材料', async () => {
        mockGetDraft.mockResolvedValue({ id: 10, userId: USER_A, caseId: 5 })
        mockGetMaterials.mockResolvedValue([
            {
                id: 100,
                name: 'a.pdf',
                type: 2, // DOCUMENT
                ossFileId: 50,
                isEncrypted: false,
                realStatus: 3,
                summary: '摘要',
                createdAt: new Date('2026-04-20T00:00:00.000Z'),
                fileName: 'a.pdf',
                fileSize: 1024,
                fileType: 'application/pdf',
            },
        ])
        const res: any = await handler(
            makeEvent({ userId: USER_A, params: { id: '10' } }) as any,
        )
        expect(res.success).toBe(true)
        expect(mockGetMaterials).toHaveBeenCalledWith(5, 10)
        expect(res.data).toHaveLength(1)
        expect(res.data[0]).toMatchObject({
            id: 100,
            name: 'a.pdf',
            type: 2,
            typeText: '文档',
            ossFileId: 50,
            isEncrypted: false,
            status: 3, // realStatus → status
            summary: '摘要',
            fileName: 'a.pdf',
            fileSize: 1024,
            fileType: 'application/pdf',
        })
    })

    it('draft 无 caseId（独立文书页）：按 (null, draftId) 查询', async () => {
        mockGetDraft.mockResolvedValue({ id: 20, userId: USER_A, caseId: null })
        mockGetMaterials.mockResolvedValue([])
        const res: any = await handler(
            makeEvent({ userId: USER_A, params: { id: '20' } }) as any,
        )
        expect(res.success).toBe(true)
        expect(mockGetMaterials).toHaveBeenCalledWith(null, 20)
        expect(res.data).toEqual([])
    })

    it('未知 type 的 typeText 回退为"未知"', async () => {
        mockGetDraft.mockResolvedValue({ id: 30, userId: USER_A, caseId: null })
        mockGetMaterials.mockResolvedValue([
            {
                id: 200,
                name: 'weird',
                type: 999,
                ossFileId: null,
                isEncrypted: false,
                realStatus: 1,
                summary: null,
                createdAt: new Date(),
                fileName: null,
                fileSize: null,
                fileType: null,
            },
        ])
        const res: any = await handler(
            makeEvent({ userId: USER_A, params: { id: '30' } }) as any,
        )
        expect(res.success).toBe(true)
        expect(res.data[0].typeText).toBe('未知')
    })
})
