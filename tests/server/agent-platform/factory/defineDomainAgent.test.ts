/**
 * defineDomainAgent 工厂集成测试
 *
 * **Feature: agent-platform**
 * **Validates: T12 - defineDomainAgent factory integration**
 *
 * 所有外部依赖（LLM、DB、checkpointer）均 mock，
 * 仅验证工厂的编排逻辑：注册、中间件组装、工具组装、hooks 调用顺序。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionScope } from '#shared/types/agentEvent'

// -----------------------------------------------------------------------
// 全局自动导入 mock
// -----------------------------------------------------------------------
;(globalThis as any).logger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
}

// -----------------------------------------------------------------------
// 模块 mock（vi.mock 会被 hoisted 到文件顶部）
// -----------------------------------------------------------------------

vi.mock('~~/server/services/agent-platform/registry/agentRegistry', () => ({
    agentRegistry: { register: vi.fn(), list: vi.fn(() => []), has: vi.fn(() => false) },
}))

vi.mock('~~/server/services/agent-platform/nodeConfig/loader', () => ({
    getNodeConfigCached: vi.fn(),
    invalidateNodeConfigCache: vi.fn(),
}))

vi.mock('~~/server/services/agent-platform/nodeConfig/promptRenderer', () => ({
    renderSystemPrompt: vi.fn().mockReturnValue('mock system prompt'),
}))

vi.mock('~~/server/services/agent-platform/modelFactory', () => ({
    createChatModel: vi.fn().mockReturnValue({ _modelMock: true }),
}))

vi.mock('~~/server/services/agent-platform/checkpointer', () => ({
    getCheckpointer: vi.fn().mockResolvedValue({ _checkpointerMock: true }),
    getStore: vi.fn().mockResolvedValue({ _storeMock: true }),
}))

vi.mock('~~/server/services/agent-platform/middleware/skills', () => ({
    buildSkillsMiddlewareForNode: vi.fn().mockResolvedValue(null),
}))

vi.mock('~~/server/services/agent-platform/context/messageCompressor', () => ({
    resolveContextWindow: vi.fn().mockReturnValue({
        triggerTokens: 1000,
        maxTokens: 4000,
        maxOutputTokens: 2000,
    }),
}))

vi.mock('~~/server/services/agent-platform/tools/index', () => ({
    getToolInstancesService: vi.fn().mockReturnValue([]),
}))

vi.mock('~~/server/services/agent-platform/middleware/index', () => ({
    buildMiddlewareStack: vi.fn().mockReturnValue([]),
    MIDDLEWARE_PRIORITY: {
        MESSAGE_INTEGRITY: 1,
        SCOPE_GUARD: 5,
        TOOL_CALL_LIMIT: 7,
        POINT_CONSUMPTION: 20,
        SUMMARIZATION: 40,
        SAFETY_TRIM: 50,
        SKILLS_DISCOVERY: 60,
        DATE_CONTEXT: 65,
        AUDIT: 100,
    },
    MIDDLEWARE_NAMES: {
        MESSAGE_INTEGRITY: 'messageIntegrity',
        SCOPE_GUARD: 'scopeGuard',
        TOOL_CALL_LIMIT: 'toolCallLimit',
        POINT_CONSUMPTION: 'pointConsumption',
        SUMMARIZATION: 'summarization',
        SAFETY_TRIM: 'safetyTrim',
        SKILLS_DISCOVERY: 'skillsDiscovery',
        DATE_CONTEXT: 'dateContext',
        AUDIT: 'audit',
    },
    pointConsumptionMiddleware: vi.fn().mockReturnValue({ _type: 'pointConsumption' }),
    safetyTrimMiddleware: vi.fn().mockReturnValue({ _type: 'safetyTrim' }),
    createScopeGuardMiddleware: vi.fn().mockReturnValue({ _type: 'scopeGuard' }),
    createAuditMiddleware: vi.fn().mockReturnValue({ _type: 'audit' }),
    createToolCallLimitMiddlewares: vi.fn().mockReturnValue([{ _type: 'toolCallLimit' }]),
    createMessageIntegrityMiddleware: vi.fn().mockReturnValue({ _type: 'messageIntegrity' }),
    dateContextMiddleware: vi.fn().mockReturnValue({ _type: 'dateContext' }),
}))

vi.mock('langchain', () => ({
    createAgent: vi.fn(),
    summarizationMiddleware: vi.fn().mockReturnValue({ _type: 'summarization' }),
}))

vi.mock('~~/server/services/agent-platform/tools/readSkillFile.tool', () => ({
    createTool: vi.fn().mockReturnValue({ name: 'readSkillFile', invoke: vi.fn() }),
}))

vi.mock('~~/server/services/agent-platform/tools/writeSkillFile.tool', () => ({
    createTool: vi.fn().mockReturnValue({ name: 'writeSkillFile', invoke: vi.fn() }),
}))

vi.mock('~~/server/services/agent-platform/tools/runSkillScript.tool', () => ({
    createTool: vi.fn().mockReturnValue({ name: 'runSkillScript', invoke: vi.fn() }),
}))

vi.mock('~~/server/services/agent-platform/tools/runSkillCommand.tool', () => ({
    createTool: vi.fn().mockReturnValue({ name: 'runSkillCommand', invoke: vi.fn() }),
}))

// -----------------------------------------------------------------------
// 辅助：构造 mock NodeConfig
// -----------------------------------------------------------------------
function makeMockNodeConfig(overrides?: Partial<Record<string, any>>) {
    return {
        id: 1,
        name: 'testNode',
        title: '测试节点',
        description: '测试',
        type: 'agent',
        prompts: [],
        modelId: 1,
        modelName: 'gpt-4o',
        modelType: 'llm',
        modelStatus: 1,
        modelSdkType: 'openai',
        modelContextWindow: 8000,
        modelMaxOutputTokens: 2000,
        modelProviderBaseUrl: 'https://api.openai.com/v1',
        modelApiKeys: [{ id: 1, apiKey: 'sk-test', status: 1 }],
        tools: [],
        ...overrides,
    }
}

// -----------------------------------------------------------------------
// 辅助：构造 mock AgentRunnerContext
// -----------------------------------------------------------------------
function makeMockCtx(overrides?: Partial<Record<string, any>>) {
    return {
        runId: 'run-001',
        sessionId: 'sess-001',
        userId: 1,
        caseId: null,
        message: '你好',
        command: undefined,
        thinking: false,
        selectedModules: [],
        signal: new AbortController().signal,
        ...overrides,
    } as any
}

// -----------------------------------------------------------------------
// 辅助：构造最简 ReadableStream
// -----------------------------------------------------------------------
function makeStream(): ReadableStream {
    return new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode('event: values\ndata: {}\n\n'))
            controller.close()
        },
    })
}

// -----------------------------------------------------------------------
// 测试套件
// -----------------------------------------------------------------------

describe('defineDomainAgent 工厂', () => {
    let agentRegistryMock: any
    let getNodeConfigCachedMock: any
    let buildSkillsMiddlewareForNodeMock: any
    let createAgentMock: any
    let defineDomainAgent: typeof import('~~/server/services/agent-platform/factory/defineDomainAgent').defineDomainAgent

    beforeEach(async () => {
        vi.clearAllMocks()

        const registryMod = await import('~~/server/services/agent-platform/registry/agentRegistry')
        agentRegistryMock = (registryMod as any).agentRegistry

        const loaderMod = await import('~~/server/services/agent-platform/nodeConfig/loader')
        getNodeConfigCachedMock = (loaderMod as any).getNodeConfigCached

        const skillsMod = await import('~~/server/services/agent-platform/middleware/skills')
        buildSkillsMiddlewareForNodeMock = (skillsMod as any).buildSkillsMiddlewareForNode

        const langchainMod = await import('langchain')
        createAgentMock = (langchainMod as any).createAgent

        const factoryMod = await import('~~/server/services/agent-platform/factory/defineDomainAgent')
        defineDomainAgent = factoryMod.defineDomainAgent
    })

    it('stateGraph 类型缺少 runStateGraph 时立即抛错', () => {
        expect(() => {
            defineDomainAgent({
                scope: SessionScope.ASSISTANT,
                agentType: 'stateGraph',
                nodeName: 'testNode',
                // runStateGraph 故意不传
            })
        }).toThrow(/stateGraph.*必须提供 runStateGraph/)
    })

    it('defineDomainAgent 调用后注册到 agentRegistry', () => {
        defineDomainAgent({
            scope: SessionScope.DOCUMENT,
            agentType: 'createAgent',
            nodeName: 'testNode',
        })
        expect(agentRegistryMock.register).toHaveBeenCalledOnce()
        const registeredEntry = agentRegistryMock.register.mock.calls[0][0]
        expect(registeredEntry.scope).toBe(SessionScope.DOCUMENT)
        expect(typeof registeredEntry.runner).toBe('function')
    })

    it('createAgent 路径：节点不存在时 runner 抛错', async () => {
        getNodeConfigCachedMock.mockResolvedValue(null)

        const agent = defineDomainAgent({
            scope: SessionScope.DOCUMENT,
            agentType: 'createAgent',
            nodeName: 'nonExistentNode',
        })

        await expect(agent.runner(makeMockCtx())).rejects.toThrow(/未找到/)
    })

    it('createAgent 路径：节点无可用 API Key 时 runner 抛错', async () => {
        getNodeConfigCachedMock.mockResolvedValue(
            makeMockNodeConfig({ modelApiKeys: [] }),
        )

        const agent = defineDomainAgent({
            scope: SessionScope.DOCUMENT,
            agentType: 'createAgent',
            nodeName: 'testNode',
        })

        await expect(agent.runner(makeMockCtx())).rejects.toThrow(/没有可用的 API 密钥/)
    })

    it('createAgent 路径：调用 createAgent 并返回 ReadableStream', async () => {
        getNodeConfigCachedMock.mockResolvedValue(makeMockNodeConfig())
        const mockStream = makeStream()
        createAgentMock.mockReturnValue({
            stream: vi.fn().mockResolvedValue(mockStream),
        })

        const agent = defineDomainAgent({
            scope: SessionScope.CONTRACT,
            agentType: 'createAgent',
            nodeName: 'testNode',
        })

        const stream = await agent.runner(makeMockCtx())
        expect(createAgentMock).toHaveBeenCalledOnce()
        expect(stream).toBeInstanceOf(ReadableStream)
    })

    it('nodeName 为函数时动态解析节点名', async () => {
        getNodeConfigCachedMock.mockResolvedValue(makeMockNodeConfig())
        createAgentMock.mockReturnValue({ stream: vi.fn().mockResolvedValue(makeStream()) })

        const dynamicNodeName = vi.fn().mockReturnValue('resolvedNode')
        const agent = defineDomainAgent({
            scope: SessionScope.DOCUMENT,
            agentType: 'createAgent',
            nodeName: dynamicNodeName,
        })

        const ctx = makeMockCtx()
        await agent.runner(ctx)

        // 函数被以 ctx 为参数调用
        expect(dynamicNodeName).toHaveBeenCalledWith(ctx)
        // loader 收到解析后的字符串
        expect(getNodeConfigCachedMock).toHaveBeenCalledWith('resolvedNode')
    })

    it('stateGraph 路径：调用 runStateGraph 而非 createAgent', async () => {
        // stateGraph 路径会先加载 nodeConfig 然后注入到 enhanced ctx
        getNodeConfigCachedMock.mockResolvedValue(makeMockNodeConfig())
        const mockRunStateGraph = vi.fn().mockResolvedValue(makeStream())

        const agent = defineDomainAgent({
            scope: SessionScope.ASSISTANT,
            agentType: 'stateGraph',
            nodeName: 'testNode',
            runStateGraph: mockRunStateGraph,
        })

        const ctx = makeMockCtx()
        await agent.runner(ctx)

        // runStateGraph 收到的是 enhanced ctx：含原 ctx + nodeConfig + emitCustomEvent
        expect(mockRunStateGraph).toHaveBeenCalledOnce()
        const enhancedCtx = mockRunStateGraph.mock.calls[0][0]
        expect(enhancedCtx).toMatchObject(ctx)
        expect(enhancedCtx.nodeConfig).toBeDefined()
        expect(enhancedCtx.nodeConfig.name).toBe('testNode')
        expect(typeof enhancedCtx.emitCustomEvent).toBe('function')
        expect(createAgentMock).not.toHaveBeenCalled()
    })

    it('无 skillsMw 时：不挂载 skill 工具', async () => {
        getNodeConfigCachedMock.mockResolvedValue(makeMockNodeConfig())
        buildSkillsMiddlewareForNodeMock.mockResolvedValue(null)

        let capturedTools: any[] = []
        createAgentMock.mockImplementation(({ tools }: any) => {
            capturedTools = tools ?? []
            return { stream: vi.fn().mockResolvedValue(makeStream()) }
        })

        const agent = defineDomainAgent({
            scope: SessionScope.DOCUMENT,
            agentType: 'createAgent',
            nodeName: 'testNode',
        })
        await agent.runner(makeMockCtx())

        const skillToolNames = capturedTools.map((t: any) => t.name).filter((n: string) =>
            ['readSkillFile', 'writeSkillFile', 'runSkillScript', 'runSkillCommand'].includes(n),
        )
        expect(skillToolNames).toHaveLength(0)
    })

    it('有 skillsMw 时：自动挂载 4 个 skill 工具', async () => {
        getNodeConfigCachedMock.mockResolvedValue(makeMockNodeConfig())
        buildSkillsMiddlewareForNodeMock.mockResolvedValue({ _type: 'skillsMiddleware' })

        let capturedTools: any[] = []
        createAgentMock.mockImplementation(({ tools }: any) => {
            capturedTools = tools ?? []
            return { stream: vi.fn().mockResolvedValue(makeStream()) }
        })

        const agent = defineDomainAgent({
            scope: SessionScope.DOCUMENT,
            agentType: 'createAgent',
            nodeName: 'testNode',
        })
        await agent.runner(makeMockCtx())

        const skillToolNames = capturedTools.map((t: any) => t.name).filter((n: string) =>
            ['readSkillFile', 'writeSkillFile', 'runSkillScript', 'runSkillCommand'].includes(n),
        )
        expect(skillToolNames).toHaveLength(4)
    })

    it('customTools 合并进工具列表', async () => {
        getNodeConfigCachedMock.mockResolvedValue(makeMockNodeConfig())
        createAgentMock.mockImplementation(({ tools }: any) => ({
            stream: vi.fn().mockResolvedValue(makeStream()),
            _tools: tools,
        }))

        const customTool = { name: 'myCustomTool', invoke: vi.fn() } as any
        const agent = defineDomainAgent({
            scope: SessionScope.DOCUMENT,
            agentType: 'createAgent',
            nodeName: 'testNode',
            customTools: async () => [customTool],
        })

        await agent.runner(makeMockCtx())

        const [call] = createAgentMock.mock.calls
        const tools: any[] = call[0].tools
        expect(tools.some((t: any) => t.name === 'myCustomTool')).toBe(true)
    })

    it('customMiddlewares 合并进中间件栈', async () => {
        getNodeConfigCachedMock.mockResolvedValue(makeMockNodeConfig())
        createAgentMock.mockReturnValue({ stream: vi.fn().mockResolvedValue(makeStream()) })

        const { buildMiddlewareStack } = await import('~~/server/services/agent-platform/middleware/index')
        const buildMiddlewareStackMock = buildMiddlewareStack as any

        const customMw = { _type: 'customMw' } as any
        const agent = defineDomainAgent({
            scope: SessionScope.DOCUMENT,
            agentType: 'createAgent',
            nodeName: 'testNode',
            customMiddlewares: async () => [{ middleware: customMw, priority: 99, name: 'custom' }],
        })

        await agent.runner(makeMockCtx())

        const [items] = buildMiddlewareStackMock.mock.calls[0]
        const hasCustom = items.some((i: any) => i.name === 'custom')
        expect(hasCustom).toBe(true)
    })

    it('beforeRun 在 stream 之前被调用，afterRun 在流关闭后被调用', async () => {
        getNodeConfigCachedMock.mockResolvedValue(makeMockNodeConfig())

        const callOrder: string[] = []
        const beforeRun = vi.fn().mockImplementation(async () => { callOrder.push('beforeRun') })
        const afterRun = vi.fn().mockImplementation(async () => { callOrder.push('afterRun') })

        // 使用可手动控制的流，避免自动关闭干扰 afterRun 调用时机判断
        let streamController!: ReadableStreamDefaultController<Uint8Array>
        const controllableStream = new ReadableStream<Uint8Array>({
            start(controller) { streamController = controller },
        })

        createAgentMock.mockImplementation(() => ({
            stream: vi.fn().mockImplementation(async () => {
                callOrder.push('streamStart')
                return controllableStream
            }),
        }))

        const agent = defineDomainAgent({
            scope: SessionScope.DOCUMENT,
            agentType: 'createAgent',
            nodeName: 'testNode',
            hooks: { beforeRun, afterRun },
        })

        const stream = await agent.runner(makeMockCtx())

        // 流返回前：beforeRun + streamStart 已调用，afterRun 尚未调用
        expect(callOrder).toEqual(['beforeRun', 'streamStart'])
        expect(afterRun).not.toHaveBeenCalled()

        // 开始消费流（此时还未关闭，afterRun 仍未触发）
        const reader = stream.getReader()
        const readPromise = reader.read()

        // 手动关闭底层流，触发 afterRun
        streamController.close()
        await readPromise

        // 等待微任务队列执行 afterRun
        await new Promise(resolve => setTimeout(resolve, 10))
        expect(afterRun).toHaveBeenCalledOnce()
        expect(callOrder).toEqual(['beforeRun', 'streamStart', 'afterRun'])
    })
})
