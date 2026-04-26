/**
 * 文书草稿 CRUD API 端到端测试（handler 单测）
 *
 * 策略：直接 import handler default export，传入 mock event（含 auth 上下文），
 * Service/DAO 层由外部 Mock 替换——避免真实数据库调用。
 * 只测 handler 层的鉴权、参数校验、权限隔离、4xx 边界，以及业务码透传。
 *
 * **Feature: document-generation**
 * **Validates: Task 3.11, spec §3.11**
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
;(globalThis as any).getQuery = (event: any) => event.__query ?? {}
;(globalThis as any).readBody = async (event: any) => event.__body
;(globalThis as any).getRouterParam = (event: any, key: string) => event.__params?.[key]
;(globalThis as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }

// ==================== Mock service/DAO 层 ====================

vi.mock('~~/server/agents/document/documentDraft.service', () => ({
    createDraftService: vi.fn(),
    getDraftService: vi.fn(),
    patchDraftService: vi.fn(),
    deleteDraftService: vi.fn(),
}))

vi.mock('~~/server/agents/document/documentDraft.dao', () => ({
    listDocumentDraftsDAO: vi.fn(),
}))

import {
    createDraftService,
    getDraftService,
    patchDraftService,
    deleteDraftService,
} from '~~/server/agents/document/documentDraft.service'
import { listDocumentDraftsDAO } from '~~/server/agents/document/documentDraft.dao'

const mockCreateDraftService = createDraftService as ReturnType<typeof vi.fn>
const mockGetDraftService = getDraftService as ReturnType<typeof vi.fn>
const mockPatchDraftService = patchDraftService as ReturnType<typeof vi.fn>
const mockDeleteDraftService = deleteDraftService as ReturnType<typeof vi.fn>
const mockListDraftsDAO = listDocumentDraftsDAO as ReturnType<typeof vi.fn>

// ==================== 动态 import handlers（必须在 mock 之后）====================

const { default: listHandler } = await import(
    '../../../../server/api/v1/assistant/document/drafts.get'
)
const { default: createHandler } = await import(
    '../../../../server/api/v1/assistant/document/drafts.post'
)
const { default: detailHandler } = await import(
    '../../../../server/api/v1/assistant/document/drafts/[id].get'
)
const { default: patchHandler } = await import(
    '../../../../server/api/v1/assistant/document/drafts/[id].patch'
)
const { default: deleteHandler } = await import(
    '../../../../server/api/v1/assistant/document/drafts/[id].delete'
)

// ==================== 工具函数 ====================

interface MockEvent {
    context: { auth?: { user: { id: number } } }
    __query?: Record<string, any>
    __body?: any
    __params?: Record<string, string>
}

function makeEvent(opts: {
    userId?: number
    query?: Record<string, any>
    body?: any
    params?: Record<string, string>
}): MockEvent {
    return {
        context: opts.userId ? { auth: { user: { id: opts.userId } } } : {},
        __query: opts.query,
        __body: opts.body,
        __params: opts.params,
    }
}

// ==================== 测试用户 ID（不依赖真实 DB）====================

const USER_A = 1001
const USER_B = 1002

// ==================== POST /drafts ====================

describe('POST /api/v1/assistant/document/drafts', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('未登录返回 401', async () => {
        const res: any = await createHandler(makeEvent({ body: { templateId: 1 } }) as any)
        expect(res.code).toBe(401)
    })

    it('缺少 templateId 返回 400', async () => {
        const res: any = await createHandler(makeEvent({ userId: USER_A, body: {} }) as any)
        expect(res.code).toBe(400)
    })

    it('templateId 非正整数返回 400', async () => {
        const res: any = await createHandler(
            makeEvent({ userId: USER_A, body: { templateId: 0 } }) as any,
        )
        expect(res.code).toBe(400)
    })

    it('templateId 不存在返回 404', async () => {
        mockCreateDraftService.mockResolvedValue({ error: '模板不存在', code: 404 })
        const res: any = await createHandler(
            makeEvent({ userId: USER_A, body: { templateId: 999 } }) as any,
        )
        expect(res.code).toBe(404)
        expect(res.message).toContain('模板不存在')
    })

    it('非本用户的 user 模板返回 403', async () => {
        mockCreateDraftService.mockResolvedValue({ error: '无权使用此模板', code: 403 })
        const res: any = await createHandler(
            makeEvent({ userId: USER_B, body: { templateId: 1 } }) as any,
        )
        expect(res.code).toBe(403)
        expect(res.message).toContain('无权使用此模板')
    })

    it('创建成功返回 draftId 和 sessionId', async () => {
        mockCreateDraftService.mockResolvedValue({ draftId: 42, sessionId: 'sess-abc' })
        const res: any = await createHandler(
            makeEvent({
                userId: USER_A,
                body: { templateId: 1, sourceText: '合同内容', caseId: 5 },
            }) as any,
        )
        expect(res.success).toBe(true)
        expect(res.data).toMatchObject({ draftId: 42, sessionId: 'sess-abc' })
        expect(mockCreateDraftService).toHaveBeenCalledWith({
            userId: USER_A,
            templateId: 1,
            sourceText: '合同内容',
            caseId: 5,
        })
    })

    it('传入 sourceFileIds 数组正确透传', async () => {
        mockCreateDraftService.mockResolvedValue({ draftId: 10, sessionId: 'sess-xyz' })
        const res: any = await createHandler(
            makeEvent({
                userId: USER_A,
                body: { templateId: 2, sourceFileIds: [3, 4, 5] },
            }) as any,
        )
        expect(res.success).toBe(true)
        expect(mockCreateDraftService).toHaveBeenCalledWith({
            userId: USER_A,
            templateId: 2,
            sourceFileIds: [3, 4, 5],
        })
    })

    it('sourceFileIds 含非正整数返回 400', async () => {
        const res: any = await createHandler(
            makeEvent({
                userId: USER_A,
                body: { templateId: 1, sourceFileIds: [0, 1] },
            }) as any,
        )
        expect(res.code).toBe(400)
    })
})

// ==================== GET /drafts ====================

describe('GET /api/v1/assistant/document/drafts', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('未登录返回 401', async () => {
        const res: any = await listHandler(makeEvent({}) as any)
        expect(res.code).toBe(401)
    })

    it('不传 caseId 返回所有自己的草稿', async () => {
        mockListDraftsDAO.mockResolvedValue({ list: [{ id: 1 }, { id: 2 }], total: 2 })
        const res: any = await listHandler(
            makeEvent({ userId: USER_A, query: { skip: '0', take: '20' } }) as any,
        )
        expect(res.success).toBe(true)
        expect(res.data.total).toBe(2)
        expect(res.data.items).toHaveLength(2)
        expect(mockListDraftsDAO).toHaveBeenCalledWith({
            userId: USER_A,
            skip: 0,
            take: 20,
        })
    })

    it('传入 caseId 过滤草稿', async () => {
        mockListDraftsDAO.mockResolvedValue({ list: [{ id: 3 }], total: 1 })
        const res: any = await listHandler(
            makeEvent({ userId: USER_A, query: { caseId: '7', skip: '0', take: '20' } }) as any,
        )
        expect(res.success).toBe(true)
        expect(mockListDraftsDAO).toHaveBeenCalledWith({
            userId: USER_A,
            caseId: 7,
            skip: 0,
            take: 20,
        })
    })

    it('返回分页元数据 skip/take', async () => {
        mockListDraftsDAO.mockResolvedValue({ list: [], total: 100 })
        const res: any = await listHandler(
            makeEvent({ userId: USER_A, query: { skip: '40', take: '10' } }) as any,
        )
        expect(res.data.skip).toBe(40)
        expect(res.data.take).toBe(10)
        expect(res.data.total).toBe(100)
    })

    it('take 超过 100 返回 400', async () => {
        const res: any = await listHandler(
            makeEvent({ userId: USER_A, query: { take: '200' } }) as any,
        )
        expect(res.code).toBe(400)
    })
})

// ==================== GET /drafts/:id ====================

describe('GET /api/v1/assistant/document/drafts/:id', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('未登录返回 401', async () => {
        const res: any = await detailHandler(makeEvent({ params: { id: '1' } }) as any)
        expect(res.code).toBe(401)
    })

    it('id 非数字返回 400', async () => {
        const res: any = await detailHandler(
            makeEvent({ userId: USER_A, params: { id: 'abc' } }) as any,
        )
        expect(res.code).toBe(400)
    })

    it('草稿不存在返回 404', async () => {
        mockGetDraftService.mockResolvedValue({ error: '草稿不存在', code: 404 })
        const res: any = await detailHandler(
            makeEvent({ userId: USER_A, params: { id: '999' } }) as any,
        )
        expect(res.code).toBe(404)
    })

    it('访问他人草稿返回 403', async () => {
        mockGetDraftService.mockResolvedValue({ error: '无权访问此草稿', code: 403 })
        const res: any = await detailHandler(
            makeEvent({ userId: USER_B, params: { id: '1' } }) as any,
        )
        expect(res.code).toBe(403)
    })

    it('获取自己的草稿成功', async () => {
        const fakeDraft = { id: 1, userId: USER_A, status: 'ready', values: {} }
        mockGetDraftService.mockResolvedValue({ draft: fakeDraft })
        const res: any = await detailHandler(
            makeEvent({ userId: USER_A, params: { id: '1' } }) as any,
        )
        expect(res.success).toBe(true)
        expect(res.data.draft).toMatchObject({ id: 1, userId: USER_A })
        expect(mockGetDraftService).toHaveBeenCalledWith(USER_A, 1)
    })
})

// ==================== PATCH /drafts/:id ====================

describe('PATCH /api/v1/assistant/document/drafts/:id', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('未登录返回 401', async () => {
        const res: any = await patchHandler(
            makeEvent({ params: { id: '1' }, body: { values: {} } }) as any,
        )
        expect(res.code).toBe(401)
    })

    it('id 非数字返回 400', async () => {
        const res: any = await patchHandler(
            makeEvent({ userId: USER_A, params: { id: 'abc' }, body: { values: {} } }) as any,
        )
        expect(res.code).toBe(400)
    })

    it('缺少 values 字段返回 400', async () => {
        const res: any = await patchHandler(
            makeEvent({ userId: USER_A, params: { id: '1' }, body: {} }) as any,
        )
        expect(res.code).toBe(400)
    })

    it('values 非对象返回 400', async () => {
        const res: any = await patchHandler(
            makeEvent({ userId: USER_A, params: { id: '1' }, body: { values: 'invalid' } }) as any,
        )
        expect(res.code).toBe(400)
    })

    it('草稿正在生成中（status=filling）返回 409', async () => {
        mockPatchDraftService.mockResolvedValue({ error: '草稿正在生成中，请稍后再修改', code: 409 })
        const res: any = await patchHandler(
            makeEvent({
                userId: USER_A,
                params: { id: '1' },
                body: { values: { field1: '值' } },
            }) as any,
        )
        expect(res.code).toBe(409)
        expect(res.message).toContain('生成中')
    })

    it('修改他人草稿返回 403', async () => {
        mockPatchDraftService.mockResolvedValue({ error: '无权修改此草稿', code: 403 })
        const res: any = await patchHandler(
            makeEvent({
                userId: USER_B,
                params: { id: '1' },
                body: { values: { field1: '值' } },
            }) as any,
        )
        expect(res.code).toBe(403)
    })

    it('更新草稿成功', async () => {
        const updatedDraft = { id: 1, userId: USER_A, values: { field1: '新值' }, status: 'ready' }
        mockPatchDraftService.mockResolvedValue({ draft: updatedDraft })
        const res: any = await patchHandler(
            makeEvent({
                userId: USER_A,
                params: { id: '1' },
                body: { values: { field1: '新值' } },
            }) as any,
        )
        expect(res.success).toBe(true)
        expect(res.data.draft).toMatchObject({ id: 1, values: { field1: '新值' } })
        expect(mockPatchDraftService).toHaveBeenCalledWith(USER_A, 1, { values: { field1: '新值' } })
    })

    it('草稿不存在返回 404', async () => {
        mockPatchDraftService.mockResolvedValue({ error: '草稿不存在', code: 404 })
        const res: any = await patchHandler(
            makeEvent({
                userId: USER_A,
                params: { id: '999' },
                body: { values: { field1: '值' } },
            }) as any,
        )
        expect(res.code).toBe(404)
    })
})

// ==================== DELETE /drafts/:id ====================

describe('DELETE /api/v1/assistant/document/drafts/:id', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('未登录返回 401', async () => {
        const res: any = await deleteHandler(makeEvent({ params: { id: '1' } }) as any)
        expect(res.code).toBe(401)
        expect(mockDeleteDraftService).not.toHaveBeenCalled()
    })

    it('id 非数字返回 400', async () => {
        const res: any = await deleteHandler(
            makeEvent({ userId: USER_A, params: { id: 'abc' } }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockDeleteDraftService).not.toHaveBeenCalled()
    })

    it('id 为 0 返回 400', async () => {
        const res: any = await deleteHandler(
            makeEvent({ userId: USER_A, params: { id: '0' } }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockDeleteDraftService).not.toHaveBeenCalled()
    })

    it('id 为负数返回 400', async () => {
        const res: any = await deleteHandler(
            makeEvent({ userId: USER_A, params: { id: '-1' } }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockDeleteDraftService).not.toHaveBeenCalled()
    })

    it('草稿不存在返回 404', async () => {
        mockDeleteDraftService.mockResolvedValue({ error: '草稿不存在', code: 404 })
        const res: any = await deleteHandler(
            makeEvent({ userId: USER_A, params: { id: '999' } }) as any,
        )
        expect(res.code).toBe(404)
        expect(res.message).toContain('草稿不存在')
    })

    it('删除他人草稿返回 403', async () => {
        mockDeleteDraftService.mockResolvedValue({ error: '无权删除此草稿', code: 403 })
        const res: any = await deleteHandler(
            makeEvent({ userId: USER_B, params: { id: '1' } }) as any,
        )
        expect(res.code).toBe(403)
        expect(res.message).toContain('无权删除此草稿')
    })

    it('成功软删自己的草稿', async () => {
        mockDeleteDraftService.mockResolvedValue({ ok: true })
        const res: any = await deleteHandler(
            makeEvent({ userId: USER_A, params: { id: '1' } }) as any,
        )
        expect(res.success).toBe(true)
        expect(mockDeleteDraftService).toHaveBeenCalledWith(USER_A, 1)
    })
})
