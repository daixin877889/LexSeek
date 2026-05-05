/**
 * 模块对话 Agent moduleAgent 测试
 *
 * **Feature: context-segments-rollout / phase-2**
 * **Validates: runModuleChat 改用 buildContextSegments 替换 moduleContextMiddleware**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ==================== Mock 定义 ====================

// mock langchain（createAgent, summarizationMiddleware）
const mockStream = vi.fn()
vi.mock('langchain', () => ({
    createAgent: vi.fn(() => ({ stream: mockStream })),
    summarizationMiddleware: vi.fn(() => ({ __mock: 'summarization' })),
    createMiddleware: (cfg: any) => cfg,
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
    resolveThinkingFromNodeConfig: vi.fn(() => false),
}))

// mock chatModelFactory
vi.mock('../../../../server/services/node/chatModelFactory', () => ({
    createChatModel: vi.fn(() => ({ __mock: 'model' })),
    cachedPromptToAnthropicContent: vi.fn((segs: any[]) =>
        segs.map(s => ({ type: 'text', text: s.text })),
    ),
    cachedPromptToPlainText: vi.fn((segs: any[]) =>
        segs.map(s => s.text).join('\n\n'),
    ),
}))

// mock buildContextSegments + buildSystemPromptForAgent（helper 内部委托回 mock 链）
const mockBuildContextSegments = vi.fn()
const mockBuildSystemPromptForAgent = vi.fn()
vi.mock('../../../../server/services/workflow/context/moduleContextBuilder', async () => {
    const chatFactoryMock = await import('../../../../server/services/node/chatModelFactory')
    const messagesMock = await import('@langchain/core/messages')
    const toCached = (segs: { roleAndFlow: string; caseProfile: string; moduleSummaries: string; dynamicContext: string }) => {
        const out: Array<{ text: string; cache?: { ttl?: '1h' } }> = []
        if (segs.roleAndFlow) out.push({ text: segs.roleAndFlow, cache: { ttl: '1h' } })
        if (segs.caseProfile) out.push({ text: segs.caseProfile, cache: { ttl: '1h' } })
        if (segs.moduleSummaries) out.push({ text: segs.moduleSummaries })
        if (segs.dynamicContext) out.push({ text: segs.dynamicContext })
        return out
    }
    mockBuildSystemPromptForAgent.mockImplementation(async (sdkType: string, params: unknown) => {
        const segments = await mockBuildContextSegments(params)
        const cached = toCached(segments)
        const plainText = chatFactoryMock.cachedPromptToPlainText(cached as any)
        const content = sdkType === 'anthropic'
            ? chatFactoryMock.cachedPromptToAnthropicContent(cached as any)
            : plainText
        return {
            segments,
            systemMessage: new messagesMock.SystemMessage({ content: content as any }),
            plainText,
        }
    })
    return {
        buildContextSegments: (...args: unknown[]) => mockBuildContextSegments(...args),
        toCachedPrompt: toCached,
        buildSystemPromptForAgent: (...args: unknown[]) => mockBuildSystemPromptForAgent(...args),
    }
})

// mock messageCompressor
vi.mock('../../../../server/services/workflow/context/messageCompressor', () => ({
    resolveContextWindow: vi.fn(() => ({
        triggerTokens: 100000,
        maxTokens: 120000,
        maxOutputTokens: 8192,
    })),
}))

// mock tools
const mockGetToolInstances = vi.fn()
vi.mock('../../../../server/services/workflow/tools', () => ({
    getToolInstancesService: (...args: unknown[]) => mockGetToolInstances(...args),
}))

// mock middleware
vi.mock('../../../../server/services/workflow/middleware', () => ({
    createAuditMiddleware: vi.fn(() => ({ __mock: 'audit' })),
    createMessageIntegrityMiddleware: vi.fn(() => ({ __mock: 'integrity' })),
    createScopeGuardMiddleware: vi.fn(() => ({ __mock: 'scopeGuard' })),
    pointConsumptionMiddleware: vi.fn(() => ({ __mock: 'pointConsumption' })),
}))

vi.mock('../../../../server/services/workflow/middleware/safetyTrim.middleware', () => ({
    safetyTrimMiddleware: vi.fn(() => ({ __mock: 'safetyTrim' })),
}))

// mock saveAnalysisResult tool
vi.mock('../../../../server/services/workflow/tools/saveAnalysisResult.tool', () => ({
    createTool: vi.fn(() => ({ name: 'save_analysis_result', invoke: vi.fn() })),
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

// mock deepagents
vi.mock('deepagents', () => ({
    createSkillsMiddleware: vi.fn(() => ({ __mock: 'skills' })),
    FilesystemBackend: class {
        constructor(_opts: unknown) {}
    },
}))

// mock state/storage
vi.mock('../../../../server/services/workflow/state/storage', () => ({
    getSessionState: vi.fn(async () => ({})),
}))

// mock promptRenderer
vi.mock('../../../../server/services/workflow/utils/promptRenderer', () => ({
    renderSystemPrompt: vi.fn(() => '你是案件摘要专家'),
}))

// mock @langchain/core/messages
vi.mock('@langchain/core/messages', () => ({
    HumanMessage: class HumanMessage {
        content: string
        constructor(content: string) {
            this.content = content
        }
    },
    SystemMessage: class SystemMessage {
        content: unknown
        _kind = 'system'
        constructor(opts: { content: unknown } | string) {
            this.content = typeof opts === 'string' ? opts : opts.content
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

function createNodeConfig(sdkType: 'anthropic' | 'openai' | 'deepseek' = 'anthropic') {
    return {
        id: 1,
        name: 'summary',
        title: '案件摘要',
        description: '案件摘要分析',
        type: 'analysis',
        prompts: [
            { id: 1, name: 'system', content: '你是案件摘要专家', version: '1.0', type: 'system', status: 1 },
        ],
        modelId: 1,
        modelName: 'claude-sonnet-4-5',
        modelType: 'chat',
        modelStatus: 1,
        modelSdkType: sdkType,
        modelProviderId: 1,
        modelProviderName: sdkType,
        modelProviderBaseUrl: 'https://api.example.com',
        modelProviderDescription: '',
        modelApiKeys: [{ id: 1, apiKey: 'sk-test', status: 1 }],
        modelContextWindow: 200000,
        modelMaxOutputTokens: 8192,
        tools: [],
        outputSchema: null,
    }
}

// ==================== 测试用例 ====================

describe('runModuleChat 模块对话 Agent', () => {
    const mockReadableStream = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode('event: values\ndata: {}\n\n'))
            controller.close()
        },
    })

    beforeEach(() => {
        vi.clearAllMocks()

        mockGetValidNodeConfig.mockResolvedValue(createNodeConfig())
        mockGetToolInstances.mockReturnValue([])
        mockBuildContextSegments.mockResolvedValue({
            roleAndFlow: '你是案件摘要专家\n\n当你完成该模块的分析后，请按以下顺序操作：1) 先以纯文本形式输出完整的分析报告（Markdown 格式）；2) 然后调用 save_analysis_result 工具（无需任何参数）。工具会自动从你刚输出的报告中读取内容保存。请勿在工具参数中重复正文。',
            caseProfile: '## 案件档案\n```json\n{}\n```',
            moduleSummaries: '## 已完成分析模块\n### chronicle\n大事记摘要',
            dynamicContext: '## 案件材料清单\n- 起诉状.pdf',
        })
        mockStream.mockResolvedValue(mockReadableStream)
    })

    it('使用 moduleName 作为 agentName 调用 buildContextSegments', async () => {
        const { runModuleChat } = await import(
            '../../../../server/services/workflow/agents/moduleAgent'
        )

        await runModuleChat('session-1', '请分析摘要', {
            userId: 1,
            caseId: 100,
            moduleName: 'summary',
            nodeId: 1,
        })

        expect(mockBuildContextSegments).toHaveBeenCalledTimes(1)
        const args = mockBuildContextSegments.mock.calls[0][0]
        // 2026-05-05 改造后：4 段案件上下文交给 caseContextSyncMiddleware 注入 HumanMessage，
        // SystemMessage 仅含 roleAndFlow，buildSystemPromptForAgent 走 caseId=null 退化路径
        // （与 assistantAgent / runtime.ts 同款）；agentName 仍为 moduleName。
        expect(args).toMatchObject({
            caseId: null,
            agentName: 'summary',
            userQuery: '',
        })
        // roleAndFlowTemplate 应包含 renderSystemPrompt 渲染结果 + save_analysis_result 提醒
        expect(args.roleAndFlowTemplate).toContain('你是案件摘要专家')
        expect(args.roleAndFlowTemplate).toContain('save_analysis_result')
        // 新提示词：禁止 LLM 在工具参数中复述正文（避免输出量翻倍）
        expect(args.roleAndFlowTemplate).toContain('无需任何参数')
        expect(args.roleAndFlowTemplate).toContain('请勿在工具参数中重复正文')
    })

    it('Anthropic 模型 SystemMessage content 为 blocks 数组', async () => {
        mockGetValidNodeConfig.mockResolvedValue(createNodeConfig('anthropic'))

        const { createAgent } = await import('langchain')
        const { runModuleChat } = await import(
            '../../../../server/services/workflow/agents/moduleAgent'
        )

        await runModuleChat('session-2', '分析', {
            userId: 1,
            caseId: 200,
            moduleName: 'summary',
            nodeId: 1,
        })

        const call = vi.mocked(createAgent).mock.calls.at(-1)![0] as any
        expect(call.systemPrompt).toBeDefined()
        expect(call.systemPrompt._kind).toBe('system')
        expect(Array.isArray(call.systemPrompt.content)).toBe(true)
    })

    it('非 Anthropic 模型 SystemMessage content 为纯字符串', async () => {
        mockGetValidNodeConfig.mockResolvedValue(createNodeConfig('openai'))

        const { createAgent } = await import('langchain')
        const { runModuleChat } = await import(
            '../../../../server/services/workflow/agents/moduleAgent'
        )

        await runModuleChat('session-3', '分析', {
            userId: 1,
            caseId: 300,
            moduleName: 'summary',
            nodeId: 1,
        })

        const call = vi.mocked(createAgent).mock.calls.at(-1)![0] as any
        expect(call.systemPrompt._kind).toBe('system')
        expect(typeof call.systemPrompt.content).toBe('string')
        expect(call.systemPrompt.content).toContain('你是案件摘要专家')
    })

    it('middleware 链不再包含 moduleContextMiddleware', async () => {
        const { createAgent } = await import('langchain')
        const { runModuleChat } = await import(
            '../../../../server/services/workflow/agents/moduleAgent'
        )

        await runModuleChat('session-4', '分析', {
            userId: 1,
            caseId: 400,
            moduleName: 'summary',
            nodeId: 1,
        })

        // moduleContext.middleware 文件已被 Phase 6 删除；断言 middleware 列表中无名为 moduleContext 的 mock 标签
        const call = vi.mocked(createAgent).mock.calls.at(-1)![0] as any
        const labels = (call.middleware as Array<{ __mock?: string }>).map(m => m.__mock)
        expect(labels).not.toContain('moduleContext')
    })

    it('safetyTrim 收到的 systemPrompt 是 plain text（非 SystemMessage）', async () => {
        mockGetValidNodeConfig.mockResolvedValue(createNodeConfig('anthropic'))

        const { safetyTrimMiddleware } = await import(
            '../../../../server/services/workflow/middleware/safetyTrim.middleware'
        )
        const { runModuleChat } = await import(
            '../../../../server/services/workflow/agents/moduleAgent'
        )

        await runModuleChat('session-5', '分析', {
            userId: 1,
            caseId: 500,
            moduleName: 'summary',
            nodeId: 1,
        })

        const opts = vi.mocked(safetyTrimMiddleware).mock.calls.at(-1)![0]
        expect(typeof opts.systemPrompt).toBe('string')
        expect(opts.systemPrompt).toContain('你是案件摘要专家')
    })
})
