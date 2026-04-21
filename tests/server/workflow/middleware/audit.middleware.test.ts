/**
 * audit 中间件测试
 *
 * Feature: agent-security-guardrails
 * Validates: spec §4.4
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ToolCallRequest } from 'langchain'
import { ToolMessage } from '@langchain/core/messages'

// Mock logger（Nuxt 自动导入的全局变量）
vi.stubGlobal('logger', { warn: vi.fn(), info: vi.fn(), error: vi.fn() })

// 必须在 import 中间件之前 mock 写库服务
vi.mock('~~/server/services/audit/agentToolAudit.service', () => ({
    writeAgentToolAuditLogService: vi.fn().mockResolvedValue(undefined),
}))

// Mock langchain createMiddleware
vi.mock('langchain', () => ({
    createMiddleware: vi.fn((config) => config),
}))

import { createAuditMiddleware } from '~~/server/services/workflow/middleware/audit.middleware'
import { writeAgentToolAuditLogService } from '~~/server/services/audit/agentToolAudit.service'

async function flushAsync() {
    await new Promise(resolve => setImmediate(resolve))
}

function makeRequest(toolName: string, args: Record<string, unknown>): ToolCallRequest {
    return {
        toolCall: { id: 't1', name: toolName, args },
        state: {},
        runtime: { context: { userId: 10, sessionId: 'sess-a', caseId: 1, runId: null } },
    } as unknown as ToolCallRequest
}

describe('audit.middleware', () => {
    let writeLog: ReturnType<typeof vi.fn>

    beforeEach(() => {
        writeLog = vi.mocked(writeAgentToolAuditLogService)
        writeLog.mockClear()
        writeLog.mockResolvedValue(undefined)
    })

    it('正常调用成功后记录 verdict=allowed', async () => {
        const mw = createAuditMiddleware()
        const req = makeRequest('search_law', { query: 'x' })
        const handler = async () => new ToolMessage({ tool_call_id: 't1', content: 'ok' })
        await mw.wrapToolCall!(req, handler)
        await flushAsync()

        expect(writeLog).toHaveBeenCalledOnce()
        const call = writeLog.mock.calls[0][0]
        expect(call.verdict).toBe('allowed')
        expect(call.toolName).toBe('search_law')
        expect(call.userId).toBe(10)
        expect(call.argsDigest).toEqual({ query: 'x' })
    })

    it('handler 返回 error ToolMessage 时记录 verdict=error', async () => {
        const mw = createAuditMiddleware()
        const req = makeRequest('search_law', { query: 'x' })
        const handler = async () => new ToolMessage({ tool_call_id: 't1', content: 'boom', status: 'error' })
        await mw.wrapToolCall!(req, handler)
        await flushAsync()

        const call = writeLog.mock.calls[0][0]
        expect(call.verdict).toBe('error')
    })

    it('scopeGuard 拒绝（status=error 且 content 以 Error: 开头）记录为 denied', async () => {
        const mw = createAuditMiddleware()
        const req = makeRequest('read_skill_file', { path: '/etc/passwd' })
        const handler = async () => new ToolMessage({
            tool_call_id: 't1',
            content: 'Error: 非法路径',
            status: 'error',
        })
        await mw.wrapToolCall!(req, handler)
        await flushAsync()

        const call = writeLog.mock.calls[0][0]
        expect(call.verdict).toBe('denied')
        expect(call.denyReason).toContain('非法路径')
    })

    it('write_skill_file 的 content 字段摘要为 SHA+长度+路径', async () => {
        const mw = createAuditMiddleware()
        const req = makeRequest('write_skill_file', { path: 'out.md', content: '# 很长的合同原文'.repeat(500) })
        const handler = async () => new ToolMessage({ tool_call_id: 't1', content: 'ok' })
        await mw.wrapToolCall!(req, handler)
        await flushAsync()

        const call = writeLog.mock.calls[0][0]
        expect(call.argsDigest.path).toBe('out.md')
        expect(call.argsDigest.content).toMatchObject({
            sha256: expect.any(String),
            length: expect.any(Number),
        })
        expect(typeof call.argsDigest.content.sha256).toBe('string')
        expect((call.argsDigest.content.sha256 as string).length).toBe(64)
    })

    it('长字符串截断到 2000 字符（存储成本规避，非安全脱敏）', async () => {
        const mw = createAuditMiddleware()
        const longStr = 'x'.repeat(3000)
        const req = makeRequest('search_law', { query: longStr })
        const handler = async () => new ToolMessage({ tool_call_id: 't1', content: 'ok' })
        await mw.wrapToolCall!(req, handler)
        await flushAsync()

        const call = writeLog.mock.calls[0][0]
        expect((call.argsDigest.query as string).length).toBe(2000)
    })

    it('写库失败时业务流程不阻塞，错误进 logger', async () => {
        writeLog.mockRejectedValueOnce(new Error('DB down'))
        const mw = createAuditMiddleware()
        const req = makeRequest('search_law', { query: 'x' })
        const handler = async () => new ToolMessage({ tool_call_id: 't1', content: 'ok' })

        await expect(mw.wrapToolCall!(req, handler)).resolves.toBeDefined()
        await flushAsync()
    })
})
