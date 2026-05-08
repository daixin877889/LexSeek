/**
 * PATCH /api/v1/assistant/contract/reviews/risks/:riskId · zod .strict() 防御（spec §5.0 / PR 3）
 *
 * 仿 patchReview.api.test.ts 的真实 pattern：
 *  - 全局 stub H3 / resError / resSuccess（从 patchReview.api.test.ts 第 31-49 行复制）
 *  - vi.mock 替换 reviewGuard / contractRisk.service
 *  - 动态 import handler（必须在 mock 之后）
 *  - 构造 MockEvent 直接调 handler，不用 $fetch / setupTestApp
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ==================== 全局 Stub（模拟 Nuxt nitro 自动导入）====================
// 复制自 patchReview.api.test.ts 第 31-49 行

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
;(globalThis as any).readBody = (event: any) => Promise.resolve(event.__body)
;(globalThis as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }

// ==================== Mock 依赖层 ====================

vi.mock('~~/server/services/assistant/contract/reviewGuard', () => ({
    loadOwnedReviewByRiskId: vi.fn(async () => ({ ok: true, subId: 42 })),
}))

vi.mock('~~/server/services/assistant/contract/contractRisk.service', () => ({
    archiveContractRiskService: vi.fn(async (params: any) => ({
        id: params.riskId,
        archivedStatus: params.archivedStatus,
        archivedAt: new Date(),
    })),
}))

// ==================== 动态 import handler（必须在 mock 之后）====================

let patchHandler: any

beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../../../../server/api/v1/assistant/contract/reviews/risks/[riskId].patch')
    patchHandler = (mod as any).default
})

// ==================== 工具函数 ====================

function makeEvent(opts: { params?: Record<string, string>; body?: any }) {
    // __params / __body 对应全局 stub 中 getRouterParam / readBody 的取值方式
    // context 字段供 resSuccess / resError 读取 requestId（shared/utils/apiResponse.ts:35）
    return {
        context: { requestId: 'test-request-id' },
        __params: opts.params ?? {},
        __body: opts.body ?? {},
    }
}

// ==================== 测试用例 ====================

describe('PATCH risk · strict body（spec §5.0）', () => {
    it('合法 body：仅 archivedStatus → 成功', async () => {
        const res: any = await patchHandler(
            makeEvent({ params: { riskId: '42' }, body: { archivedStatus: 'handled' } }),
        )
        expect(res.code).toBe(0)
    })

    it('非法 body：传 clauseText（锚点字段）→ 400 拒绝', async () => {
        const res: any = await patchHandler(
            makeEvent({
                params: { riskId: '42' },
                body: { archivedStatus: null, clauseText: '律师改写的条款' },
            }),
        )
        expect(res.code).toBe(400)
        expect(res.message.toLowerCase()).toMatch(/unrecognized|clausetext/i)
    })
})
