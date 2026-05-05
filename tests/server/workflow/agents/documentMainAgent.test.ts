/**
 * documentMainAgent 单测(新架构,标准 ReAct + 平级主 Agent)
 *
 * 删除测试范围:toolStrategy / responseFormat / buildDraftSchema / draftResultPersistence
 * 新增测试范围:中间件挂载 + 系统 prompt 注入 draft 状态 + 工具列表含三个新工具
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ==================== Mock 定义 ====================

vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

// mock langchain（createAgent, summarizationMiddleware）
const mockStream = vi.fn().mockReturnValue('mock-stream')
vi.mock('langchain', () => ({
    createAgent: vi.fn(() => ({ stream: mockStream })),
    summarizationMiddleware: vi.fn(() => ({ name: 'summarizationMiddleware' })),
}))

// mock @langchain/core/messages
vi.mock('@langchain/core/messages', () => ({
    HumanMessage: class MockHumanMessage {
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

// mock checkpointer
vi.mock('../../../../server/services/workflow/checkpointer', () => ({
    getCheckpointer: vi.fn().mockResolvedValue({ __mock: 'checkpointer' }),
    getStore: vi.fn().mockResolvedValue({ __mock: 'store' }),
}))

// mock node.service
const mockGetValidNodeConfig = vi.fn()
vi.mock('../../../../server/services/node/node.service', () => ({
    getValidNodeConfig: (...args: unknown[]) => mockGetValidNodeConfig(...args),
}))

// mock chatModelFactory
vi.mock('../../../../server/services/node/chatModelFactory', () => ({
    createChatModel: vi.fn(() => ({ name: 'mockModel' })),
}))

// mock workflow/tools（实现文件 import 的是 '../tools' 即 workflow/tools）
const mockGetToolInstancesService = vi.fn(() => [])
vi.mock('../../../../server/services/workflow/tools', () => ({
    getToolInstancesService: (...args: unknown[]) => mockGetToolInstancesService(...args),
}))

// mock promptRenderer
const mockRenderSystemPrompt = vi.fn((cfg: unknown, ctx: unknown) => `RENDERED:${JSON.stringify(ctx)}`)
vi.mock('../../../../server/services/workflow/utils/promptRenderer', () => ({
    renderSystemPrompt: (...args: unknown[]) => mockRenderSystemPrompt(...args),
}))

// mock moduleContextBuilder
vi.mock('../../../../server/services/workflow/context/moduleContextBuilder', () => ({
    buildSystemPromptForAgent: vi.fn().mockResolvedValue({
        systemMessage: { type: 'system', content: 'system' },
        plainText: 'plain',
    }),
}))

// mock messageCompressor
vi.mock('../../../../server/services/workflow/context/messageCompressor', () => ({
    resolveContextWindow: vi.fn(() => ({
        triggerTokens: 100000,
        maxTokens: 120000,
        maxOutputTokens: 4000,
    })),
}))

// mock workflow/middleware（需包含 buildMiddlewareStack + MIDDLEWARE_PRIORITY + MIDDLEWARE_NAMES）
vi.mock('../../../../server/services/workflow/middleware', () => ({
    createMessageIntegrityMiddleware: vi.fn(() => ({ name: 'messageIntegrity' })),
    createScopeGuardMiddleware: vi.fn(() => ({ name: 'scopeGuard' })),
    createAuditMiddleware: vi.fn(() => ({ name: 'audit' })),
    pointConsumptionMiddleware: vi.fn(() => ({ name: 'pointConsumption' })),
    safetyTrimMiddleware: vi.fn(() => ({ name: 'safetyTrim' })),
    buildMiddlewareStack: vi.fn((items: Array<{ middleware: unknown; name: string }>) =>
        items.map(i => i.middleware),
    ),
    MIDDLEWARE_PRIORITY: {
        MESSAGE_INTEGRITY: 1,
        SCOPE_GUARD: 5,
        POINT_CONSUMPTION: 20,
        SUMMARIZATION: 40,
        SAFETY_TRIM: 50,
        RESULT_PERSISTENCE: 90,
        AUDIT: 100,
    },
    MIDDLEWARE_NAMES: {
        MESSAGE_INTEGRITY: 'messageIntegrity',
        SCOPE_GUARD: 'scopeGuard',
        POINT_CONSUMPTION: 'pointConsumption',
        SUMMARIZATION: 'summarization',
        SAFETY_TRIM: 'safetyTrim',
        AUDIT: 'audit',
    },
}))

// mock afterAgentMemoryMiddleware
vi.mock('~~/server/services/agent-platform/middleware/afterAgentMemory.middleware', () => ({
    afterAgentMemoryMiddleware: vi.fn(() => ({ name: 'afterAgentMemory' })),
}))

// mock langfuse
vi.mock('~~/server/lib/langfuse', () => ({
    buildLangfuseTopLevelConfig: vi.fn((opts: { additionalCallbacks?: unknown[] }) => ({
        callbacks: opts?.additionalCallbacks ?? [],
    })),
}))

// mock documentDraft.dao
const mockFindDraftBySessionIdDAO = vi.fn()
vi.mock('../../../../server/services/assistant/document/documentDraft.dao', () => ({
    findDraftBySessionIdDAO: (...args: unknown[]) => mockFindDraftBySessionIdDAO(...args),
}))

// mock documentTemplate.dao
const mockGetDocumentTemplateDAO = vi.fn()
vi.mock('../../../../server/services/assistant/document/documentTemplate.dao', () => ({
    getDocumentTemplateDAO: (...args: unknown[]) => mockGetDocumentTemplateDAO(...args),
}))

// mock errorTraceHandler（动态 import 内）
vi.mock('~~/server/services/agent-platform/diagnostics/errorTraceHandler', () => ({
    createErrorTraceHandler: vi.fn(() => ({ __mock: 'errorTraceHandler' })),
}))

// ==================== 导入被测模块 ====================

import { runDocumentChat } from '~~/server/services/workflow/agents/documentMainAgent'
import { createAgent } from 'langchain'
import { buildSystemPromptForAgent } from '~~/server/services/workflow/context/moduleContextBuilder'

// ==================== 测试数据工厂 ====================

function makeNodeConfig(overrides: Record<string, unknown> = {}) {
    return {
        id: 17,
        name: 'documentMain',
        title: '文书生成主Agent',
        description: '',
        type: 'main',
        modelId: 1,
        modelType: 'chat',
        modelStatus: 1,
        modelProviderId: 1,
        modelProviderName: 'Anthropic',
        modelProviderDescription: '',
        modelSdkType: 'anthropic',
        modelName: 'deepseek-v4-flash',
        modelProviderBaseUrl: 'https://example.com',
        modelMaxOutputTokens: 4000,
        modelContextWindow: 100000,
        modelApiKeys: [{ id: 1, apiKey: 'sk-test', status: 1 }],
        tools: ['recommend_template', 'save_document_draft', 'update_document_draft'],
        prompts: [],
        outputSchema: null,
        ...overrides,
    }
}

function makeDraft(overrides: Record<string, unknown> = {}) {
    return {
        id: 100,
        sessionId: 'sess-x',
        templateId: 1,
        caseId: null,
        values: { 原告: '张三' },
        status: 'ready',
        sourceRef: null,
        ...overrides,
    }
}

function makeTemplate(overrides: Record<string, unknown> = {}) {
    return {
        id: 1,
        name: '民事起诉状',
        category: '民事',
        placeholders: [
            { name: '原告', firstContext: '原告:{{原告}}' },
            { name: '被告', firstContext: '被告:{{被告}}' },
        ],
        ...overrides,
    }
}

// ==================== 测试用例 ====================

describe('documentMainAgent (新架构)', () => {
    beforeEach(() => {
        vi.resetAllMocks()

        // 重置 mockStream
        mockStream.mockReturnValue('mock-stream')
        ;(createAgent as ReturnType<typeof vi.fn>).mockReturnValue({ stream: mockStream })

        // 默认 mock 返回值
        mockGetValidNodeConfig.mockResolvedValue(makeNodeConfig())
        mockFindDraftBySessionIdDAO.mockResolvedValue(makeDraft())
        mockGetDocumentTemplateDAO.mockResolvedValue(makeTemplate())
        mockRenderSystemPrompt.mockImplementation((_cfg: unknown, ctx: unknown) => `RENDERED:${JSON.stringify(ctx)}`)
        mockGetToolInstancesService.mockReturnValue([])
        ;(buildSystemPromptForAgent as ReturnType<typeof vi.fn>).mockResolvedValue({
            systemMessage: { type: 'system', content: 'system' },
            plainText: 'plain',
        })
    })

    it('createAgent 调用不含 responseFormat(toolStrategy 已删)', async () => {
        await runDocumentChat('sess-x', '帮我起草起诉状', { userId: 1 })

        const callArgs = (createAgent as ReturnType<typeof vi.fn>).mock.calls[0][0]
        expect(callArgs).not.toHaveProperty('responseFormat')
    })

    it('renderSystemPrompt 接收新增的 4 个字段(draftId/status/currentValuesJSON/placeholdersWithHints)', async () => {
        await runDocumentChat('sess-x', '帮我起草', { userId: 1 })

        expect(mockRenderSystemPrompt).toHaveBeenCalledWith(
            expect.any(Object),
            expect.objectContaining({
                draftId: 100,
                status: 'ready',
                currentValuesJSON: expect.stringContaining('原告'),
                placeholdersWithHints: expect.stringContaining('原告'),
            }),
        )
    })

    it('caseId 为 null 时不挂 afterAgentMemory 中间件', async () => {
        // draft.caseId = null（默认），options 也不传 caseId
        await runDocumentChat('sess-x', '帮我起草', { userId: 1 })

        const { buildMiddlewareStack } = await import('../../../../server/services/workflow/middleware')
        const callItems = (buildMiddlewareStack as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{ name: string }>
        const names = callItems.map(i => i.name)
        expect(names).not.toContain('afterAgentMemory')
    })

    it('caseId 非空时挂 afterAgentMemory 中间件', async () => {
        mockFindDraftBySessionIdDAO.mockResolvedValue(makeDraft({ caseId: 5 }))

        await runDocumentChat('sess-x', '帮我起草', { userId: 1, caseId: 5 })

        const { buildMiddlewareStack } = await import('../../../../server/services/workflow/middleware')
        const callItems = (buildMiddlewareStack as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{ name: string }>
        const names = callItems.map(i => i.name)
        expect(names).toContain('afterAgentMemory')
    })

    it('工具列表包含 recommend_template / save_document_draft / update_document_draft', async () => {
        await runDocumentChat('sess-x', '帮我起草', { userId: 1 })

        expect(mockGetToolInstancesService).toHaveBeenCalledWith(
            expect.arrayContaining(['recommend_template', 'save_document_draft', 'update_document_draft']),
            expect.any(Object),
        )
    })

    it('draft 不存在时抛错', async () => {
        mockFindDraftBySessionIdDAO.mockResolvedValue(null)

        await expect(runDocumentChat('sess-missing', 'msg', { userId: 1 }))
            .rejects.toThrow('未找到 sessionId=sess-missing')
    })
})
