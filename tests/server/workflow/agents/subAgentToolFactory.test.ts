/**
 * 子代理工具工厂测试
 *
 * **Feature: sub-agent-tool-factory**
 * **Validates: sanitizeName 处理特殊字符、工具生成、跳过无 API Key 节点、空配置、buildContextSegments 接入**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sanitizeName, createSubAgentTools } from '~~/server/services/agent-platform/subAgent/subAgentToolFactory'
import type { NodeConfig } from '~~/server/services/node/node.service'

// mock 依赖模块
vi.mock('~~/server/services/node/chatModelFactory', () => ({
    createChatModel: vi.fn(() => ({ /* mock model */ })),
    cachedPromptToAnthropicContent: vi.fn((segs: any[]) => segs.map(s => s.text).join('\n')),
    cachedPromptToPlainText: vi.fn((segs: any[]) => segs.map(s => s.text).join('\n')),
}))

vi.mock('~~/server/services/agent-platform/tools', () => ({
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
    summarizationMiddleware: vi.fn(() => ({})),
    createMiddleware: (cfg: any) => cfg,
}))

vi.mock('~~/server/services/agent-platform/middleware', () => ({
    createAuditMiddleware: vi.fn(() => ({})),
    createMessageIntegrityMiddleware: vi.fn(() => ({})),
    createScopeGuardMiddleware: vi.fn(() => ({})),
    pointConsumptionMiddleware: vi.fn(() => ({})),
    userInjectionMiddleware: vi.fn(() => ({})),
}))

vi.mock('~~/server/services/agent-platform/middleware/safetyTrim.middleware', () => ({
    safetyTrimMiddleware: vi.fn(() => ({})),
}))

vi.mock('~~/server/services/workflow/middleware/analysisResultPersistence.middleware', () => ({
    analysisResultPersistenceMiddleware: vi.fn(() => ({})),
}))

// 业务在 invoke 时调 buildLangfuseTopLevelConfig 注入 callbacks；测试态下让它直接透传 additionalCallbacks
vi.mock('~~/server/lib/langfuse', () => ({
    buildLangfuseTopLevelConfig: (override?: { additionalCallbacks?: any[] }) => ({
        callbacks: Array.isArray(override?.additionalCallbacks)
            ? override!.additionalCallbacks
            : override?.additionalCallbacks
                ? [override.additionalCallbacks]
                : [],
    }),
    withLangfuseContext: <T>(_ctx: unknown, fn: () => Promise<T> | T) => fn(),
    getLangfuseContext: () => undefined,
    buildLangfuseTraceMetadata: () => ({}),
}))

// afterAgentMemoryMiddleware：测试不验证记忆持久化，stub 即可
vi.mock('~~/server/services/agent-platform/middleware/afterAgentMemory.middleware', () => ({
    afterAgentMemoryMiddleware: vi.fn(() => ({})),
}))

// 4 个 skill 工具 + skills 中间件：默认无 skill，stub 全空
vi.mock('~~/server/services/agent-platform/middleware/skills', () => ({
    buildSkillsMiddlewareForNode: vi.fn().mockResolvedValue(null),
}))
vi.mock('~~/server/services/agent-platform/tools/readSkillFile.tool', () => ({
    createTool: vi.fn(() => ({ name: 'read_skill_file' })),
}))
vi.mock('~~/server/services/agent-platform/tools/writeSkillFile.tool', () => ({
    createTool: vi.fn(() => ({ name: 'write_skill_file' })),
}))
vi.mock('~~/server/services/agent-platform/tools/runSkillScript.tool', () => ({
    createTool: vi.fn(() => ({ name: 'run_skill_script' })),
}))
vi.mock('~~/server/services/agent-platform/tools/runSkillCommand.tool', () => ({
    createTool: vi.fn(() => ({ name: 'run_skill_command' })),
}))

vi.mock('~~/server/services/agent-platform/checkpointer', () => ({
    getCheckpointer: vi.fn(async () => ({
        getTuple: vi.fn().mockResolvedValue(null),
    })),
    getStore: vi.fn(async () => ({})),
}))

vi.mock('~~/server/services/agent-platform/context/messageCompressor', () => ({
    resolveContextWindow: vi.fn(() => ({
        triggerTokens: 100000,
        maxTokens: 200000,
        maxOutputTokens: 8192,
    })),
}))

// mock buildContextSegments / toCachedPrompt / buildSystemPromptForAgent（核心被测路径）
const buildContextSegmentsMock = vi.fn(async (_params: any) => ({
    roleAndFlow: '你是分析助手',
    caseProfile: '## 案件档案\n```json\n{"title":"测试"}\n```',
    moduleSummaries: '',
    dynamicContext: '',
}))
const buildSystemPromptForAgentMock = vi.fn(async (sdkType: string, params: any) => {
    const segments = await buildContextSegmentsMock(params)
    const plainText = [segments.roleAndFlow, segments.caseProfile, segments.moduleSummaries, segments.dynamicContext]
        .filter(Boolean).join('\n\n')
    const content = sdkType === 'anthropic'
        ? [{ type: 'text', text: plainText }]
        : plainText
    return {
        segments,
        systemMessage: { content, _getType: () => 'system' },
        plainText,
    }
})
vi.mock('~~/server/services/agent-platform/context/moduleContextBuilder', () => ({
    buildContextSegments: (params: any) => buildContextSegmentsMock(params),
    toCachedPrompt: vi.fn((segs: any) => [
        segs.roleAndFlow && { text: segs.roleAndFlow, cache: { ttl: '1h' } },
        segs.caseProfile && { text: segs.caseProfile, cache: { ttl: '1h' } },
        segs.moduleSummaries && { text: segs.moduleSummaries, cache: { ttl: '5m' } },
        segs.dynamicContext && { text: segs.dynamicContext },
    ].filter(Boolean)),
    buildSystemPromptForAgent: (sdkType: string, params: any) => buildSystemPromptForAgentMock(sdkType, params),
}))

// mock 自动导入的 logger
vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

// mock promptRenderer
vi.mock('~~/server/services/workflow/utils/promptRenderer', () => ({
    renderSystemPrompt: vi.fn(() => '你是分析助手'),
}))

// mock @langchain/core/messages
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
    SystemMessage: class SystemMessage {
        content: any
        constructor(opts: any) {
            if (typeof opts === 'string') { this.content = opts; return }
            this.content = opts.content
        }
        _getType() { return 'system' }
    },
}))

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
        expect(result).not.toMatch(/[一-鿿]/)
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

    describe('buildContextSegments 接入（Phase 3）', () => {
        it('工具调用时应通过 buildContextSegments 构建 5 段式上下文', async () => {
            const configs = [
                createMockNodeConfig({ name: 'evidence_expert', title: '证据专家' }),
            ]
            const tools = await createSubAgentTools(configs, baseContext)

            await tools[0].invoke({ question: '请分析证据链' })

            // 验证 buildContextSegments 被调用，且 agentName 用 NodeConfig.name
            expect(buildContextSegmentsMock).toHaveBeenCalledTimes(1)
            const callArgs = buildContextSegmentsMock.mock.calls[0][0]
            expect(callArgs).toMatchObject({
                caseId: baseContext.caseId,
                agentName: 'evidence_expert',
                userQuery: '请分析证据链',
                roleAndFlowTemplate: '你是分析助手',
            })
        })

        it('analysisResultPersistenceMiddleware 应使用子代理 NodeConfig.name 作为 agentName', async () => {
            const { analysisResultPersistenceMiddleware } = await import(
                '~~/server/services/workflow/middleware/analysisResultPersistence.middleware'
            )

            const configs = [
                createMockNodeConfig({ name: 'risk_expert', title: '风险专家' }),
            ]
            const tools = await createSubAgentTools(configs, baseContext)

            await tools[0].invoke({ question: '识别风险' })

            expect(analysisResultPersistenceMiddleware).toHaveBeenCalledWith(
                expect.objectContaining({
                    agentName: 'risk_expert',
                    caseId: baseContext.caseId,
                    sessionId: 'test-session-id',
                }),
            )
        })

        it('createAgent 接收 SystemMessage 实例作为 systemPrompt（而非纯字符串拼接进 messages）', async () => {
            const { createAgent } = await import('langchain')

            const configs = [
                createMockNodeConfig({ name: 'summary_expert', title: '概要专家' }),
            ]
            const tools = await createSubAgentTools(configs, baseContext)

            await tools[0].invoke({ question: '生成概要' })

            expect(createAgent).toHaveBeenCalled()
            const agentConfig = vi.mocked(createAgent).mock.calls[0][0] as { systemPrompt?: { content: unknown } }
            // 详见 subAgentToolFactory.ts:221 注释："systemPrompt 走 createAgent 参数（不塞 messages 数组）"
            expect(agentConfig.systemPrompt).toBeDefined()
            expect(agentConfig.systemPrompt!.content).toBeDefined()
        })
    })
})
