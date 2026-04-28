/**
 * scopeGuard middleware 单测
 *
 * 验证：
 * - 黑名单扫描：字符串 / 数组 / 对象 / 多层嵌套
 * - 路径校验：read_skill_file / write_skill_file / upload_workspace_file
 * - search_case_materials draftId 与 context 不一致
 * - 放行：参数合法走 handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }))
vi.mock('#shared/utils/logger', () => ({
    logger: { info: vi.fn(), error: vi.fn(), warn: warnSpy, debug: vi.fn() },
}))
;(globalThis as any).logger = { info: vi.fn(), error: vi.fn(), warn: warnSpy, debug: vi.fn() }

import { createScopeGuardMiddleware } from '~~/server/services/agent-platform/middleware/scopeGuard.middleware'
import { ToolMessage } from '@langchain/core/messages'

beforeEach(() => {
    vi.clearAllMocks()
})

/** 调用 wrapToolCall 钩子并返回结果或 handler 透传值 */
async function invokeWrap(toolName: string, args: any, context: any, options?: { handlerReturn?: any }) {
    const mw = createScopeGuardMiddleware()
    const handler = vi.fn().mockResolvedValue(options?.handlerReturn ?? { _passed: true })
    const request = {
        toolCall: { name: toolName, args, id: 'tc-1' },
        runtime: { context },
    }
    const result = await (mw as any).wrapToolCall(request, handler)
    return { result, handler }
}

describe('黑名单扫描', () => {
    it('字符串参数中含 ChatML token 时拒绝', async () => {
        const { result, handler } = await invokeWrap('any_tool', { input: 'hello <|im_start|> world' }, { userId: 1, sessionId: 's' })
        expect(result).toBeInstanceOf(ToolMessage)
        expect((result as ToolMessage).content).toContain('参数包含可疑内容')
        expect(handler).not.toHaveBeenCalled()
        expect(warnSpy).toHaveBeenCalledWith(
            'scopeGuard 拦截污染标记',
            expect.objectContaining({ token: '<|im_start|>' }),
        )
    })

    it('数组深处含 [INST] 时拒绝', async () => {
        const { result } = await invokeWrap('any_tool', { items: [{ deep: ['safe', 'a [INST] b'] }] }, { userId: 1, sessionId: 's' })
        expect((result as ToolMessage).content).toContain('参数包含可疑内容')
    })

    it('普通字符串不被拦截', async () => {
        const { result, handler } = await invokeWrap('any_tool', { ok: 'normal text' }, { userId: 1, sessionId: 's' })
        expect(result).toEqual({ _passed: true })
        expect(handler).toHaveBeenCalledOnce()
    })

    it('null 值不抛错', async () => {
        const { result, handler } = await invokeWrap('any_tool', { foo: null }, { userId: 1, sessionId: 's' })
        expect(result).toEqual({ _passed: true })
        expect(handler).toHaveBeenCalledOnce()
    })

    it('数字、布尔等非字符串值跳过扫描', async () => {
        const { result } = await invokeWrap('any_tool', { age: 18, active: true }, { userId: 1, sessionId: 's' })
        expect(result).toEqual({ _passed: true })
    })
})

describe('read_skill_file / write_skill_file 路径校验', () => {
    it.each([
        ['绝对路径', '/etc/passwd'],
        ['路径遍历', 'a/../b'],
        ['NULL 字节', 'a\0b'],
    ])('read_skill_file: %s 拒绝', async (_label, path) => {
        const { result } = await invokeWrap('read_skill_file', { path }, { userId: 1, sessionId: 's' })
        expect((result as ToolMessage).content).toContain('非法路径')
    })

    it('write_skill_file: 路径非字符串时拒绝', async () => {
        const { result } = await invokeWrap('write_skill_file', { path: 12345 }, { userId: 1, sessionId: 's' })
        expect((result as ToolMessage).content).toContain('非法路径')
    })

    it('write_skill_file: 合法相对路径放行', async () => {
        const { handler } = await invokeWrap('write_skill_file', { path: 'lex/scripts/x.cjs', content: 'safe' }, { userId: 1, sessionId: 's' })
        expect(handler).toHaveBeenCalledOnce()
    })
})

describe('upload_workspace_file 路径校验', () => {
    it('绝对路径拒绝', async () => {
        const { result } = await invokeWrap('upload_workspace_file', { filePath: '/abs.txt' }, { userId: 1, sessionId: 's' })
        expect((result as ToolMessage).content).toContain('非法路径')
    })

    it('合法路径放行', async () => {
        const { handler } = await invokeWrap('upload_workspace_file', { filePath: 'sub/file.txt' }, { userId: 1, sessionId: 's' })
        expect(handler).toHaveBeenCalled()
    })
})

describe('search_case_materials draftId 校验', () => {
    it('draftId 与 context.draftId 不一致时拒绝', async () => {
        const { result } = await invokeWrap(
            'search_case_materials',
            { draftId: 99 },
            { userId: 1, sessionId: 's', draftId: 100 },
        )
        expect((result as ToolMessage).content).toContain('draftId 与当前会话 context 不一致')
    })

    it('draftId 与 context.draftId 一致时放行', async () => {
        const { handler } = await invokeWrap(
            'search_case_materials',
            { draftId: 100 },
            { userId: 1, sessionId: 's', draftId: 100 },
        )
        expect(handler).toHaveBeenCalled()
    })

    it('未传 draftId 参数时放行（无法伪造）', async () => {
        const { handler } = await invokeWrap(
            'search_case_materials',
            {},
            { userId: 1, sessionId: 's', draftId: 100 },
        )
        expect(handler).toHaveBeenCalled()
    })
})

describe('未配置规则的工具', () => {
    it('黑名单和无 rule 时直接放行', async () => {
        const { result, handler } = await invokeWrap('unknown_tool', { x: 'y' }, { userId: 1, sessionId: 's' })
        expect(result).toEqual({ _passed: true })
        expect(handler).toHaveBeenCalledOnce()
    })

    it('runtime.context 缺失时仍能走完流程（默认值）', async () => {
        const { handler } = await invokeWrap('any_tool', { x: 'y' }, undefined)
        expect(handler).toHaveBeenCalledOnce()
    })
})
