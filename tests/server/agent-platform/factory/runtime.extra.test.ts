/**
 * runtime.ts 补充覆盖测试
 *
 * 验证：
 * - wrapStreamWithAfterRun：成功路径 / 流抛错路径 / cancel 路径，afterRun 都被调用
 * - runStateGraphAgent：runStateGraph 缺失时抛错（在 defineDomainAgent 入参校验未拦住的极端情况）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runDomainAgent, runStateGraphAgent } from '~~/server/services/agent-platform/factory/runtime'
import type { DomainAgentDefinition } from '~~/server/services/agent-platform/factory/types'
import { SessionScope } from '#shared/types/agentEvent'

// 全部下游依赖 mock
const { errorSpy, infoSpy } = vi.hoisted(() => ({
    errorSpy: vi.fn(),
    infoSpy: vi.fn(),
}))
vi.mock('#shared/utils/logger', () => ({
    logger: { error: errorSpy, info: infoSpy, warn: vi.fn(), debug: vi.fn() },
    // server/lib/oss/headFile.ts 用 createLogger('oss:head') 拿子 logger（commit 391b/storage 兜底链路）
    createLogger: () => ({ error: errorSpy, info: infoSpy, warn: vi.fn(), debug: vi.fn() }),
}))
;(globalThis as any).logger = { error: errorSpy, info: infoSpy, warn: vi.fn(), debug: vi.fn() }

vi.mock('~~/server/services/agent-platform/nodeConfig/loader', () => ({
    getNodeConfigCached: vi.fn(),
    invalidateNodeConfigCache: vi.fn(),
}))
vi.mock('~~/server/services/agent-platform/nodeConfig/promptRenderer', () => ({
    renderSystemPrompt: vi.fn(() => 'sys'),
}))
vi.mock('~~/server/services/agent-platform/modelFactory', () => ({
    createChatModel: vi.fn(() => ({ _m: 1 })),
}))
vi.mock('~~/server/services/agent-platform/checkpointer', () => ({
    getCheckpointer: vi.fn().mockResolvedValue({ _ckp: true }),
    getStore: vi.fn().mockResolvedValue({ _st: true }),
}))
vi.mock('~~/server/services/agent-platform/middleware/skills', () => ({
    buildSkillsMiddlewareForNode: vi.fn().mockResolvedValue(null),
}))
vi.mock('~~/server/services/agent-platform/context/messageCompressor', () => ({
    resolveContextWindow: vi.fn(() => ({ triggerTokens: 30000, maxTokens: 100000, maxOutputTokens: 8192 })),
}))
vi.mock('~~/server/services/agent-platform/tools/index', () => ({
    getToolInstancesService: vi.fn(() => []),
}))
vi.mock('~~/server/services/agent-platform/middleware/index', () => ({
    buildMiddlewareStack: vi.fn(() => []),
    MIDDLEWARE_PRIORITY: { MESSAGE_INTEGRITY: 1, SCOPE_GUARD: 5, TOOL_CALL_LIMIT: 7, POINT_CONSUMPTION: 20, SUMMARIZATION: 40, SAFETY_TRIM: 50, SKILLS_DISCOVERY: 60, AUDIT: 100 },
    MIDDLEWARE_NAMES: { MESSAGE_INTEGRITY: 'mi', SCOPE_GUARD: 'sg', TOOL_CALL_LIMIT: 'tcl', POINT_CONSUMPTION: 'pc', SUMMARIZATION: 'sum', SAFETY_TRIM: 'st', SKILLS_DISCOVERY: 'sk', AUDIT: 'au' },
    pointConsumptionMiddleware: vi.fn(() => ({})),
    safetyTrimMiddleware: vi.fn(() => ({})),
    createScopeGuardMiddleware: vi.fn(() => ({})),
    createAuditMiddleware: vi.fn(() => ({})),
    createToolCallLimitMiddlewares: vi.fn(() => []),
    createMessageIntegrityMiddleware: vi.fn(() => ({})),
}))
vi.mock('langchain', () => ({
    createAgent: vi.fn(),
    summarizationMiddleware: vi.fn(() => ({})),
}))
vi.mock('~~/server/services/agent-platform/tools/readSkillFile.tool', () => ({
    createTool: vi.fn(() => ({ name: 'r' })),
}))
vi.mock('~~/server/services/agent-platform/tools/writeSkillFile.tool', () => ({
    createTool: vi.fn(() => ({ name: 'w' })),
}))
vi.mock('~~/server/services/agent-platform/tools/runSkillScript.tool', () => ({
    createTool: vi.fn(() => ({ name: 's' })),
}))
vi.mock('~~/server/services/agent-platform/tools/runSkillCommand.tool', () => ({
    createTool: vi.fn(() => ({ name: 'c' })),
}))
vi.mock('~~/server/services/agent-platform/sse/customEventEmitter', () => ({
    createCustomEventEmitter: vi.fn(() => vi.fn()),
}))

const mockNodeConfig = {
    id: 1, name: 'n', title: 't', type: 'agent', tools: [],
    prompts: [], modelName: 'm', modelSdkType: 'openai', modelStatus: 1,
    modelProviderBaseUrl: '', modelApiKeys: [{ id: 1, apiKey: 'k', status: 1 }],
    modelContextWindow: 8000, modelMaxOutputTokens: 2000,
} as any

const baseCtx: any = {
    runId: 'run-1', sessionId: 'sess-1', userId: 1, caseId: null,
    message: 'hi', command: undefined, signal: undefined,
}

beforeEach(() => {
    vi.clearAllMocks()
})

describe('wrapStreamWithAfterRun', () => {
    async function setupAgent(streamSource: ReadableStream) {
        const { getNodeConfigCached } = await import('~~/server/services/agent-platform/nodeConfig/loader')
        ;(getNodeConfigCached as any).mockResolvedValue(mockNodeConfig)
        const { createAgent } = await import('langchain')
        ;(createAgent as any).mockReturnValue({
            stream: vi.fn().mockResolvedValue(streamSource),
        })
    }

    it('正常 drain：afterRun 收到 success=true', async () => {
        const inner = new ReadableStream<Uint8Array>({
            start(c) {
                c.enqueue(new TextEncoder().encode('chunk1'))
                c.close()
            },
        })
        await setupAgent(inner)

        const afterRun = vi.fn().mockResolvedValue(undefined)
        const def: DomainAgentDefinition = {
            scope: SessionScope.DOCUMENT,
            agentType: 'createAgent',
            nodeName: 'n',
            hooks: { afterRun },
        }

        const wrapped = await runDomainAgent(def, baseCtx)
        const reader = wrapped.getReader()
        await reader.read()
        await reader.read()
        await new Promise(r => setTimeout(r, 10))
        expect(afterRun).toHaveBeenCalledWith(baseCtx, true)
    })

    it('内部流抛错：afterRun 收到 success=false', async () => {
        const inner = new ReadableStream<Uint8Array>({
            start(c) {
                c.enqueue(new TextEncoder().encode('chunk1'))
                c.error(new Error('inner stream broken'))
            },
        })
        await setupAgent(inner)

        const afterRun = vi.fn().mockResolvedValue(undefined)
        const def: DomainAgentDefinition = {
            scope: SessionScope.DOCUMENT,
            agentType: 'createAgent',
            nodeName: 'n',
            hooks: { afterRun },
        }

        const wrapped = await runDomainAgent(def, baseCtx)
        const reader = wrapped.getReader()
        try {
            // 第一次读到 chunk1
            await reader.read()
            // 第二次抛错
            await reader.read()
        } catch { /* expected */ }
        await new Promise(r => setTimeout(r, 10))
        expect(afterRun).toHaveBeenCalledWith(baseCtx, false)
    })

    it('cancel 路径：afterRun 收到 success=false', async () => {
        const inner = new ReadableStream<Uint8Array>({
            start(c) {
                c.enqueue(new TextEncoder().encode('keep streaming'))
                // 不主动 close，让消费方 cancel
            },
        })
        await setupAgent(inner)

        const afterRun = vi.fn().mockResolvedValue(undefined)
        const def: DomainAgentDefinition = {
            scope: SessionScope.DOCUMENT,
            agentType: 'createAgent',
            nodeName: 'n',
            hooks: { afterRun },
        }

        const wrapped = await runDomainAgent(def, baseCtx)
        await wrapped.cancel()
        await new Promise(r => setTimeout(r, 10))
        expect(afterRun).toHaveBeenCalledWith(baseCtx, false)
    })

    it('afterRun 抛错：被 catch 后 logger.error，不影响主流', async () => {
        const inner = new ReadableStream<Uint8Array>({
            start(c) { c.close() },
        })
        await setupAgent(inner)

        const afterRun = vi.fn().mockRejectedValue(new Error('afterRun 内部错'))
        const def: DomainAgentDefinition = {
            scope: SessionScope.DOCUMENT,
            agentType: 'createAgent',
            nodeName: 'n',
            hooks: { afterRun },
        }

        const wrapped = await runDomainAgent(def, baseCtx)
        await wrapped.getReader().read()
        await new Promise(r => setTimeout(r, 10))
        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('afterRun 钩子执行失败'),
            expect.any(Error),
        )
    })
})

describe('runStateGraphAgent 防御性分支', () => {
    it('def.runStateGraph 缺失时抛错', async () => {
        const def: any = {
            scope: SessionScope.CONTRACT,
            agentType: 'stateGraph',
            nodeName: 'n',
            // runStateGraph 故意不传
        }
        await expect(runStateGraphAgent(def, baseCtx))
            .rejects.toThrow(/未提供 runStateGraph/)
    })

    it('runStateGraph 抛错时 afterRun 被调用 success=false 后 rethrow', async () => {
        const { getNodeConfigCached } = await import('~~/server/services/agent-platform/nodeConfig/loader')
        ;(getNodeConfigCached as any).mockResolvedValue(mockNodeConfig)

        const afterRun = vi.fn().mockResolvedValue(undefined)
        const def: DomainAgentDefinition = {
            scope: SessionScope.CONTRACT,
            agentType: 'stateGraph',
            nodeName: 'n',
            runStateGraph: vi.fn().mockRejectedValue(new Error('biz boom')),
            hooks: { afterRun },
        }

        await expect(runStateGraphAgent(def, baseCtx)).rejects.toThrow('biz boom')
        expect(afterRun).toHaveBeenCalledWith(expect.any(Object), false)
        expect(errorSpy).toHaveBeenCalledWith(
            '[runStateGraphAgent] business throw',
            expect.objectContaining({ error: 'biz boom' }),
        )
    })
})
