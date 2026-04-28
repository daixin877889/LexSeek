/**
 * POST /api/v1/assistant/document/drafts/:id/materials handler 测试
 *
 * 验证 Task 5：handler 从 draft.caseId 取值，透传给 ensureMaterialsReadyForDraftService
 *
 * **Feature: document-case-materials-sync / Task 5**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ==================== Nuxt 自动导入 Stub ====================

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
;(globalThis as any).readBody = async (event: any) => event.__body
;(globalThis as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }

// ==================== Mock 依赖 ====================

vi.mock('~~/server/agents/document/documentDraft.dao', () => ({
    getDocumentDraftDAO: vi.fn(),
}))

vi.mock('~~/server/services/material/materialPipeline.service', () => ({
    ensureMaterialsReadyForDraftService: vi.fn(async () => ({ id: 1, status: 3 })),
}))

import { getDocumentDraftDAO } from '~~/server/agents/document/documentDraft.dao'
import { ensureMaterialsReadyForDraftService } from '~~/server/services/material/materialPipeline.service'

const mockGetDraft = getDocumentDraftDAO as ReturnType<typeof vi.fn>
const mockEnsure = ensureMaterialsReadyForDraftService as ReturnType<typeof vi.fn>

const { default: postHandler } = await import(
    '../../../../server/api/v1/assistant/document/drafts/materials/[id].post'
)

function makeEvent(opts: { userId?: number; params?: Record<string, string>; body?: any }) {
    return {
        context: opts.userId ? { auth: { user: { id: opts.userId } } } : {},
        __params: opts.params,
        __body: opts.body,
    } as any
}

describe('POST /drafts/:id/materials 透传 draft.caseId', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockEnsure.mockResolvedValue({ id: 1, status: 3 })
    })

    it('draft.caseId 非空时，以 (fileId, draftId, userId, caseId) 调用 ensureMaterialsReadyForDraftService', async () => {
        mockGetDraft.mockResolvedValue({ id: 50, userId: 99, caseId: 777 })

        await postHandler(makeEvent({
            userId: 99,
            params: { id: '50' },
            body: { fileIds: [11, 22] },
        }))

        expect(mockEnsure).toHaveBeenCalledTimes(2)
        expect(mockEnsure).toHaveBeenNthCalledWith(1, 11, 50, 99, 777)
        expect(mockEnsure).toHaveBeenNthCalledWith(2, 22, 50, 99, 777)
    })

    it('draft.caseId 为 null 时，以 null 作为第 4 参数调用（独立文书页）', async () => {
        mockGetDraft.mockResolvedValue({ id: 50, userId: 99, caseId: null })

        await postHandler(makeEvent({
            userId: 99,
            params: { id: '50' },
            body: { fileIds: [11] },
        }))

        expect(mockEnsure).toHaveBeenCalledTimes(1)
        expect(mockEnsure).toHaveBeenNthCalledWith(1, 11, 50, 99, null)
    })
})
