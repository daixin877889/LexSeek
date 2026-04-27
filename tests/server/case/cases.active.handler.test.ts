/**
 * GET /api/v1/cases/active · handler 单元测试（mock service）
 *
 * 仅校验 handler 层鉴权 / 参数校验 / 响应格式 / service 透传。
 *
 * **Feature: ai-unify-stage-5**
 * **Validates: Task 8 · 用户端「我的进行中案件」列表 API**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const resErrorStub = (_e: any, code: number, message: string) => ({ code, success: false, message })
const resSuccessStub = (_e: any, message: string, data: any) => ({ code: 0, success: true, message, data })

;(globalThis as any).resError = resErrorStub
;(globalThis as any).resSuccess = resSuccessStub
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).getQuery = (event: any) => event.__query ?? {}
;(globalThis as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }

vi.mock('~~/server/services/case/case.service', () => ({
    getActiveCasesService: vi.fn(),
}))

import { getActiveCasesService } from '~~/server/services/case/case.service'
const mockGetActiveCases = getActiveCasesService as ReturnType<typeof vi.fn>

const { default: activeHandler } = await import(
    '../../../server/api/v1/cases/active.get'
)

function makeEvent(opts: { userId?: number; query?: Record<string, any> }) {
    return {
        context: opts.userId ? { auth: { user: { id: opts.userId } } } : {},
        __query: opts.query ?? {},
    }
}

describe('GET /api/v1/cases/active · handler', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('未登录返回 401', async () => {
        const res: any = await activeHandler(makeEvent({}) as any)
        expect(res.code).toBe(401)
        expect(mockGetActiveCases).not.toHaveBeenCalled()
    })

    it('成功返回案件列表（无 query）', async () => {
        mockGetActiveCases.mockResolvedValueOnce([{ id: 1, title: '案件 A' }])
        const res: any = await activeHandler(makeEvent({ userId: 1001 }) as any)
        expect(res.success).toBe(true)
        expect(res.data.items).toEqual([{ id: 1, title: '案件 A' }])
        expect(mockGetActiveCases).toHaveBeenCalledWith(1001, {})
    })

    it('q 参数透传到 service', async () => {
        mockGetActiveCases.mockResolvedValueOnce([])
        await activeHandler(makeEvent({ userId: 1001, query: { q: '劳动' } }) as any)
        expect(mockGetActiveCases).toHaveBeenCalledWith(1001, { q: '劳动' })
    })

    it('limit 参数透传到 service（合法范围）', async () => {
        mockGetActiveCases.mockResolvedValueOnce([])
        await activeHandler(makeEvent({ userId: 1001, query: { limit: '50' } }) as any)
        expect(mockGetActiveCases).toHaveBeenCalledWith(1001, { limit: 50 })
    })

    it('limit 超过 200 返回 400', async () => {
        const res: any = await activeHandler(
            makeEvent({ userId: 1001, query: { limit: '999' } }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockGetActiveCases).not.toHaveBeenCalled()
    })
})
