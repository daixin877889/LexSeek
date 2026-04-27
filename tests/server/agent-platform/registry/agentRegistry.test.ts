import { describe, it, expect, beforeEach } from 'vitest'
import { AgentRegistry } from '~~/server/services/agent-platform/registry/agentRegistry'
import type { AgentRunnerContext } from '~~/server/services/agent-platform/registry/types'
import { SessionScope, SessionType } from '#shared/types/agentEvent'

function makeStream(): ReadableStream {
    return new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode('event: values\ndata: {}\n\n'))
            controller.close()
        },
    })
}

const mockCtx: AgentRunnerContext = {
    runId: 'r1',
    sessionId: 's1',
    userId: 1,
    caseId: null,
    message: 'hi',
    command: undefined,
    thinking: false,
    selectedModules: [],
    signal: new AbortController().signal,
}

describe('AgentRegistry', () => {
    let registry: AgentRegistry

    beforeEach(() => {
        registry = new AgentRegistry()
    })

    it('register / dispatch 通过 scope 路由', async () => {
        registry.register({
            scope: SessionScope.DOCUMENT,
            runner: async () => makeStream(),
            description: 'document',
        })

        const stream = await registry.dispatch(
            { scope: SessionScope.DOCUMENT, type: null, caseId: null, userId: 1 },
            mockCtx,
        )
        expect(stream).toBeInstanceOf(ReadableStream)
    })

    it('case 域按 type 二级路由（type 优先级高于 scope-only）', async () => {
        const calls: string[] = []
        registry.register({
            scope: SessionScope.CASE,
            runner: async () => { calls.push('case-default'); return makeStream() },
        })
        registry.register({
            scope: SessionScope.CASE,
            type: SessionType.MODULE,
            runner: async () => { calls.push('case-module'); return makeStream() },
        })

        await registry.dispatch({ scope: SessionScope.CASE, type: SessionType.MODULE, caseId: 1, userId: 1 }, mockCtx)
        expect(calls).toEqual(['case-module'])

        await registry.dispatch({ scope: SessionScope.CASE, type: SessionType.CHAT, caseId: 1, userId: 1 }, mockCtx)
        expect(calls).toEqual(['case-module', 'case-default'])
    })

    it('未注册 scope 时 dispatch 抛错', async () => {
        await expect(
            registry.dispatch({ scope: SessionScope.ASSISTANT, type: null, caseId: null, userId: 1 }, mockCtx),
        ).rejects.toThrow(/未注册/)
    })

    it('重复注册同 (scope, type) 抛错', () => {
        registry.register({ scope: SessionScope.DOCUMENT, runner: async () => makeStream() })
        expect(() =>
            registry.register({ scope: SessionScope.DOCUMENT, runner: async () => makeStream() }),
        ).toThrow(/已注册/)
    })

    it('list 返回所有已注册 entry', () => {
        registry.register({ scope: SessionScope.DOCUMENT, runner: async () => makeStream() })
        registry.register({ scope: SessionScope.ASSISTANT, runner: async () => makeStream() })
        const entries = registry.list()
        expect(entries).toHaveLength(2)
    })

    it('has 检查注册存在', () => {
        registry.register({ scope: SessionScope.CONTRACT, runner: async () => makeStream() })
        expect(registry.has({ scope: SessionScope.CONTRACT })).toBe(true)
        expect(registry.has({ scope: SessionScope.DOCUMENT })).toBe(false)
    })
})

// TODO(stage8): registerLegacyRunners 已删除（caseAnalysisAgent vertical 替代）。
// 原"幂等性测试"已无意义（函数和文件都已物理删除），整段移除。
// vertical 注册的幂等性由 defineDomainAgent 内部的 agentRegistry.register
// 在重复注册时抛错（"已注册"）保证——见上面 "重复注册同 (scope, type) 抛错" 用例。
