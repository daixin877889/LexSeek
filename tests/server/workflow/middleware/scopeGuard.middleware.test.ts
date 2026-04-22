/**
 * scopeGuard 中间件测试
 *
 * Feature: agent-security-guardrails
 * Validates: spec §4.1 规则表
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { ToolCallRequest } from 'langchain'
import { createScopeGuardMiddleware } from '../../../../server/services/workflow/middleware/scopeGuard.middleware'

const SESSION_ID = 'sess-test-001'
const USER_ID = 42
const CASE_ID = 100
const DRAFT_ID = 200

function makeRequest(toolName: string, args: Record<string, unknown>): ToolCallRequest {
    return {
        toolCall: { id: 't1', name: toolName, args },
        state: {},
        runtime: { context: { userId: USER_ID, caseId: CASE_ID, draftId: DRAFT_ID, sessionId: SESSION_ID } },
    } as unknown as ToolCallRequest
}

describe('scopeGuard.middleware', () => {
    let middleware: ReturnType<typeof createScopeGuardMiddleware>
    let handlerCalled: number
    let handler: (req: ToolCallRequest) => Promise<unknown>

    beforeEach(() => {
        middleware = createScopeGuardMiddleware()
        handlerCalled = 0
        handler = async () => {
            handlerCalled += 1
            return { content: 'ok' }
        }
    })

    describe('read_skill_file 路径校验', () => {
        it('合法 _workspace 相对路径放行', async () => {
            const req = makeRequest('read_skill_file', { path: '_workspace/output.md' })
            await middleware.wrapToolCall!(req, handler as Parameters<typeof middleware.wrapToolCall!>[1])
            expect(handlerCalled).toBe(1)
        })

        it('绝对路径被拒', async () => {
            const req = makeRequest('read_skill_file', { path: '/etc/passwd' })
            const result = await middleware.wrapToolCall!(req, handler as Parameters<typeof middleware.wrapToolCall!>[1])
            expect(handlerCalled).toBe(0)
            expect(JSON.stringify(result)).toContain('非法路径')
        })

        it('`..` 路径穿越被拒', async () => {
            const req = makeRequest('read_skill_file', { path: 'skills/../../../etc/passwd' })
            const result = await middleware.wrapToolCall!(req, handler as Parameters<typeof middleware.wrapToolCall!>[1])
            expect(handlerCalled).toBe(0)
            expect(JSON.stringify(result)).toContain('非法路径')
        })

        it('NULL 字节（\\0）被拒', async () => {
            const req = makeRequest('read_skill_file', { path: 'a\0b' })
            const result = await middleware.wrapToolCall!(req, handler as Parameters<typeof middleware.wrapToolCall!>[1])
            expect(handlerCalled).toBe(0)
            expect(JSON.stringify(result)).toContain('非法路径')
        })
    })

    describe('upload_workspace_file 路径校验', () => {
        it('合法相对路径放行（skill 脚本产物也属合法来源）', async () => {
            const req = makeRequest('upload_workspace_file', { filePath: 'output.docx' })
            await middleware.wrapToolCall!(req, handler as Parameters<typeof middleware.wrapToolCall!>[1])
            expect(handlerCalled).toBe(1)
        })

        it('绝对路径被拒', async () => {
            const req = makeRequest('upload_workspace_file', { filePath: '/etc/passwd' })
            const result = await middleware.wrapToolCall!(req, handler as Parameters<typeof middleware.wrapToolCall!>[1])
            expect(handlerCalled).toBe(0)
            expect(JSON.stringify(result)).toContain('非法路径')
        })

        it('`..` 路径穿越被拒', async () => {
            const req = makeRequest('upload_workspace_file', { filePath: '../../etc/passwd' })
            const result = await middleware.wrapToolCall!(req, handler as Parameters<typeof middleware.wrapToolCall!>[1])
            expect(handlerCalled).toBe(0)
            expect(JSON.stringify(result)).toContain('非法路径')
        })
    })

    describe('search_case_materials draftId 越权', () => {
        it('参数 draftId 与 context.draftId 一致时放行', async () => {
            const req = makeRequest('search_case_materials', { query: 'X', draftId: DRAFT_ID })
            await middleware.wrapToolCall!(req, handler as Parameters<typeof middleware.wrapToolCall!>[1])
            expect(handlerCalled).toBe(1)
        })

        it('参数 draftId 与 context.draftId 不一致时拒绝', async () => {
            const req = makeRequest('search_case_materials', { query: 'X', draftId: 999 })
            const result = await middleware.wrapToolCall!(req, handler as Parameters<typeof middleware.wrapToolCall!>[1])
            expect(handlerCalled).toBe(0)
            expect(JSON.stringify(result)).toContain('draftId')
        })
    })

    describe('模板分隔符黑名单（对所有工具生效）', () => {
        it('参数值含 <|im_start|> 被拒', async () => {
            const req = makeRequest('search_law', { query: '正常 <|im_start|> 注入' })
            const result = await middleware.wrapToolCall!(req, handler as Parameters<typeof middleware.wrapToolCall!>[1])
            expect(handlerCalled).toBe(0)
            expect(JSON.stringify(result)).toContain('可疑内容')
        })

        it('中文法律文本"忽略前款约定"不被拦截', async () => {
            const req = makeRequest('search_law', { query: '第五条 忽略前款约定的情形' })
            await middleware.wrapToolCall!(req, handler as Parameters<typeof middleware.wrapToolCall!>[1])
            expect(handlerCalled).toBe(1)
        })

        it('英文合同片段 "System: Microsoft Windows 11" 不被拦截', async () => {
            const req = makeRequest('search_law', { query: 'System: Microsoft Windows 11 兼容性' })
            await middleware.wrapToolCall!(req, handler as Parameters<typeof middleware.wrapToolCall!>[1])
            expect(handlerCalled).toBe(1)
        })

        it('嵌套 JSON 中的污染亦被扫描', async () => {
            const req = makeRequest('write_skill_file', { path: 'a.md', content: 'x', meta: { inject: '<|endoftext|>' } })
            const result = await middleware.wrapToolCall!(req, handler as Parameters<typeof middleware.wrapToolCall!>[1])
            expect(handlerCalled).toBe(0)
            expect(JSON.stringify(result)).toContain('可疑内容')
        })
    })

    describe('schema 无身份字段的工具', () => {
        it('save_analysis_result 合法内容放行（仅黑名单生效）', async () => {
            const req = makeRequest('save_analysis_result', { analysisResult: '# 分析结论\n正常 markdown' })
            await middleware.wrapToolCall!(req, handler as Parameters<typeof middleware.wrapToolCall!>[1])
            expect(handlerCalled).toBe(1)
        })

        it('parse_and_ask_stance 空参数放行', async () => {
            const req = makeRequest('parse_and_ask_stance', {})
            await middleware.wrapToolCall!(req, handler as Parameters<typeof middleware.wrapToolCall!>[1])
            expect(handlerCalled).toBe(1)
        })
    })
})
