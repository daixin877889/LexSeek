/**
 * POST /api/v1/assistant/contract/reviews/:id/upload-version handler 分支测试
 *
 * 覆盖：
 *   - 401/403/404 经 loadOwnedReview 拦截，不开 SSE 流
 *   - 400 body ossFileId 非正整数
 *   - 409 busy 状态（reviewing）
 *   - happy path：AsyncGenerator 产出 progress/complete，handler 正确推 SSE 事件
 *   - service 抛异常：handler 推 upload-version-error 并关流
 *
 * **Feature: contract-review-versioning-phase-b**
 * **Validates: Task 1.6**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ==================== 全局 Stub（模拟 Nuxt nitro 自动导入）====================

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
;(globalThis as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }

// ==================== Mock h3 createEventStream ====================

vi.mock('h3', async (importActual) => {
    const actual = await importActual<typeof import('h3')>()
    return {
        ...actual,
        createEventStream: vi.fn(() => {
            const pushed: Array<{ event: string; data: string }> = []
            return {
                __pushed: pushed,
                push: vi.fn(async (e: { event: string; data: string }) => {
                    pushed.push(e)
                }),
                close: vi.fn(async () => {}),
                send: vi.fn(() => 'SSE_SEND_RESULT'),
            }
        }),
    }
})

// ==================== Mock guard + service ====================

vi.mock('~~/server/services/assistant/contract/reviewGuard', () => ({
    loadOwnedReview: vi.fn(),
}))

vi.mock('~~/server/services/assistant/contract/uploadClientVersion.service', () => ({
    uploadClientVersionService: vi.fn(),
}))

// loadOwnedReview 内部依赖 contractReview.dao；
// 因为 reviewGuard 整体被 mock，这里不需要单独 mock DAO。
import { loadOwnedReview } from '~~/server/services/assistant/contract/reviewGuard'
import { uploadClientVersionService } from '~~/server/services/assistant/contract/uploadClientVersion.service'
import { createEventStream } from 'h3'

const mockLoadOwnedReview = loadOwnedReview as ReturnType<typeof vi.fn>
const mockUploadService = uploadClientVersionService as ReturnType<typeof vi.fn>
const mockCreateEventStream = createEventStream as ReturnType<typeof vi.fn>

// ==================== 动态 import handler（必须在 mock 之后）====================

const { default: handler } = await import(
    '../../../../server/api/v1/assistant/contract/reviews/[id]/upload-version.post'
)

// ==================== 工具函数 ====================

interface MockEvent {
    context: { auth?: { user: { id: number } } }
    __params?: Record<string, string>
    __body?: unknown
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

const USER_ID = 10

/** 构造一个守卫通过的 review 对象 */
function makeReview(overrides: Record<string, unknown> = {}) {
    return { id: 1, userId: USER_ID, status: 'completed', ...overrides } as any
}

/** 等待 handler 内部的异步 generator 消费完毕（eventStream 关闭） */
async function waitForStreamClose(eventStreamMock: ReturnType<typeof mockCreateEventStream>) {
    // close 是 spy；等到它被调用即代表 generator 跑完
    await vi.waitFor(() => {
        expect(eventStreamMock.close).toHaveBeenCalled()
    }, { timeout: 2000 })
}

// ==================== 测试套件 ====================

describe('POST /api/v1/assistant/contract/reviews/:id/upload-version handler', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // 默认 guard 通过
        mockLoadOwnedReview.mockResolvedValue({ ok: true, user: { id: USER_ID }, review: makeReview() })
    })

    // ── 鉴权/归属校验分支 ──────────────────────────────────────────

    it('loadOwnedReview 返回 401 时不开流直接返回错误', async () => {
        mockLoadOwnedReview.mockResolvedValue({ ok: false, status: 401, message: '请先登录' })
        const res: any = await handler(makeEvent({ body: { ossFileId: 1 } }) as any)
        expect(res.code).toBe(401)
        expect(mockCreateEventStream).not.toHaveBeenCalled()
    })

    it('loadOwnedReview 返回 403 时不开流直接返回错误', async () => {
        mockLoadOwnedReview.mockResolvedValue({ ok: false, status: 403, message: '无权上传新版本' })
        const res: any = await handler(makeEvent({ userId: USER_ID, id: '99', body: { ossFileId: 1 } }) as any)
        expect(res.code).toBe(403)
        expect(mockCreateEventStream).not.toHaveBeenCalled()
    })

    it('loadOwnedReview 返回 404 时不开流直接返回错误', async () => {
        mockLoadOwnedReview.mockResolvedValue({ ok: false, status: 404, message: '合同审查不存在' })
        const res: any = await handler(makeEvent({ userId: USER_ID, id: '999', body: { ossFileId: 1 } }) as any)
        expect(res.code).toBe(404)
        expect(mockCreateEventStream).not.toHaveBeenCalled()
    })

    // ── 409 busy 状态拦截 ──────────────────────────────────────────

    it.each(['pending', 'reviewing', 'awaiting_stance', 'rebuilding'])(
        'review.status=%s 时返回 409 不开流',
        async (busyStatus) => {
            mockLoadOwnedReview.mockResolvedValue({
                ok: true,
                user: { id: USER_ID },
                review: makeReview({ status: busyStatus }),
            })
            const res: any = await handler(makeEvent({ userId: USER_ID, id: '1', body: { ossFileId: 1 } }) as any)
            expect(res.code).toBe(409)
            expect(res.message).toContain('审查进行中')
            expect(mockCreateEventStream).not.toHaveBeenCalled()
        },
    )

    // ── body 校验分支 ──────────────────────────────────────────────

    it('ossFileId 缺失时返回 400 不开流', async () => {
        const res: any = await handler(makeEvent({ userId: USER_ID, id: '1', body: {} }) as any)
        expect(res.code).toBe(400)
        expect(mockCreateEventStream).not.toHaveBeenCalled()
    })

    it('ossFileId 为字符串时返回 400 不开流', async () => {
        const res: any = await handler(makeEvent({ userId: USER_ID, id: '1', body: { ossFileId: 'abc' } }) as any)
        expect(res.code).toBe(400)
        expect(mockCreateEventStream).not.toHaveBeenCalled()
    })

    it('ossFileId 为 0 时返回 400（非正整数）', async () => {
        const res: any = await handler(makeEvent({ userId: USER_ID, id: '1', body: { ossFileId: 0 } }) as any)
        expect(res.code).toBe(400)
        expect(mockCreateEventStream).not.toHaveBeenCalled()
    })

    it('ossFileId 为负数时返回 400（非正整数）', async () => {
        const res: any = await handler(makeEvent({ userId: USER_ID, id: '1', body: { ossFileId: -1 } }) as any)
        expect(res.code).toBe(400)
        expect(mockCreateEventStream).not.toHaveBeenCalled()
    })

    // ── happy path ────────────────────────────────────────────────

    it('happy path：AsyncGenerator 产出 progress+complete，handler 正确推 SSE 事件并关流', async () => {
        const review = makeReview({ id: 42 })
        mockLoadOwnedReview.mockResolvedValue({ ok: true, user: { id: USER_ID }, review })

        // 模拟 AsyncGenerator
        async function* fakeGenerator() {
            yield { type: 'progress' as const, data: { step: 'backup' as const, status: 'done' as const } }
            yield { type: 'progress' as const, data: { step: 'parse' as const, status: 'done' as const } }
            yield { type: 'progress' as const, data: { step: 'diff' as const, status: 'done' as const } }
            yield { type: 'progress' as const, data: { step: 'ai' as const, status: 'done' as const } }
            yield { type: 'progress' as const, data: { step: 'merge' as const, status: 'done' as const } }
            yield { type: 'complete' as const, data: { newVersionId: 10, summary: '处理完成' } }
        }
        mockUploadService.mockReturnValue(fakeGenerator())

        const event = makeEvent({ userId: USER_ID, id: '42', body: { ossFileId: 5 } }) as any
        const result = await handler(event)

        // handler 立即返回 send() 的结果
        expect(result).toBe('SSE_SEND_RESULT')
        expect(mockCreateEventStream).toHaveBeenCalledOnce()

        const streamMock = mockCreateEventStream.mock.results[0].value
        await waitForStreamClose(streamMock)

        expect(streamMock.push).toHaveBeenCalledTimes(6)

        // 前 5 条是 progress
        for (let i = 0; i < 5; i++) {
            expect(streamMock.__pushed[i].event).toBe('upload-version-progress')
        }
        // 最后一条是 complete
        expect(streamMock.__pushed[5].event).toBe('upload-version-complete')
        const completeData = JSON.parse(streamMock.__pushed[5].data)
        expect(completeData.newVersionId).toBe(10)

        // service 调用参数正确
        expect(mockUploadService).toHaveBeenCalledWith({
            review,
            ossFileId: 5,
            userId: USER_ID,
        })
    })

    it('Generator 产出 error 事件后 handler 关流', async () => {
        async function* fakeGenerator() {
            yield { type: 'progress' as const, data: { step: 'backup' as const, status: 'done' as const } }
            yield {
                type: 'error' as const,
                data: { step: 'parse' as const, code: 'PARSE_FAILED', message: '解析失败' },
            }
        }
        mockUploadService.mockReturnValue(fakeGenerator())

        const event = makeEvent({ userId: USER_ID, id: '1', body: { ossFileId: 3 } }) as any
        const result = await handler(event)
        expect(result).toBe('SSE_SEND_RESULT')

        const streamMock = mockCreateEventStream.mock.results[0].value
        await waitForStreamClose(streamMock)

        expect(streamMock.__pushed[1].event).toBe('upload-version-error')
        const errData = JSON.parse(streamMock.__pushed[1].data)
        expect(errData.code).toBe('PARSE_FAILED')
    })

    // ── service 抛出异常 ──────────────────────────────────────────

    it('service 同步抛异常：handler 推 upload-version-error 事件并关流', async () => {
        async function* fakeGenerator() {
            throw new Error('意外崩溃')
            // eslint-disable-next-line no-unreachable
            yield { type: 'progress' as const, data: { step: 'backup' as const, status: 'done' as const } }
        }
        mockUploadService.mockReturnValue(fakeGenerator())

        const event = makeEvent({ userId: USER_ID, id: '1', body: { ossFileId: 2 } }) as any
        const result = await handler(event)
        expect(result).toBe('SSE_SEND_RESULT')

        const streamMock = mockCreateEventStream.mock.results[0].value
        await waitForStreamClose(streamMock)

        expect(streamMock.__pushed).toHaveLength(1)
        expect(streamMock.__pushed[0].event).toBe('upload-version-error')
        const errData = JSON.parse(streamMock.__pushed[0].data)
        expect(errData.code).toBe('INTERNAL')
        expect(errData.message).toBe('服务器内部错误')
    })
})
