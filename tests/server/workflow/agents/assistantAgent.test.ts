/**
 * 通用法律助手主代理 assistantAgent 测试
 *
 * **Feature: assistant-context-segments**
 * **Validates: assistantAgent 接入 buildContextSegments（caseId=null 短路退化）**
 *
 * Phase 4 重点：
 * - buildContextSegments 被调用且 caseId 严格为 null
 * - SystemMessage 退化为 roleAndFlow 单段（caseProfile / moduleSummaries / dynamicContext 为空）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NodeConfig } from '../../../../server/services/node/node.service'

// ==================== Mock 定义 ====================

// mock langchain（createAgent, summarizationMiddleware 等）
const mockStream = vi.fn()
vi.mock('langchain', () => ({
    createAgent: vi.fn(() => ({
        stream: mockStream,
    })),
    summarizationMiddleware: vi.fn(() => ({})),
}))

// mock checkpointer
vi.mock('../../../../server/services/workflow/checkpointer', () => ({
    getCheckpointer: vi.fn(async () => ({ __mock: 'checkpointer' })),
    getStore: vi.fn(async () => ({ __mock: 'store' })),
}))

// mock node.service
const mockGetValidNodeConfig = vi.fn()
vi.mock('../../../../server/services/node/node.service', () => ({
    getValidNodeConfig: (...args: unknown[]) => mockGetValidNodeConfig(...args),
}))

// mock chatModelFactory（保留 cachedPromptTo* 真实实现以便快照对照）
vi.mock('../../../../server/services/node/chatModelFactory', async () => {
    const actual = await vi.importActual<typeof import('../../../../server/services/node/chatModelFactory')>(
        '../../../../server/services/node/chatModelFactory'
    )
    return {
        ...actual,
        createChatModel: vi.fn(() => ({ __mock: 'model' })),
    }
})

// mock tools
const mockGetToolInstances = vi.fn()
vi.mock('../../../../server/services/workflow/tools', () => ({
    getToolInstancesService: (...args: unknown[]) => mockGetToolInstances(...args),
}))

// mock buildContextSegments —— 关键：此处直接断言入参 caseId=null
const mockBuildContextSegments = vi.fn()
vi.mock('../../../../server/services/workflow/context/moduleContextBuilder', async () => {
    const actual = await vi.importActual<typeof import('../../../../server/services/workflow/context/moduleContextBuilder')>(
        '../../../../server/services/workflow/context/moduleContextBuilder'
    )
    return {
        ...actual,
        buildContextSegments: (...args: unknown[]) => mockBuildContextSegments(...args),
    }
})

// mock middleware
vi.mock('../../../../server/services/workflow/middleware', () => ({
    createAuditMiddleware: vi.fn(() => ({ __mock: 'audit' })),
    createMessageIntegrityMiddleware: vi.fn(() => ({ __mock: 'msgIntegrity' })),
    createScopeGuardMiddleware: vi.fn(() => ({ __mock: 'scopeGuard' })),
    pointConsumptionMiddleware: vi.fn(() => ({ __mock: 'pointConsumption' })),
    safetyTrimMiddleware: vi.fn(() => ({ __mock: 'safetyTrim' })),
}))

// mock @langchain/langgraph
vi.mock('@langchain/langgraph', () => ({
    Command: class Command {
        resume: unknown
        constructor(opts: { resume: unknown }) {
            this.resume = opts.resume
        }
    },
}))

// mock 自动导入的 logger
vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

// ==================== 测试辅助 ====================

/** 创建 assistantMain 节点配置 */
function createAssistantNodeConfig(overrides: Partial<NodeConfig> = {}): NodeConfig {
    return {
        id: 1,
        name: 'assistantMain',
        title: '通用法律助手主Agent',
        description: '通用法律助手',
        type: 'main',
        prompts: [
            { id: 1, name: 'system', content: '你是通用法律助手', version: '1.0', type: 'system', status: 1 },
        ],
        modelId: 1,
        modelName: 'gpt-4o',
        modelType: 'chat',
        modelStatus: 1,
        modelSdkType: 'openai',
        modelProviderId: 1,
        modelProviderName: 'OpenAI',
        modelProviderBaseUrl: 'https://api.openai.com/v1',
        modelProviderDescription: '',
        modelApiKeys: [{ id: 1, apiKey: 'sk-test-assistant', status: 1 }],
        tools: [],
        outputSchema: null,
        ...overrides,
    } as unknown as NodeConfig
}

// ==================== 测试用例 ====================

describe('runAssistantChat — buildContextSegments 接入（Phase 4）', () => {
    /** 模拟 ReadableStream */
    const mockReadableStream = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode('event: values\ndata: {}\n\n'))
            controller.close()
        },
    })

    beforeEach(() => {
        vi.clearAllMocks()
        mockGetValidNodeConfig.mockResolvedValue(createAssistantNodeConfig())
        mockGetToolInstances.mockReturnValue([])
        mockStream.mockResolvedValue(mockReadableStream)

        // 默认：buildContextSegments 短路返回——只有 roleAndFlow，其余三段为空字符串
        mockBuildContextSegments.mockImplementation(async (params: { roleAndFlowTemplate?: string }) => ({
            roleAndFlow: params.roleAndFlowTemplate ?? '',
            caseProfile: '',
            moduleSummaries: '',
            dynamicContext: '',
        }))
    })

    it('调用 buildContextSegments 时 caseId 严格为 null 且 agentName=assistantMain', async () => {
        const { runAssistantChat } = await import(
            '../../../../server/services/workflow/agents/assistantAgent'
        )

        await runAssistantChat('session-assistant-1', '帮我看看合同', { userId: 1 })

        expect(mockBuildContextSegments).toHaveBeenCalledTimes(1)
        const callArg = mockBuildContextSegments.mock.calls[0][0]
        expect(callArg.caseId).toBeNull()
        expect(callArg.agentName).toBe('assistantMain')
        expect(callArg.userQuery).toBe('帮我看看合同')
        // roleAndFlowTemplate 来自 renderSystemPrompt(mainConfig, {})
        expect(callArg.roleAndFlowTemplate).toBe('你是通用法律助手')
    })

    it('caseId=null 时 SystemMessage 退化为 roleAndFlow 单段（其余 3 段为空）', async () => {
        const { createAgent } = await import('langchain')
        const { runAssistantChat } = await import(
            '../../../../server/services/workflow/agents/assistantAgent'
        )

        await runAssistantChat('session-assistant-2', '介绍一下', { userId: 2 })

        const createAgentArg = vi.mocked(createAgent).mock.calls[0][0] as {
            systemPrompt: string | { content: unknown }
        }

        // openai sdkType → systemPrompt 为纯文本字符串
        expect(typeof createAgentArg.systemPrompt).toBe('string')
        // 退化形态：cachedPromptToPlainText 把单段 roleAndFlow 直接拼成自身（无 \n\n 分隔符，因为只有一段）
        expect(createAgentArg.systemPrompt).toBe('你是通用法律助手')
    })

    it('Anthropic sdkType 时 SystemMessage 用 cache 块结构（仅 1h 角色段，无 caseProfile / 5m 段）', async () => {
        mockGetValidNodeConfig.mockResolvedValue(
            createAssistantNodeConfig({ modelSdkType: 'anthropic' })
        )

        const { createAgent } = await import('langchain')
        const { SystemMessage } = await import('@langchain/core/messages')
        const { runAssistantChat } = await import(
            '../../../../server/services/workflow/agents/assistantAgent'
        )

        await runAssistantChat('session-assistant-3', '问题', { userId: 3 })

        const createAgentArg = vi.mocked(createAgent).mock.calls[0][0] as {
            systemPrompt: InstanceType<typeof SystemMessage>
        }

        expect(createAgentArg.systemPrompt).toBeInstanceOf(SystemMessage)
        const content = createAgentArg.systemPrompt.content as Array<Record<string, unknown>>
        expect(Array.isArray(content)).toBe(true)
        // 退化形态：仅 roleAndFlow（1h cache），不含 caseProfile / moduleSummaries / dynamicContext
        expect(content).toHaveLength(1)
        expect(content[0]).toMatchObject({
            type: 'text',
            text: '你是通用法律助手',
            cache_control: { type: 'ephemeral', ttl: '1h' },
        })
    })
})
