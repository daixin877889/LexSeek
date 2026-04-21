/**
 * Agent 审计日志管理端 API 测试
 *
 * Feature: agent-security-guardrails
 * Validates: spec §4.6
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { uuidv7 } from '~~/shared/utils/uuid'

;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).getQuery = (event: any) => event.__query ?? {}
;(globalThis as any).getRouterParam = (event: any, key: string) => event.__params?.[key]
;(globalThis as any).readBody = async (event: any) => event.__body
;(globalThis as any).resSuccess = (_e: any, message: string, data: any) => ({ code: 0, success: true, message, data })
;(globalThis as any).resError = (_e: any, code: number, message: string) => ({ code, success: false, message, data: null })
;(globalThis as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }

const { default: listHandler } = await import('../../../server/api/v1/admin/agent-audit-logs/index.get')
const { default: detailHandler } = await import('../../../server/api/v1/admin/agent-audit-logs/[id].get')

function makeEvent(opts: {
    query?: Record<string, string | number>
    params?: Record<string, string>
    body?: Record<string, unknown>
} = {}) {
    return {
        context: {},
        __query: opts.query ?? {},
        __params: opts.params ?? {},
        __body: opts.body ?? {},
    } as any
}

describe('GET /api/v1/admin/agent-audit-logs', () => {
    beforeEach(async () => {
        await prisma.agentToolAuditLogs.deleteMany({ where: { userId: { in: [9001, 9002] } } })
        await prisma.agentToolAuditLogs.createMany({
            data: [
                { id: uuidv7(), userId: 9002, sessionId: 'sA', toolName: 'read_skill_file', verdict: 'allowed', argsDigest: { path: 'a' }, latencyMs: 10 },
                { id: uuidv7(), userId: 9002, sessionId: 'sA', toolName: 'read_skill_file', verdict: 'denied', denyReason: '非法路径', argsDigest: { path: '..' }, latencyMs: 8 },
                { id: uuidv7(), userId: 9002, sessionId: 'sB', toolName: 'search_law', verdict: 'allowed', argsDigest: { query: 'x' }, latencyMs: 12 },
            ],
        })
    })

    afterEach(async () => {
        await prisma.agentToolAuditLogs.deleteMany({ where: { userId: { in: [9001, 9002] } } })
    })

    it('列表返回 items + total + page + pageSize（成功响应 code: 0）', async () => {
        const event = makeEvent({ query: { page: 1, pageSize: 20 } })
        const res = await listHandler(event)
        expect(res).toMatchObject({
            code: 0,
            success: true,
            data: {
                items: expect.any(Array),
                total: expect.any(Number),
                page: 1,
                pageSize: 20,
            },
        })
    })

    it('verdict 筛选：只返回 denied', async () => {
        const event = makeEvent({ query: { page: 1, pageSize: 20, verdict: 'denied' } })
        const res = await listHandler(event)
        expect(res.data.items.every((x: any) => x.verdict === 'denied')).toBe(true)
    })

    it('非法 verdict 参数返回 400', async () => {
        const event = makeEvent({ query: { page: 1, pageSize: 20, verdict: 'invalid' } })
        const res = await listHandler(event)
        expect(res.code).toBe(400)
    })
})

describe('GET /api/v1/admin/agent-audit-logs/:id', () => {
    let testId: string
    beforeEach(async () => {
        testId = uuidv7()
        await prisma.agentToolAuditLogs.create({
            data: { id: testId, userId: 9002, sessionId: 's1', toolName: 'read_skill_file', verdict: 'allowed', argsDigest: { path: 'a' }, latencyMs: 10 },
        })
    })
    afterEach(async () => {
        await prisma.agentToolAuditLogs.deleteMany({ where: { userId: 9002 } })
    })

    it('返回单条完整记录', async () => {
        const event = makeEvent({ params: { id: testId } })
        const res = await detailHandler(event)
        expect(res.code).toBe(0)
        expect(res.data.id).toBe(testId)
    })

    it('不存在的 id 返回 404', async () => {
        const event = makeEvent({ params: { id: uuidv7() } })
        const res = await detailHandler(event)
        expect(res.code).toBe(404)
    })

    it('非 UUID 的 id 返回 400', async () => {
        const event = makeEvent({ params: { id: 'not-uuid' } })
        const res = await detailHandler(event)
        expect(res.code).toBe(400)
    })
})
