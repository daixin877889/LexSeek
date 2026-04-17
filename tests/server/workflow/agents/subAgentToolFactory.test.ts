/**
 * 子代理工具工厂测试
 *
 * **Feature: sub-agent-tool-factory**
 * **Validates: sanitizeName 处理特殊字符、工具生成、跳过无 API Key 节点、空配置**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sanitizeName, createSubAgentTools } from '../../../../server/services/workflow/agents/subAgentToolFactory'
import type { NodeConfig } from '../../../../server/services/node/node.service'

// mock 依赖模块
vi.mock('../../../../server/services/node/chatModelFactory', () => ({
    createChatModel: vi.fn(() => ({ /* mock model */ })),
}))

vi.mock('../../../../server/services/workflow/tools', () => ({
    getToolInstancesService: vi.fn(() => []),
}))

vi.mock('langchain', () => ({
    createAgent: vi.fn(() => ({
        invoke: vi.fn().mockResolvedValue({
            messages: [{
                _getType: () => 'ai',
                type: 'ai',
                content: '分析结果文本',
            }],
        }),
    })),
}))

vi.mock('../../../../server/services/workflow/middleware', () => ({
    pointConsumptionMiddleware: vi.fn(() => ({})),
    analysisResultPersistenceMiddleware: vi.fn(() => ({})),
}))

vi.mock('../../../../server/services/workflow/checkpointer', () => ({
    getCheckpointer: vi.fn(async () => ({
        getTuple: vi.fn().mockResolvedValue(null),
    })),
    getStore: vi.fn(async () => ({})),
}))

// mock 自动导入的 logger
vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

// mock promptRenderer
vi.mock('../../../../server/services/workflow/utils/promptRenderer', () => ({
    renderSystemPrompt: vi.fn(() => '你是分析助手'),
}))

// mock @langchain/core/messages（工具调用时 buildBriefContext 构造 HumanMessage）
vi.mock('@langchain/core/messages', () => ({
    HumanMessage: class HumanMessage {
        content: string
        response_metadata: any
        constructor(opts: any) {
            if (typeof opts === 'string') { this.content = opts; return }
            this.content = opts.content
            this.response_metadata = opts.response_metadata
        }
        _getType() { return 'human' }
    },
}))

// mock prisma（buildBriefContext 内部调用）
vi.stubGlobal('prisma', {
    cases: {
        findUnique: vi.fn().mockResolvedValue({
            title: '测试案件', plaintiff: null, defendant: null, summary: null,
        }),
    },
    caseMaterials: {
        findMany: vi.fn().mockResolvedValue([]),
    },
})

/** 创建测试用 NodeConfig */
function createMockNodeConfig(overrides: Partial<NodeConfig> = {}): NodeConfig {
    return {
        id: 1,
        name: 'test-node',
        title: '测试节点',
        description: '这是一个测试节点',
        type: 'analysis',
        prompts: [
            { id: 1, name: 'system', content: '你是一个测试助手', version: '1.0', type: 'system', status: 1 },
        ],
        modelId: 1,
        modelName: 'gpt-4',
        modelType: 'chat',
        modelStatus: 1,
        modelSdkType: 'openai',
        modelProviderId: 1,
        modelProviderName: 'OpenAI',
        modelProviderBaseUrl: 'https://api.openai.com/v1',
        modelProviderDescription: '',
        modelApiKeys: [{ id: 1, apiKey: 'sk-test-key', status: 1 }],
        tools: [],
        outputSchema: null,
        ...overrides,
    }
}

// ==================== sanitizeName ====================

describe('sanitizeName 工具名合法化', () => {
    it('保留字母数字下划线不变', () => {
        expect(sanitizeName('hello_world_123')).toBe('hello_world_123')
    })

    it('将中文字符替换为下划线', () => {
        const result = sanitizeName('法律分析专家')
        expect(result).toMatch(/^_+$/)
        expect(result).not.toMatch(/[\u4e00-\u9fff]/)
    })

    it('将连字符替换为下划线', () => {
        expect(sanitizeName('case-analysis')).toBe('case_analysis')
    })

    it('将空格替换为下划线', () => {
        expect(sanitizeName('case analysis')).toBe('case_analysis')
    })

    it('将特殊符号替换为下划线', () => {
        expect(sanitizeName('test@#$%^&*')).toBe('test_______')
    })

    it('处理空字符串', () => {
        expect(sanitizeName('')).toBe('')
    })

    it('处理混合字符', () => {
        const result = sanitizeName('case-分析_v2.0')
        // 期望：case___v2_0（非字母数字下划线的字符都被替换）
        expect(result).toMatch(/^[a-zA-Z0-9_]+$/)
    })
})

// ==================== createSubAgentTools ====================

describe('createSubAgentTools 子代理工具创建', () => {
    const baseContext = {
        userId: 1,
        caseId: 100,
        sessionId: 'test-session-id',
    }

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('空配置列表返回空数组', async () => {
        const tools = await createSubAgentTools([], baseContext)
        expect(tools).toEqual([])
    })

    it('有效节点生成对应数量的工具', async () => {
        const configs = [
            createMockNodeConfig({ name: 'node-a', title: '节点A' }),
            createMockNodeConfig({ name: 'node-b', title: '节点B', id: 2 }),
        ]
        const tools = await createSubAgentTools(configs, baseContext)
        expect(tools).toHaveLength(2)
    })

    it('工具名称格式正确（ask_{safeName}_expert）', async () => {
        const configs = [
            createMockNodeConfig({ name: 'legal-analysis', title: '法律分析' }),
        ]
        const tools = await createSubAgentTools(configs, baseContext)
        expect(tools).toHaveLength(1)
        expect(tools[0].name).toBe('ask_legal_analysis_expert')
    })

    it('跳过无可用 API Key 的节点', async () => {
        const configs = [
            createMockNodeConfig({ name: 'node-ok', title: '正常节点' }),
            createMockNodeConfig({
                name: 'node-no-key',
                title: '无密钥节点',
                id: 2,
                modelApiKeys: [],
            }),
            createMockNodeConfig({
                name: 'node-inactive-key',
                title: '密钥禁用节点',
                id: 3,
                modelApiKeys: [{ id: 1, apiKey: 'sk-disabled', status: 0 }],
            }),
        ]

        const tools = await createSubAgentTools(configs, baseContext)
        // 只有第一个节点有可用 API Key
        expect(tools).toHaveLength(1)
        expect(tools[0].name).toBe('ask_node_ok_expert')
    })

    it('工具描述使用节点 title', async () => {
        const configs = [
            createMockNodeConfig({ name: 'my-node', title: '我的专家节点' }),
        ]
        const tools = await createSubAgentTools(configs, baseContext)
        expect(tools[0].description).toBe('我的专家节点')
    })

    describe('子 Agent 持久化中间件', () => {
        it('工具调用时应挂载 analysisResultPersistenceMiddleware', async () => {
            const { createAgent } = await import('langchain')
            const { analysisResultPersistenceMiddleware } = await import(
                '../../../../server/services/workflow/middleware'
            )

            const configs = [
                createMockNodeConfig({ name: 'summary', title: '案件概要' }),
            ]
            const tools = await createSubAgentTools(configs, baseContext)

            // 实际调用工具以触发内部 createAgent
            await tools[0].invoke({ question: '分析案件' })

            // 验证 analysisResultPersistenceMiddleware 被正确调用
            expect(analysisResultPersistenceMiddleware).toHaveBeenCalledWith({
                agentName: 'summary',
                caseId: baseContext.caseId,
                sessionId: baseContext.sessionId,
            })

            // 验证 createAgent 收到的 middleware 数组长度为 2
            expect(createAgent).toHaveBeenCalled()
            const agentConfig = vi.mocked(createAgent).mock.calls[0][0] as { middleware: unknown[] }
            expect(agentConfig.middleware).toHaveLength(2)
        })

        it('应使用主 sessionId（非 subThreadId）', async () => {
            const { analysisResultPersistenceMiddleware } = await import(
                '../../../../server/services/workflow/middleware'
            )

            const configs = [
                createMockNodeConfig({ name: 'defense', title: '辩护策略' }),
            ]
            const tools = await createSubAgentTools(configs, baseContext)

            // 调用工具触发内部 createAgent
            await tools[0].invoke({ question: '生成辩护策略' })

            // sessionId 应为主 session 的 ID
            expect(analysisResultPersistenceMiddleware).toHaveBeenCalledWith(
                expect.objectContaining({
                    sessionId: 'test-session-id',
                })
            )
        })
    })
})
