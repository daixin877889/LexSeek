/**
 * subAgentToolFactory 单测
 *
 * 验证：
 * - sanitizeName：合法字符通过，特殊字符替换
 * - createSubAgentTools：空数组返回空 / 跳过无 API Key / 工具命名 ask_*_expert
 * - 工具调用：成功路径返回最后一条 AI 消息内容；catch 路径返回错误字符串 + 发 failed 事件
 * - callbacks：handleLLMNewToken / handleToolStart / handleToolEnd / handleChainEnd 各发对应事件
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
    warnSpy, errorSpy, infoSpy,
    publishCustomEventMock, publishStatusChangeMock,
    createAgentMock,
} = vi.hoisted(() => ({
    warnSpy: vi.fn(),
    errorSpy: vi.fn(),
    infoSpy: vi.fn(),
    publishCustomEventMock: vi.fn().mockResolvedValue(undefined),
    publishStatusChangeMock: vi.fn().mockResolvedValue(undefined),
    createAgentMock: vi.fn(),
}))
vi.mock('#shared/utils/logger', () => ({
    logger: { error: errorSpy, info: infoSpy, warn: warnSpy, debug: vi.fn() },
}))
;(globalThis as any).logger = { error: errorSpy, info: infoSpy, warn: warnSpy, debug: vi.fn() }

vi.mock('~~/server/services/node/chatModelFactory', () => ({
    createChatModel: vi.fn(() => ({ _model: true })),
}))
vi.mock('~~/server/services/agent-platform/tools', () => ({
    getToolInstancesService: vi.fn(() => [{ name: 'sub_tool' }]),
}))
vi.mock('~~/server/services/agent-platform/middleware', () => ({
    createAuditMiddleware: vi.fn(() => ({ _mw: 'audit' })),
    createMessageIntegrityMiddleware: vi.fn(() => ({ _mw: 'integrity' })),
    createScopeGuardMiddleware: vi.fn(() => ({ _mw: 'scope' })),
    pointConsumptionMiddleware: vi.fn(() => ({ _mw: 'point' })),
}))
vi.mock('~~/server/services/agent-platform/middleware/safetyTrim.middleware', () => ({
    safetyTrimMiddleware: vi.fn(() => ({ _mw: 'trim' })),
}))
vi.mock('~~/server/services/workflow/middleware/analysisResultPersistence.middleware', () => ({
    analysisResultPersistenceMiddleware: vi.fn(() => ({ _mw: 'persist' })),
}))
vi.mock('~~/server/services/agent-platform/checkpointer', () => ({
    getCheckpointer: vi.fn().mockResolvedValue({ _ckp: true }),
    getStore: vi.fn().mockResolvedValue({ _store: true }),
}))
vi.mock('~~/server/services/workflow/utils/promptRenderer', () => ({
    renderSystemPrompt: vi.fn(() => '渲染后的提示词'),
}))
vi.mock('~~/server/services/agent-platform/context/messageCompressor', () => ({
    resolveContextWindow: vi.fn(() => ({
        triggerTokens: 30000,
        maxTokens: 100000,
        maxOutputTokens: 8192,
    })),
}))
vi.mock('~~/server/services/agent-platform/context/moduleContextBuilder', async () => {
    const langchainMessages = await import('@langchain/core/messages')
    return {
        buildSystemPromptForAgent: vi.fn(async () => ({
            systemMessage: new langchainMessages.SystemMessage('系统'),
            plainText: '系统纯文本',
        })),
    }
})

vi.mock('~~/server/services/agent/agentEventBridge', () => ({
    publishCustomEvent: publishCustomEventMock,
    publishStatusChange: publishStatusChangeMock,
}))

vi.mock('langchain', () => ({
    createAgent: (opts: any) => createAgentMock(opts),
    summarizationMiddleware: vi.fn(() => ({ _mw: 'summary' })),
    createMiddleware: (cfg: any) => cfg,
}))

import { createSubAgentTools, sanitizeName } from '~~/server/services/agent-platform/subAgent/subAgentToolFactory'
import { AIMessage, HumanMessage } from '@langchain/core/messages'

const baseCtx = { userId: 1, caseId: 100, sessionId: 'sess-1', runId: 'run-1' }

function makeNodeConfig(overrides: Partial<any> = {}) {
    return {
        id: 1,
        name: 'evidence_expert',
        title: '证据专家',
        description: '证据分析',
        type: 'agent',
        prompts: [],
        modelId: 1,
        modelName: 'gpt-4o',
        modelType: 'llm',
        modelStatus: 1,
        modelSdkType: 'openai',
        modelContextWindow: 128000,
        modelMaxOutputTokens: 4096,
        modelProviderBaseUrl: 'https://api.openai.com/v1',
        modelApiKeys: [{ id: 1, apiKey: 'sk-test', status: 1 }],
        tools: [],
        ...overrides,
    } as any
}

describe('sanitizeName', () => {
    it('合法字符保留', () => {
        expect(sanitizeName('abc_123')).toBe('abc_123')
    })
    it('特殊字符替换为下划线', () => {
        expect(sanitizeName('a-b.c@d!e')).toBe('a_b_c_d_e')
    })
    it('中文与空格替换', () => {
        // "证据 专家" = 4 汉字 + 1 空格 → 5 个下划线
        expect(sanitizeName('证据 专家')).toBe('_____')
    })
})

describe('createSubAgentTools', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('空配置数组返回空数组', async () => {
        const tools = await createSubAgentTools([], baseCtx)
        expect(tools).toEqual([])
    })

    it('节点无可用 API Key 时跳过并打 warn', async () => {
        const cfg = makeNodeConfig({ modelApiKeys: [{ id: 1, apiKey: 'k', status: 0 }] })
        const tools = await createSubAgentTools([cfg], baseCtx)
        expect(tools).toEqual([])
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('没有可用的 API 密钥'))
    })

    it('生成工具名为 ask_<safeName>_expert', async () => {
        const cfg = makeNodeConfig({ name: 'evidence-expert' })
        const tools = await createSubAgentTools([cfg], baseCtx)
        expect(tools).toHaveLength(1)
        expect(tools[0].name).toBe('ask_evidence_expert_expert')
        // 完成日志
        expect(infoSpy).toHaveBeenCalledWith(
            '子代理工具创建完成',
            expect.objectContaining({ totalConfigs: 1, createdTools: 1 }),
        )
    })

    it('调用工具：成功路径返回最后一条 AI 消息内容', async () => {
        createAgentMock.mockReturnValue({
            invoke: vi.fn().mockResolvedValue({
                messages: [
                    new HumanMessage('请帮忙'),
                    new AIMessage('分析完成：证据A、B、C'),
                ],
            }),
        })

        const tools = await createSubAgentTools([makeNodeConfig()], baseCtx)
        const out: any = await tools[0].invoke({ question: '需要分析证据' }, { toolCall: { id: 'parent-tc' } } as any)
        const text = typeof out === 'string' ? out : out.content
        expect(text).toBe('分析完成：证据A、B、C')

        // createAgent 收到了 model + middleware
        const opts = createAgentMock.mock.calls[0][0]
        expect(opts.model).toBeDefined()
        expect(Array.isArray(opts.middleware)).toBe(true)
        expect(opts.middleware.length).toBeGreaterThan(0)
    })

    it('调用工具：messages 中无 AI 内容时返回兜底文案', async () => {
        createAgentMock.mockReturnValue({
            invoke: vi.fn().mockResolvedValue({
                messages: [new HumanMessage('hi')],
            }),
        })
        const tools = await createSubAgentTools([makeNodeConfig()], baseCtx)
        const out: any = await tools[0].invoke({ question: 'q' }, { toolCall: { id: 'p' } } as any)
        const text = typeof out === 'string' ? out : out.content
        expect(text).toBe('子代理执行完成，但未生成文本回复')
    })

    it('调用工具：messages 不是数组时也返回兜底文案', async () => {
        createAgentMock.mockReturnValue({
            invoke: vi.fn().mockResolvedValue({}),
        })
        const tools = await createSubAgentTools([makeNodeConfig()], baseCtx)
        const out: any = await tools[0].invoke({ question: 'q' }, { toolCall: { id: 'p' } } as any)
        const text = typeof out === 'string' ? out : out.content
        expect(text).toBe('子代理执行完成，但未生成文本回复')
    })

    it('调用工具：AI 内容为非字符串走 JSON.stringify', async () => {
        createAgentMock.mockReturnValue({
            invoke: vi.fn().mockResolvedValue({
                messages: [
                    new AIMessage({ content: [{ type: 'text', text: '复合' }] as any }),
                ],
            }),
        })
        const tools = await createSubAgentTools([makeNodeConfig()], baseCtx)
        const out: any = await tools[0].invoke({ question: 'q' }, { toolCall: { id: 'p' } } as any)
        const text = typeof out === 'string' ? out : out.content
        // JSON.stringify([...]) 后非空
        expect(text).toContain('复合')
    })

    it('调用工具：catch 路径返回错误字符串 + 发 failed 状态', async () => {
        createAgentMock.mockReturnValue({
            invoke: vi.fn().mockRejectedValue(new Error('模型挂了')),
        })
        const tools = await createSubAgentTools([makeNodeConfig()], baseCtx)
        const out: any = await tools[0].invoke({ question: 'q' }, { toolCall: { id: 'p' } } as any)
        const text = typeof out === 'string' ? out : out.content
        expect(text).toMatch(/证据专家.*执行失败.*模型挂了/)
        expect(errorSpy).toHaveBeenCalled()
        expect(publishStatusChangeMock).toHaveBeenCalledWith(expect.objectContaining({
            status: 'failed',
            error: '模型挂了',
        }))
    })

    it('调用工具：catch 路径中错误为非 Error 时回退"未知错误"', async () => {
        createAgentMock.mockReturnValue({
            invoke: vi.fn().mockRejectedValue('字符串错误'),
        })
        const tools = await createSubAgentTools([makeNodeConfig()], baseCtx)
        const out: any = await tools[0].invoke({ question: 'q' }, { toolCall: { id: 'p' } } as any)
        const text = typeof out === 'string' ? out : out.content
        expect(text).toContain('未知错误')
    })

    it('调用工具：tools 列表非空时调 getToolInstancesService 否则跳过', async () => {
        const { getToolInstancesService } = await import('~~/server/services/agent-platform/tools')
        ;(getToolInstancesService as any).mockClear()
        createAgentMock.mockReturnValue({
            invoke: vi.fn().mockResolvedValue({ messages: [new AIMessage('done')] }),
        })

        // tools 为空 → 不调用 getToolInstancesService
        const cfg1 = makeNodeConfig({ tools: [] })
        const tools1 = await createSubAgentTools([cfg1], baseCtx)
        await tools1[0].invoke({ question: 'q' }, { toolCall: { id: 'p' } } as any)
        expect(getToolInstancesService).not.toHaveBeenCalled()

        // tools 非空 → 调用
        const cfg2 = makeNodeConfig({ tools: ['search_law'] })
        const tools2 = await createSubAgentTools([cfg2], baseCtx)
        await tools2[0].invoke({ question: 'q' }, { toolCall: { id: 'p' } } as any)
        expect(getToolInstancesService).toHaveBeenCalledWith(['search_law'], expect.objectContaining({ userId: 1 }))
    })

    it('callbacks：handleLLMNewToken / ToolStart / ToolEnd 各自发对应事件（chainEnd 已删除）', async () => {
        let capturedCallbacks: any
        createAgentMock.mockReturnValue({
            invoke: vi.fn().mockImplementation(async (_input: any, opts: any) => {
                capturedCallbacks = opts.callbacks[0]
                return { messages: [new AIMessage('done')] }
            }),
        })
        const tools = await createSubAgentTools([makeNodeConfig()], baseCtx)
        await tools[0].invoke({ question: 'q' }, { toolCall: { id: 'parent-tc' } } as any)

        // 触发 3 种增量事件回调（status_change 由调用方在 invoke 完成后显式发，不在 callback 内）
        capturedCallbacks.handleLLMNewToken('片段', null, 'cb-1')
        capturedCallbacks.handleToolStart({}, '工具入参', 'cb-2', 'parent', [], {}, 'name', 'inner-tc')
        capturedCallbacks.handleToolEnd({ data: 'x' }, 'cb-3')

        // chainEnd / chainError 已从 callback 内删除：LangGraph 多层 chain 包装下 cbParentRunId
        // === undefined 不止匹配最外层（inner LLM/RunnableSequence 也是 root），子代理还在跑就
        // 触发 completed → 前端 generatingModules 提前清空、跨标签 module:generating 提前广播
        // modules=[]。改由 subAgentToolFactory 在 invoke 完成后调 publishSubAgentStatus。
        expect(capturedCallbacks.handleChainEnd).toBeUndefined()
        expect(capturedCallbacks.handleChainError).toBeUndefined()

        expect(publishCustomEventMock).toHaveBeenCalledTimes(3)
        // invoke 成功路径：subAgentToolFactory 显式发 completed
        expect(publishStatusChangeMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }))

        const tokenCall = publishCustomEventMock.mock.calls.find(c => c[0].name === 'sub_agent_token')
        expect(tokenCall[0].metadata.delta).toBe('片段')
        expect(tokenCall[0].metadata.parentToolCallId).toBe('parent-tc')
    })

    it('callbacks：publishCustomEvent 抛错时仅 warn，不影响主链路', async () => {
        publishCustomEventMock.mockRejectedValueOnce(new Error('publish 挂了'))
        let capturedCallbacks: any
        createAgentMock.mockReturnValue({
            invoke: vi.fn().mockImplementation(async (_input: any, opts: any) => {
                capturedCallbacks = opts.callbacks[0]
                return { messages: [new AIMessage('done')] }
            }),
        })
        const tools = await createSubAgentTools([makeNodeConfig()], baseCtx)
        await tools[0].invoke({ question: 'q' }, { toolCall: { id: 'p' } } as any)
        capturedCallbacks.handleLLMNewToken('t', null, 'r')
        // microtask 让 catch 执行
        await new Promise(resolve => setTimeout(resolve, 5))
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('SUB_AGENT_TOKEN'),
            expect.anything(),
        )
    })
})

describe('invoke 抛错路径', () => {
    it('子代理 invoke 抛错 → tool catch 块发 publishStatusChange failed（callback 内 chain handlers 已删）', async () => {
        createAgentMock.mockReturnValue({
            invoke: vi.fn(async () => {
                throw new Error('chain failed')
            }),
        })
        const tools = await createSubAgentTools(
            [makeNodeConfig({ name: 'risk_expert' })],
            { ...baseCtx },
        )
        const result = await tools[0]!.invoke({ question: 'q' }, { toolCall: { id: 'tc-X' } } as any)
        // tool catch 块发 failed（唯一 publish 路径——chain callbacks 中已无 status_change 发送）
        expect(publishStatusChangeMock).toHaveBeenCalledWith(expect.objectContaining({
            status: 'failed',
            error: 'chain failed',
            metadata: expect.objectContaining({
                agentName: 'risk_expert',
                parentToolCallId: 'tc-X',
            }),
        }))
        // 兼容 LangChain tool() 包装器可能将返回值序列化为对象的情况
        const text = typeof result === 'string' ? result : (result as any)?.content
        expect(text).toMatch(/执行失败/)
    })
})
