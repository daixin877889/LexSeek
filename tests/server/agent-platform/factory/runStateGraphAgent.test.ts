import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runStateGraphAgent } from '~~/server/services/agent-platform/factory/runtime'
import type { DomainAgentDefinition } from '~~/server/services/agent-platform/factory/types'
import type { AgentRunnerContext } from '~~/server/services/agent-platform/registry/types'
import { SessionScope } from '#shared/types/agentEvent'

// Mock platform deps
vi.mock('~~/server/services/agent-platform/nodeConfig/loader', () => ({
    getNodeConfigCached: vi.fn(),
    invalidateNodeConfigCache: vi.fn(),
}))

vi.mock('~~/server/services/agent/agentEventBridge', () => ({
    publishCustomEvent: vi.fn().mockResolvedValue(undefined),
}))

const mockNodeConfig = {
    id: 18,
    name: 'contractReviewMain',
    title: '合同审查主Agent',
    type: 'agent',
    tools: ['parse_and_ask_stance', 'search_law'],
    prompts: [{ type: 'system', status: 1, content: 'sys' }],
    modelName: 'm', modelSdkType: 'openai', modelStatus: 1,
    modelProviderId: 1, modelProviderBaseUrl: '', modelProviderName: 'p',
    modelApiKeys: [{ id: 1, apiKey: 'k', status: 1 }],
    modelContextWindow: 128000, modelMaxOutputTokens: 4096,
    outputSchema: null,
} as any

const baseCtx: AgentRunnerContext = {
    sessionId: 'sess-1',
    runId: 'run-1',
    userId: 1,
    caseId: null,
    message: 'hi',
    command: undefined,
    signal: undefined,
    metadata: {},
} as any

describe('runStateGraphAgent', () => {
    beforeEach(() => vi.clearAllMocks())

    it('注入 nodeConfig 与 emitCustomEvent 到 runStateGraph', async () => {
        const { getNodeConfigCached } = await import('~~/server/services/agent-platform/nodeConfig/loader')
        ;(getNodeConfigCached as any).mockResolvedValue(mockNodeConfig)

        const runStateGraph = vi.fn().mockResolvedValue(new ReadableStream())
        const def: DomainAgentDefinition = {
            scope: SessionScope.CONTRACT,
            agentType: 'stateGraph',
            nodeName: 'contractReviewMain',
            runStateGraph,
        }

        await runStateGraphAgent(def, baseCtx)

        expect(runStateGraph).toHaveBeenCalledTimes(1)
        const enhancedCtx = runStateGraph.mock.calls[0][0]
        expect(enhancedCtx.sessionId).toBe('sess-1')
        expect(enhancedCtx.nodeConfig).toBe(mockNodeConfig)
        expect(typeof enhancedCtx.emitCustomEvent).toBe('function')
    })

    it('emitCustomEvent 调用底层 publishCustomEvent 并绑定 runId/sessionId', async () => {
        const { getNodeConfigCached } = await import('~~/server/services/agent-platform/nodeConfig/loader')
        const { publishCustomEvent } = await import('~~/server/services/agent/agentEventBridge')
        ;(getNodeConfigCached as any).mockResolvedValue(mockNodeConfig)

        const runStateGraph = vi.fn(async (ctx: any) => {
            await ctx.emitCustomEvent({ name: 'foo', data: { x: 1 } })
            return new ReadableStream()
        })

        await runStateGraphAgent(
            { scope: SessionScope.CONTRACT, agentType: 'stateGraph', nodeName: 'contractReviewMain', runStateGraph },
            baseCtx,
        )

        expect(publishCustomEvent).toHaveBeenCalledWith(expect.objectContaining({
            runId: 'run-1', sessionId: 'sess-1', name: 'foo',
        }))
    })

    it('节点不存在时抛错（包含 vertical scope 信息）', async () => {
        const { getNodeConfigCached } = await import('~~/server/services/agent-platform/nodeConfig/loader')
        ;(getNodeConfigCached as any).mockResolvedValue(null)

        await expect(runStateGraphAgent(
            { scope: SessionScope.CONTRACT, agentType: 'stateGraph', nodeName: 'missing', runStateGraph: vi.fn() },
            baseCtx,
        )).rejects.toThrow(/missing.*vertical=contract/)
    })

    it('runStateGraph throw 时平台不发 SSE（让 agentWorker 顶层 publishStatusChange 统一发），rethrow + afterRun(false)', async () => {
        const { getNodeConfigCached } = await import('~~/server/services/agent-platform/nodeConfig/loader')
        const { publishCustomEvent } = await import('~~/server/services/agent/agentEventBridge')
        ;(getNodeConfigCached as any).mockResolvedValue(mockNodeConfig)

        const err = new Error('business boom')
        const afterRun = vi.fn().mockResolvedValue(undefined)
        const def: DomainAgentDefinition = {
            scope: SessionScope.CONTRACT,
            agentType: 'stateGraph',
            nodeName: 'contractReviewMain',
            runStateGraph: vi.fn().mockRejectedValue(err),
            hooks: { afterRun },
        }

        await expect(runStateGraphAgent(def, baseCtx)).rejects.toThrow('business boom')
        // 平台不重复发 status_change（避免与 agentWorker.executeRun 顶层 publishStatusChange 重复）
        expect(publishCustomEvent).not.toHaveBeenCalled()
        // afterRun 被以 success=false 调用
        expect(afterRun).toHaveBeenCalledWith(expect.any(Object), false)
    })

    it('beforeRun / afterRun 钩子被调用', async () => {
        const { getNodeConfigCached } = await import('~~/server/services/agent-platform/nodeConfig/loader')
        ;(getNodeConfigCached as any).mockResolvedValue(mockNodeConfig)

        const beforeRun = vi.fn().mockResolvedValue(undefined)
        const afterRun = vi.fn().mockResolvedValue(undefined)

        const stream = await runStateGraphAgent(
            {
                scope: SessionScope.CONTRACT, agentType: 'stateGraph', nodeName: 'contractReviewMain',
                runStateGraph: vi.fn().mockResolvedValue(new ReadableStream()),
                hooks: { beforeRun, afterRun },
            },
            baseCtx,
        )

        expect(beforeRun).toHaveBeenCalledTimes(1)
        // afterRun 在 stream 关闭时触发，本测试不消费 stream，故只验证 beforeRun
        // afterRun 由 wrapStreamWithAfterRun 包装；完整路径在端到端 smoke 验证
        await stream.cancel()
    })
})
