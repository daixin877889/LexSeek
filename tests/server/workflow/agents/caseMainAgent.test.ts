/**
 * 主代理 caseMainAgent 测试
 *
 * **Feature: case-main-agent**
 * **Validates: runCaseChat 返回 ReadableStream、加载配置、合并工具**
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
    todoListMiddleware: vi.fn(() => ({})),
}))

// mock checkpointer
vi.mock('../../../../server/services/workflow/checkpointer', () => ({
    getCheckpointer: vi.fn(async () => ({ __mock: 'checkpointer' })),
    getStore: vi.fn(async () => ({ __mock: 'store' })),
}))

// mock node.service
const mockGetValidNodeConfig = vi.fn()
const mockGetNodeConfigsByTypes = vi.fn()
vi.mock('../../../../server/services/node/node.service', () => ({
    getValidNodeConfig: (...args: unknown[]) => mockGetValidNodeConfig(...args),
    getNodeConfigsByTypes: (...args: unknown[]) => mockGetNodeConfigsByTypes(...args),
}))

// mock chatModelFactory
vi.mock('../../../../server/services/node/chatModelFactory', () => ({
    createChatModel: vi.fn(() => ({ __mock: 'model' })),
}))

// mock tools
const mockGetToolInstances = vi.fn()
vi.mock('../../../../server/services/workflow/tools', () => ({
    getToolInstancesService: (...args: unknown[]) => mockGetToolInstances(...args),
}))

// mock subAgentToolFactory
const mockCreateSubAgentTools = vi.fn()
vi.mock('../../../../server/services/workflow/agents/subAgentToolFactory', () => ({
    createSubAgentTools: (...args: unknown[]) => mockCreateSubAgentTools(...args),
    sanitizeName: (name: string) => name.replace(/[^a-zA-Z0-9_]/g, '_'),
}))

// mock middleware
vi.mock('../../../../server/services/workflow/middleware', () => ({
    pointConsumptionMiddleware: vi.fn(() => ({ __mock: 'pointConsumption' })),
    caseProcessMaterialMiddleware: vi.fn(() => ({ __mock: 'caseProcessMaterial' })),
    caseMaterialContextMiddleware: vi.fn(() => ({ __mock: 'caseMaterialContext' })),
}))

// mock @langchain/core/messages
vi.mock('@langchain/core/messages', () => ({
    HumanMessage: class HumanMessage {
        content: string
        constructor(content: string) {
            this.content = content
        }
    },
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

/** 创建主代理节点配置 */
function createMainNodeConfig(overrides: Partial<NodeConfig> = {}): NodeConfig {
    return {
        id: 1,
        name: 'caseMain',
        title: '案件主Agent',
        description: '处理案件分析的主代理',
        type: 'main',
        prompts: [
            { id: 1, name: 'system', content: '你是一个法律分析专家', version: '1.0', type: 'system', status: 1 },
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
        modelApiKeys: [{ id: 1, apiKey: 'sk-test-main', status: 1 }],
        tools: ['search', 'calculator'],
        outputSchema: null,
        ...overrides,
    }
}

/** 创建子代理节点配置 */
function createSubNodeConfig(name: string, title: string): NodeConfig {
    return {
        id: 10,
        name,
        title,
        description: `${title}描述`,
        type: 'analysis',
        prompts: [
            { id: 2, name: 'system', content: `你是${title}`, version: '1.0', type: 'system', status: 1 },
        ],
        modelId: 2,
        modelName: 'gpt-4o-mini',
        modelType: 'chat',
        modelStatus: 1,
        modelSdkType: 'openai',
        modelProviderId: 1,
        modelProviderName: 'OpenAI',
        modelProviderBaseUrl: 'https://api.openai.com/v1',
        modelProviderDescription: '',
        modelApiKeys: [{ id: 2, apiKey: 'sk-test-sub', status: 1 }],
        tools: [],
        outputSchema: null,
    }
}

// ==================== 测试用例 ====================

describe('runCaseChat 主代理', () => {
    /** 模拟 ReadableStream 返回值 */
    const mockReadableStream = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode('event: values\ndata: {}\n\n'))
            controller.close()
        },
    })

    beforeEach(() => {
        vi.clearAllMocks()

        // 默认配置：主代理有工具
        mockGetValidNodeConfig.mockResolvedValue(createMainNodeConfig())

        // 默认配置：两个子代理节点
        mockGetNodeConfigsByTypes.mockResolvedValue([
            createSubNodeConfig('legal-analysis', '法律分析专家'),
            createSubNodeConfig('document-review', '文书审查专家'),
        ])

        // 默认：主代理工具
        mockGetToolInstances.mockReturnValue([
            { name: 'search', invoke: vi.fn() },
            { name: 'calculator', invoke: vi.fn() },
        ])

        // 默认：子代理工具
        mockCreateSubAgentTools.mockResolvedValue([
            { name: 'ask_legal_analysis_expert', invoke: vi.fn() },
            { name: 'ask_document_review_expert', invoke: vi.fn() },
        ])

        // 默认：stream 返回 ReadableStream
        mockStream.mockResolvedValue(mockReadableStream)
    })

    it('返回 ReadableStream', async () => {
        const { runCaseChat } = await import(
            '../../../../server/services/workflow/agents/caseMainAgent'
        )

        const result = await runCaseChat('session-1', '分析这个案件', {
            userId: 1,
            caseId: 100,
        })

        expect(result).toBeInstanceOf(ReadableStream)
    })

    it('正确加载 caseMain 节点配置', async () => {
        const { runCaseChat } = await import(
            '../../../../server/services/workflow/agents/caseMainAgent'
        )

        await runCaseChat('session-2', '你好', { userId: 1, caseId: 200 })

        // 验证用 'caseMain' 调用了 getValidNodeConfig
        expect(mockGetValidNodeConfig).toHaveBeenCalledWith('caseMain', '案件主Agent')
    })

    it('加载子代理节点配置', async () => {
        const { runCaseChat } = await import(
            '../../../../server/services/workflow/agents/caseMainAgent'
        )

        await runCaseChat('session-3', '分析', { userId: 1, caseId: 300 })

        // 验证加载了子代理节点
        expect(mockGetNodeConfigsByTypes).toHaveBeenCalledWith(['analysis', 'document'])
    })

    it('正确合并主代理工具和子代理工具', async () => {
        const { createAgent } = await import('langchain')

        const { runCaseChat } = await import(
            '../../../../server/services/workflow/agents/caseMainAgent'
        )

        await runCaseChat('session-4', '合并工具', { userId: 1, caseId: 400 })

        // 验证 createAgent 被调用时传入了合并的工具
        expect(createAgent).toHaveBeenCalledTimes(1)
        const createAgentCall = vi.mocked(createAgent).mock.calls[0][0] as { tools: unknown[] }
        // 主代理工具 2 个 + 子代理工具 2 个 = 4 个
        expect(createAgentCall.tools).toHaveLength(4)
    })

    it('中断恢复时使用 Command 而非 HumanMessage', async () => {
        const { runCaseChat } = await import(
            '../../../../server/services/workflow/agents/caseMainAgent'
        )

        await runCaseChat('session-5', undefined, {
            userId: 1,
            caseId: 500,
            command: { action: 'approve' },
        })

        // 验证 stream 被调用时 input 是 Command 实例
        expect(mockStream).toHaveBeenCalledTimes(1)
        const streamInput = mockStream.mock.calls[0][0]
        // Command mock 中有 resume 属性
        expect(streamInput).toHaveProperty('resume', { action: 'approve' })
    })

    it('无可用 API Key 时抛出错误', async () => {
        mockGetValidNodeConfig.mockResolvedValue(
            createMainNodeConfig({ modelApiKeys: [] })
        )

        const { runCaseChat } = await import(
            '../../../../server/services/workflow/agents/caseMainAgent'
        )

        await expect(
            runCaseChat('session-6', '测试', { userId: 1, caseId: 600 })
        ).rejects.toThrow('没有可用的 API 密钥')
    })
})
