/**
 * PATCH /api/v1/assistant/document/drafts/[id]/title 单元测试
 *
 * **Feature: document-generation**
 * **Validates: Task 12 - updateDraftTitleService API**
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
;(globalThis as any).readBody = async (event: any) => event.__body
;(globalThis as any).getRouterParam = (event: any, key: string) => event.__params?.[key]
;(globalThis as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }

// ==================== Mock service 层 ====================

vi.mock('~~/server/agents/document/documentDraft.service', () => ({
    updateDraftTitleService: vi.fn(),
}))

import { updateDraftTitleService } from '~~/server/agents/document/documentDraft.service'
const mockUpdateTitleService = updateDraftTitleService as ReturnType<typeof vi.fn>

// ==================== 动态 import handler ====================

const { default: handler } = await import(
    '../../../../server/api/v1/assistant/document/drafts/title/[id].patch'
)

// ==================== 工具函数 ====================

function makeEvent(opts: { userId?: number; id?: string; title?: string }) {
    return {
        context: opts.userId ? { auth: { user: { id: opts.userId } } } : {},
        __params: { id: opts.id ?? '1' },
        __body: opts.title !== undefined ? { title: opts.title } : {},
    }
}

// ==================== 测试用户 ====================

const USER_A = 1001
const USER_B = 1002

// ==================== PATCH /drafts/[id]/title ====================

describe('PATCH /api/v1/assistant/document/drafts/[id]/title', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('未登录返回 401', async () => {
        const res: any = await handler(makeEvent({ title: 'X' }) as any)
        expect(res.code).toBe(401)
    })

    it('id 非数字返回 400', async () => {
        const res: any = await handler(makeEvent({ userId: USER_A, id: 'abc', title: 'X' }) as any)
        expect(res.code).toBe(400)
    })

    it('id 为 0 返回 400', async () => {
        const res: any = await handler(makeEvent({ userId: USER_A, id: '0', title: 'X' }) as any)
        expect(res.code).toBe(400)
    })

    it('id 为负数返回 400', async () => {
        const res: any = await handler(makeEvent({ userId: USER_A, id: '-1', title: 'X' }) as any)
        expect(res.code).toBe(400)
    })

    it('title 缺失返回 400', async () => {
        const res: any = await handler(
            makeEvent({ userId: USER_A, id: '1' }) as any
        )
        expect(res.code).toBe(400)
    })

    it('title 空串返回 400', async () => {
        const res: any = await handler(makeEvent({ userId: USER_A, title: '' }) as any)
        expect(res.code).toBe(400)
    })

    it('title 超过 200 字返回 400', async () => {
        const res: any = await handler(
            makeEvent({ userId: USER_A, title: 'a'.repeat(201) }) as any
        )
        expect(res.code).toBe(400)
    })

    it('owner 成功更新标题', async () => {
        mockUpdateTitleService.mockResolvedValue({
            draft: { id: 1, title: '我的标题', titleOverridden: true },
        })
        const res: any = await handler(
            makeEvent({ userId: USER_A, title: '我的标题' }) as any
        )
        expect(res.code).toBe(0)
        expect(res.success).toBe(true)
        expect(res.data.draft.title).toBe('我的标题')
        expect(mockUpdateTitleService).toHaveBeenCalledWith(USER_A, 1, '我的标题')
    })

    it('title 前后空格被 trim', async () => {
        mockUpdateTitleService.mockResolvedValue({
            draft: { id: 1, title: '我的标题', titleOverridden: true },
        })
        const res: any = await handler(
            makeEvent({ userId: USER_A, title: '  我的标题  ' }) as any
        )
        expect(res.code).toBe(0)
        expect(mockUpdateTitleService).toHaveBeenCalledWith(USER_A, 1, '我的标题')
    })

    it('service 返 403 无权修改时透传', async () => {
        mockUpdateTitleService.mockResolvedValue({ error: '无权修改此草稿', code: 403 })
        const res: any = await handler(
            makeEvent({ userId: USER_B, id: '1', title: 'X' }) as any
        )
        expect(res.code).toBe(403)
        expect(res.success).toBe(false)
    })

    it('service 返 404 草稿不存在时透传', async () => {
        mockUpdateTitleService.mockResolvedValue({ error: '草稿不存在', code: 404 })
        const res: any = await handler(
            makeEvent({ userId: USER_A, id: '999', title: 'X' }) as any
        )
        expect(res.code).toBe(404)
        expect(res.success).toBe(false)
    })
})
