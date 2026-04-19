/**
 * POST /api/v1/assistant/contract/reviews/:id/export-pdf handler 分支测试
 *
 * 覆盖：
 *   - 401 未登录
 *   - 400 reviewId 非正整数
 *   - 400 body 非法（includeRisks 非 boolean）
 *   - 400 body 含未识别字段（zod strict）
 *   - 404 service 抛 "review not found"
 *   - 500 service 抛其他异常
 *   - 200 正常：返回 Buffer + Content-Type=application/pdf
 *
 * 使用 vi.mock 隔离 service，专注验证 handler 行为。
 *
 * **Feature: contract-review-m6.2**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ==================== 全局 Stub ====================

const resError = (_event: any, code: number, message: string) => ({
    code,
    success: false,
    message,
    data: null,
})

;(globalThis as any).resError = resError
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).getRouterParam = (event: any, key: string) => event.__params?.[key]
;(globalThis as any).readBody = async (event: any) => event.__body
;(globalThis as any).setResponseHeader = (event: any, key: string, value: string) => {
    event.__headers = event.__headers ?? {}
    event.__headers[key] = value
}
;(globalThis as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }

// ==================== Mock service ====================

vi.mock('~~/server/services/assistant/contract/contractReviewPdf.service', () => ({
    exportReviewPdfService: vi.fn(),
}))

// loadOwnedReview 内部依赖 contractReview.dao.getContractReviewDAO；
// 默认返回与 makeEvent 默认 userId 匹配的 owned review，让 guard 通过；
// 个别需要 404/403 的测试可在用例内 override mock 返回值。
vi.mock('~~/server/services/assistant/contract/contractReview.dao', () => ({
    getContractReviewDAO: vi.fn(),
}))

import { exportReviewPdfService } from '~~/server/services/assistant/contract/contractReviewPdf.service'
import { getContractReviewDAO } from '~~/server/services/assistant/contract/contractReview.dao'

const mockExport = exportReviewPdfService as unknown as ReturnType<typeof vi.fn>
const mockGetReview = getContractReviewDAO as unknown as ReturnType<typeof vi.fn>

// ==================== 动态 import handler ====================

const { default: handler } = await import(
    '../../../../server/api/v1/assistant/contract/reviews/[id]/export-pdf.post'
)

interface MockEvent {
    context: { auth?: { user: { id: number } } }
    __params?: Record<string, string>
    __body?: unknown
    __headers?: Record<string, string>
}

function makeEvent(opts: {
    userId?: number
    id?: string
    body?: unknown
}): MockEvent {
    return {
        context: opts.userId ? { auth: { user: { id: opts.userId } } } : {},
        __params: opts.id !== undefined ? { id: opts.id } : undefined,
        __body: opts.body,
    }
}

describe('POST /api/v1/assistant/contract/reviews/:id/export-pdf handler', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // 默认让 guard 通过：mock review 归属于 userId=10
        mockGetReview.mockResolvedValue({ id: 1, userId: 10, status: 'completed' } as any)
    })

    it('未登录返回 401', async () => {
        const res: any = await handler(
            makeEvent({ id: '1', body: { includeRisks: true } }) as any,
        )
        expect(res.code).toBe(401)
        expect(mockExport).not.toHaveBeenCalled()
    })

    it('reviewId 非正整数返回 400', async () => {
        const res: any = await handler(
            makeEvent({ userId: 10, id: 'abc', body: { includeRisks: true } }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockExport).not.toHaveBeenCalled()
    })

    it('body includeRisks 非 boolean 返回 400', async () => {
        const res: any = await handler(
            makeEvent({ userId: 10, id: '1', body: { includeRisks: 'yes' } }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockExport).not.toHaveBeenCalled()
    })

    it('body 含未识别字段返回 400（zod strict）', async () => {
        const res: any = await handler(
            makeEvent({
                userId: 10,
                id: '1',
                body: { includeRisks: true, extra: 'x' },
            }) as any,
        )
        expect(res.code).toBe(400)
        expect(mockExport).not.toHaveBeenCalled()
    })

    it('service 抛 review not found 返回 404', async () => {
        mockExport.mockRejectedValueOnce(new Error('review not found'))
        const res: any = await handler(
            makeEvent({ userId: 10, id: '1', body: { includeRisks: false } }) as any,
        )
        expect(res.code).toBe(404)
    })

    it('service 抛其他异常返回 500', async () => {
        mockExport.mockRejectedValueOnce(new Error('pdf render boom'))
        const res: any = await handler(
            makeEvent({ userId: 10, id: '1', body: { includeRisks: false } }) as any,
        )
        expect(res.code).toBe(500)
    })

    it('正常路径：返回 PDF Buffer 且设置 Content-Type', async () => {
        const fakeBuf = Buffer.from('%PDF-1.3\nfake-content')
        mockGetReview.mockResolvedValueOnce({ id: 42, userId: 10, status: 'completed' } as any)
        mockExport.mockResolvedValueOnce(fakeBuf)
        const event = makeEvent({
            userId: 10,
            id: '42',
            body: { includeRisks: true },
        }) as any
        const res: any = await handler(event)
        expect(res).toBe(fakeBuf)
        expect(res.subarray(0, 4).toString()).toBe('%PDF')
        expect(event.__headers?.['Content-Type']).toBe('application/pdf')
        expect(event.__headers?.['Content-Disposition']).toBe(
            'attachment; filename="contract-review-42.pdf"',
        )
        expect(mockExport).toHaveBeenCalledWith(42, 10, { includeRisks: true })
    })
})
