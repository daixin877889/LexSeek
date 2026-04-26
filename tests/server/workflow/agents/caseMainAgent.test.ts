/**
 * 主代理 caseMainAgent 测试
 *
 * **Feature: case-main-agent**
 * **Validates: runCaseChat 接入 buildContextSegments 注入 SystemMessage**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NodeConfig } from '../../../../server/services/node/node.service'

// ==================== Mock 定义 ====================

// mock @langchain/core/messages：必须先于 langchain mock，因为 SystemMessage 需要可识别的实例
class MockSystemMessage {
    content: unknown
    constructor(opts: { content: unknown }) {
        this.content = opts.content
    }
}
class MockHumanMessage {
    content: string
    constructor(content: string) {
        this.content = content
    }
}
vi.mock('@langchain/core/messages', () => ({
    HumanMessage: MockHumanMessage,
    SystemMessage: MockSystemMessage,
}))

// mock langchain（createAgent, summarizationMiddleware 等）
const mockStream = vi.fn()
vi.mock('langchain', () => ({
    createAgent: vi.fn(() => ({
        stream: mockStream,
    })),
    summarizationMiddleware: vi.fn(() => ({ name: 'summarizationMiddleware' })),
    todoListMiddleware: vi.fn(() => ({ name: 'todoListMiddleware' })),
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

// mock chatModelFactory：含 cachedPromptToAnthropicContent / cachedPromptToPlainText
const mockCachedPromptToAnthropicContent = vi.fn(
    (segments: Array<{ text: string; cache?: { ttl?: '1h' } }>) =>
        segments.map((s) => ({ type: 'text', text: s.text })),
)
const mockCachedPromptToPlainText = vi.fn(
    (segments: Array<{ text: string }>) => segments.map((s) => s.text).join('\n\n'),
)
vi.mock('../../../../server/services/node/chatModelFactory', () => ({
    createChatModel: vi.fn(() => ({ __mock: 'model' })),
    cachedPromptToAnthropicContent: (...args: unknown[]) =>
        mockCachedPromptToAnthropicContent(...(args as [any])),
    cachedPromptToPlainText: (...args: unknown[]) =>
        mockCachedPromptToPlainText(...(args as [any])),
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

// mock promptRenderer
vi.mock('../../../../server/services/workflow/utils/promptRenderer', () => ({
    renderSystemPrompt: vi.fn(() => '你是案件主代理，roleAndFlow 模板渲染结果'),
}))

// mock moduleContextBuilder：buildSystemPromptForAgent 内部委托回 buildContextSegments
// + toCachedPrompt + cache helpers 的 mock，这样原有断言（mockBuildContextSegments /
// mockCachedPromptToAnthropicContent / mockCachedPromptToPlainText）仍然成立
const mockBuildContextSegments = vi.fn()
const mockToCachedPrompt = vi.fn()
const mockBuildSystemPromptForAgent = vi.fn()
vi.mock('../../../../server/services/workflow/context/moduleContextBuilder', () => ({
    buildContextSegments: (...args: unknown[]) => mockBuildContextSegments(...args),
    toCachedPrompt: (...args: unknown[]) => mockToCachedPrompt(...args),
    buildSystemPromptForAgent: (...args: unknown[]) => mockBuildSystemPromptForAgent(...args),
}))

// mock middleware（涵盖 caseMainAgent 用到的全部成员）
const mockMessageIntegrity = vi.fn(() => ({ name: 'createMessageIntegrityMiddleware' }))
const mockScopeGuard = vi.fn(() => ({ name: 'createScopeGuardMiddleware' }))
const mockAudit = vi.fn(() => ({ name: 'createAuditMiddleware' }))
const mockPointConsumption = vi.fn(() => ({ name: 'pointConsumptionMiddleware' }))
const mockCaseProcessMaterial = vi.fn(() => ({ name: 'caseProcessMaterialMiddleware' }))
const mockSafetyTrim = vi.fn((opts: unknown) => ({
    name: 'safetyTrimMiddleware',
    __opts: opts,
}))
vi.mock('../../../../server/services/workflow/middleware', () => ({
    createMessageIntegrityMiddleware: (...args: unknown[]) => mockMessageIntegrity(...args),
    createScopeGuardMiddleware: (...args: unknown[]) => mockScopeGuard(...args),
    createAuditMiddleware: (...args: unknown[]) => mockAudit(...args),
    pointConsumptionMiddleware: (...args: unknown[]) => mockPointConsumption(...args),
    caseProcessMaterialMiddleware: (...args: unknown[]) => mockCaseProcessMaterial(...args),
    safetyTrimMiddleware: (...args: unknown[]) => mockSafetyTrim(...(args as [any])),
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

// mock deepagents：避免初始化真实 FilesystemBackend
vi.mock('deepagents', () => ({
    createSkillsMiddleware: vi.fn(() => ({ name: 'skillsMiddleware' })),
    FilesystemBackend: class FilesystemBackend {
        constructor(_opts: unknown) {}
    },
}))

// mock skill tools
vi.mock('../../../../server/services/workflow/tools/readSkillFile.tool', () => ({
    createTool: vi.fn(() => ({ name: 'read_skill_file', invoke: vi.fn() })),
}))
vi.mock('../../../../server/services/workflow/tools/writeSkillFile.tool', () => ({
    createTool: vi.fn(() => ({ name: 'write_skill_file', invoke: vi.fn() })),
}))
vi.mock('../../../../server/services/workflow/tools/runSkillScript.tool', () => ({
    createTool: vi.fn(() => ({ name: 'run_skill_script', invoke: vi.fn() })),
}))
vi.mock('../../../../server/services/workflow/tools/runSkillCommand.tool', () => ({
    createTool: vi.fn(() => ({ name: 'run_skill_command', invoke: vi.fn() })),
}))
vi.mock('../../../../server/services/workflow/tools/uploadWorkspaceFile.tool', () => ({
    createTool: vi.fn(() => ({ name: 'upload_workspace_file', invoke: vi.fn() })),
}))

// mock messageCompressor.resolveContextWindow
vi.mock('../../../../server/services/workflow/context/messageCompressor', () => ({
    resolveContextWindow: vi.fn(() => ({
        triggerTokens: 100000,
        maxTokens: 120000,
        maxOutputTokens: 8000,
    })),
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
    } as NodeConfig
}

/** 默认 segments 返回值 */
const defaultSegs = {
    roleAndFlow: '你是案件主代理，roleAndFlow 模板渲染结果',
    caseProfile: '## 案件档案\n```json\n{}\n```',
    moduleSummaries: '',
    dynamicContext: '',
}

/** 默认 cached prompt 返回值 */
const defaultCached = [
    { text: defaultSegs.roleAndFlow, cache: { ttl: '1h' as const } },
    { text: defaultSegs.caseProfile, cache: { ttl: '1h' as const } },
]

// ==================== 测试用例 ====================

describe('runCaseChat 接入 buildContextSegments', () => {
    /** 模拟 ReadableStream 返回值 */
    const mockReadableStream = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode('event: values\ndata: {}\n\n'))
            controller.close()
        },
    })

    beforeEach(() => {
        vi.clearAllMocks()

        mockGetValidNodeConfig.mockResolvedValue(createMainNodeConfig())
        mockGetNodeConfigsByTypes.mockResolvedValue([])
        mockGetToolInstances.mockReturnValue([
            { name: 'search', invoke: vi.fn() },
            { name: 'calculator', invoke: vi.fn() },
        ])
        mockCreateSubAgentTools.mockResolvedValue([])
        mockBuildContextSegments.mockResolvedValue(defaultSegs)
        mockToCachedPrompt.mockReturnValue(defaultCached)
        mockBuildSystemPromptForAgent.mockImplementation(async (sdkType: string, params: unknown) => {
            const segments = await mockBuildContextSegments(params)
            const cached = mockToCachedPrompt(segments)
            const plainText = mockCachedPromptToPlainText(cached)
            const content = sdkType === 'anthropic'
                ? mockCachedPromptToAnthropicContent(cached)
                : plainText
            return { segments, systemMessage: new MockSystemMessage({ content }), plainText }
        })
        mockStream.mockResolvedValue(mockReadableStream)
    })

    it('调用 buildContextSegments 并传入 caseId / agentName=caseMain / userQuery', async () => {
        const { runCaseChat } = await import(
            '../../../../server/services/workflow/agents/caseMainAgent'
        )

        await runCaseChat('session-ctx-1', '请分析这个案件', {
            userId: 1,
            caseId: 700,
        })

        expect(mockBuildContextSegments).toHaveBeenCalledTimes(1)
        const args = mockBuildContextSegments.mock.calls[0][0]
        expect(args.caseId).toBe(700)
        expect(args.agentName).toBe('caseMain')
        expect(args.userQuery).toBe('请分析这个案件')
        // 业务侧在 renderSystemPrompt 之后追加了"工具选择规则（铁律）"和"综合题应对（铁律）"两段
        // 测试只断言 roleAndFlowTemplate 包含 mock 的渲染结果与两段铁律标题，不再做完全相等比较
        expect(args.roleAndFlowTemplate).toContain('你是案件主代理，roleAndFlow 模板渲染结果')
        expect(args.roleAndFlowTemplate).toContain('## 工具选择规则（铁律）')
        expect(args.roleAndFlowTemplate).toContain('## 综合题应对（铁律）')
    })

    it('中断恢复路径（command 存在 / message=undefined）userQuery 用空字符串', async () => {
        const { runCaseChat } = await import(
            '../../../../server/services/workflow/agents/caseMainAgent'
        )

        await runCaseChat('session-resume', undefined, {
            userId: 1,
            caseId: 800,
            command: { action: 'approve' },
        })

        expect(mockBuildContextSegments).toHaveBeenCalledTimes(1)
        const args = mockBuildContextSegments.mock.calls[0][0]
        expect(args.userQuery).toBe('')
    })

    it('createAgent 收到的 systemPrompt 是 SystemMessage 实例（非裸字符串）', async () => {
        const { createAgent } = await import('langchain')
        const { runCaseChat } = await import(
            '../../../../server/services/workflow/agents/caseMainAgent'
        )

        await runCaseChat('session-sysmsg', '问问题', { userId: 1, caseId: 900 })

        expect(createAgent).toHaveBeenCalledTimes(1)
        const callArg = vi.mocked(createAgent).mock.calls[0][0] as { systemPrompt: unknown }
        expect(callArg.systemPrompt).toBeInstanceOf(MockSystemMessage)
    })

    it('Anthropic SDK：systemPrompt 内容来自 cachedPromptToAnthropicContent（block 数组）', async () => {
        mockGetValidNodeConfig.mockResolvedValue(
            createMainNodeConfig({ modelSdkType: 'anthropic' }),
        )

        const { createAgent } = await import('langchain')
        const { runCaseChat } = await import(
            '../../../../server/services/workflow/agents/caseMainAgent'
        )

        await runCaseChat('session-anthropic', '问问题', { userId: 1, caseId: 901 })

        expect(mockCachedPromptToAnthropicContent).toHaveBeenCalledTimes(1)
        const callArg = vi.mocked(createAgent).mock.calls[0][0] as {
            systemPrompt: MockSystemMessage
        }
        expect(Array.isArray(callArg.systemPrompt.content)).toBe(true)
    })

    it('OpenAI SDK：systemPrompt 内容来自 cachedPromptToPlainText（字符串）', async () => {
        // default modelSdkType = 'openai'
        const { createAgent } = await import('langchain')
        const { runCaseChat } = await import(
            '../../../../server/services/workflow/agents/caseMainAgent'
        )

        await runCaseChat('session-openai', '问问题', { userId: 1, caseId: 902 })

        // toCachedPrompt 调一次给 createAgent 的 SystemMessage、再调一次给 safetyTrim 的 plainText
        // cachedPromptToPlainText：openai 路径 systemContent 用一次 + safetyTrim 用一次 = 2 次
        expect(mockCachedPromptToPlainText).toHaveBeenCalled()
        const callArg = vi.mocked(createAgent).mock.calls[0][0] as {
            systemPrompt: MockSystemMessage
        }
        expect(typeof callArg.systemPrompt.content).toBe('string')
    })

    it('createAgent 收到的 middleware 列表不再包含 moduleContextMiddleware', async () => {
        const { createAgent } = await import('langchain')
        const { runCaseChat } = await import(
            '../../../../server/services/workflow/agents/caseMainAgent'
        )

        await runCaseChat('session-mws', '问', { userId: 1, caseId: 903 })

        const callArg = vi.mocked(createAgent).mock.calls[0][0] as {
            middleware: Array<Record<string, unknown>>
        }
        const names = callArg.middleware
            .map((m) => (m && typeof m === 'object' ? (m as { name?: string }).name : undefined))
            .filter((n): n is string => Boolean(n))
        expect(names).not.toContain('moduleContextMiddleware')
        // 同时确认 caseProcessMaterialMiddleware 仍在（保证未误删其它中间件）
        expect(names).toContain('caseProcessMaterialMiddleware')
    })

    it('safetyTrimMiddleware 收到 plain text 形式的 systemPrompt（仅用于 token 估算）', async () => {
        const { runCaseChat } = await import(
            '../../../../server/services/workflow/agents/caseMainAgent'
        )

        await runCaseChat('session-safety', '问', { userId: 1, caseId: 904 })

        expect(mockSafetyTrim).toHaveBeenCalledTimes(1)
        const opts = mockSafetyTrim.mock.calls[0][0] as { systemPrompt: unknown }
        expect(typeof opts.systemPrompt).toBe('string')
        // plain text 应为各段拼接
        expect(opts.systemPrompt).toContain('roleAndFlow 模板渲染结果')
    })

    it('无可用 API Key 时抛出错误', async () => {
        mockGetValidNodeConfig.mockResolvedValue(
            createMainNodeConfig({ modelApiKeys: [] }),
        )

        const { runCaseChat } = await import(
            '../../../../server/services/workflow/agents/caseMainAgent'
        )

        await expect(
            runCaseChat('session-noapikey', '测试', { userId: 1, caseId: 600 }),
        ).rejects.toThrow('没有可用的 API 密钥')
    })
})
