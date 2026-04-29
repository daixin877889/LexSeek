/**
 * documentMainAgent buildContextSegments 接入测试
 *
 * **Feature: context-segments-rollout (Phase 5)**
 * **Validates: documentMainAgent 调用 buildContextSegments，caseId 真值/null 两个场景**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ==================== Mock 定义 ====================

const mockBuildContextSegments = vi.fn()
const mockBuildSystemPromptForAgent = vi.fn()
vi.mock('~~/server/services/workflow/context/moduleContextBuilder', () => ({
    buildContextSegments: (...args: unknown[]) => mockBuildContextSegments(...args),
    toCachedPrompt: () => [{ text: 'cached prompt' }],
    buildSystemPromptForAgent: (...args: unknown[]) => mockBuildSystemPromptForAgent(...args),
}))

vi.mock('~~/server/services/node/chatModelFactory', () => ({
    createChatModel: vi.fn(() => ({ __mock: 'model' })),
    cachedPromptToAnthropicContent: vi.fn(() => [{ type: 'text', text: 'sys' }]),
    cachedPromptToPlainText: vi.fn(() => 'sys plain'),
}))

const mockStream = vi.fn(async () => new ReadableStream<Uint8Array>({
    start(c) { c.close() },
}))
vi.mock('langchain', () => ({
    createAgent: vi.fn(() => ({ stream: mockStream })),
    summarizationMiddleware: vi.fn(() => ({})),
    toolStrategy: vi.fn(() => ({ __mock: 'responseFormat' })),
    createMiddleware: (cfg: any) => cfg,
}))

vi.mock('~~/server/services/workflow/checkpointer', () => ({
    getCheckpointer: vi.fn(async () => ({ __mock: 'checkpointer' })),
    getStore: vi.fn(async () => ({ __mock: 'store' })),
}))

const mockNodeConfig = {
    id: 1,
    name: 'documentMain',
    title: '文书生成主Agent',
    modelSdkType: 'openai',
    modelName: 'gpt-4o',
    modelProviderBaseUrl: 'https://api.openai.com/v1',
    modelMaxOutputTokens: 4096,
    modelContextWindow: 128000,
    modelApiKeys: [{ id: 1, apiKey: 'sk-test', status: 1 }],
    tools: [],
    prompts: [
        { name: 'system', content: 'doc role', type: 'system', status: 1 },
        {
            name: 'documentMain_user_with_files',
            type: 'user',
            status: 1,
            content: '请为《{{templateName}}》生成（fileIds={{fileIds}}）。{{userExtraText}}',
        },
        {
            name: 'documentMain_user_with_case',
            type: 'user',
            status: 1,
            content: '请为《{{templateName}}》生成（关联案件）。{{userExtraText}}',
        },
        {
            name: 'documentMain_user_standalone',
            type: 'user',
            status: 1,
            content: '请为《{{templateName}}》生成（独立草稿）。{{userExtraText}}',
        },
    ],
}
vi.mock('~~/server/services/node/node.service', () => ({
    getValidNodeConfig: vi.fn(async () => mockNodeConfig),
}))

const mockFindDraft = vi.fn()
vi.mock('~~/server/agents/document/documentDraft.dao', () => ({
    findDraftBySessionIdDAO: (...args: unknown[]) => mockFindDraft(...args),
}))

vi.mock('~~/server/agents/document/documentTemplate.dao', () => ({
    getDocumentTemplateDAO: vi.fn(async () => ({
        id: 9,
        name: '起诉状',
        category: '诉讼',
        placeholders: [],
    })),
}))

vi.mock('~~/server/agents/document/draftSchema.builder', () => ({
    buildDraftSchema: vi.fn(() => ({ __mock: 'schema' })),
}))

vi.mock('~~/server/services/workflow/utils/promptRenderer', () => ({
    renderSystemPrompt: vi.fn(() => 'rendered role+flow'),
}))

vi.mock('~~/server/services/workflow/tools', () => ({
    getToolInstancesService: vi.fn(() => []),
}))

const mockCaseMaterialContextMiddleware = vi.fn(() => ({ __mock: 'materialContext' }))
const mockBuildMiddlewareStack = vi.fn()

vi.mock('~~/server/services/workflow/middleware', async (importOriginal) => {
    const actual = await importOriginal<typeof import('~~/server/services/workflow/middleware')>()
    return {
        ...actual,
        createAuditMiddleware: vi.fn(() => ({})),
        createMessageIntegrityMiddleware: vi.fn(() => ({})),
        createScopeGuardMiddleware: vi.fn(() => ({})),
        pointConsumptionMiddleware: vi.fn(() => ({})),
        safetyTrimMiddleware: vi.fn(() => ({})),
        draftResultPersistenceMiddleware: vi.fn(() => ({})),
        caseMaterialContextMiddleware: (...args: unknown[]) => mockCaseMaterialContextMiddleware(...args),
        // 包装 actual.buildMiddlewareStack：保留真实互斥校验，同时观察入参
        buildMiddlewareStack: (items: any[]) => {
            mockBuildMiddlewareStack(items)
            return actual.buildMiddlewareStack(items)
        },
    }
})

vi.mock('~~/server/services/workflow/context/messageCompressor', () => ({
    resolveContextWindow: vi.fn(() => ({
        triggerTokens: 100000,
        maxTokens: 120000,
        maxOutputTokens: 4096,
    })),
}))

vi.stubGlobal('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })

// ==================== 测试用例 ====================

describe('runDocumentChat - buildContextSegments 接入', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockBuildContextSegments.mockResolvedValue({
            roleAndFlow: 'rendered role+flow',
            caseProfile: '',
            moduleSummaries: '',
            dynamicContext: '',
        })
        mockBuildSystemPromptForAgent.mockImplementation(async (_sdkType: string, params: unknown) => {
            const segments = await mockBuildContextSegments(params)
            return {
                segments,
                systemMessage: { content: 'mock-sys' },
                plainText: 'mock-plain',
            }
        })
    })

    it('draft.caseId 非空 → 透传真实 caseId 给 buildContextSegments', async () => {
        mockFindDraft.mockResolvedValueOnce({
            id: 1,
            sessionId: 'sess-1',
            templateId: 9,
            caseId: 555,
            sourceRef: { fileIds: [], text: '' },
        })

        const { runDocumentChat } = await import(
            '~~/server/services/workflow/agents/documentMainAgent'
        )

        await runDocumentChat('sess-1', '帮我起草', { userId: 1, caseId: 555 })

        expect(mockBuildContextSegments).toHaveBeenCalledTimes(1)
        const args = mockBuildContextSegments.mock.calls[0][0]
        expect(args.caseId).toBe(555)
        expect(args.agentName).toBe('documentMain')
        expect(args.userQuery).toBe('帮我起草')
        expect(args.roleAndFlowTemplate).toBe('rendered role+flow')
    })

    it('独立文书草稿（draft.caseId 为 null 且未传 options.caseId）→ caseId=null', async () => {
        mockFindDraft.mockResolvedValueOnce({
            id: 2,
            sessionId: 'sess-2',
            templateId: 9,
            caseId: null,
            sourceRef: { fileIds: [], text: '' },
        })

        const { runDocumentChat } = await import(
            '~~/server/services/workflow/agents/documentMainAgent'
        )

        await runDocumentChat('sess-2', undefined, { userId: 1 })

        expect(mockBuildContextSegments).toHaveBeenCalledTimes(1)
        const args = mockBuildContextSegments.mock.calls[0][0]
        expect(args.caseId).toBeNull()
        expect(args.agentName).toBe('documentMain')
    })
})

// ==================== 方案 A：caseMaterialContextMiddleware 挂载 ====================

import { MIDDLEWARE_PRIORITY } from '~~/server/services/agent-platform/middleware/types'

describe('runDocumentChat - caseMaterialContextMiddleware 挂载（方案 A）', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockCaseMaterialContextMiddleware.mockReturnValue({ __mock: 'materialContext' })
        mockBuildContextSegments.mockResolvedValue({
            roleAndFlow: 'r',
            caseProfile: '',
            moduleSummaries: '',
            dynamicContext: '',
        })
        mockBuildSystemPromptForAgent.mockImplementation(async () => ({
            segments: { roleAndFlow: 'r', caseProfile: '', moduleSummaries: '', dynamicContext: '' },
            systemMessage: { content: 'sys' },
            plainText: 'sys',
        }))
    })

    it('caseId 非空 → 挂载 caseMaterialContextMiddleware（priority=MATERIAL_CONTEXT）', async () => {
        mockFindDraft.mockResolvedValueOnce({
            id: 10,
            sessionId: 's-A',
            templateId: 9,
            caseId: 777,
            sourceRef: null,
        })
        const { runDocumentChat } = await import(
            '~~/server/services/workflow/agents/documentMainAgent'
        )
        await runDocumentChat('s-A', undefined, { userId: 1, caseId: 777 })

        expect(mockCaseMaterialContextMiddleware).toHaveBeenCalledWith(1, 777)
        const stackItems = mockBuildMiddlewareStack.mock.calls[0][0]
        const matEntry = stackItems.find((i: any) => i.name === 'caseMaterialContext')
        expect(matEntry).toBeDefined()
        expect(matEntry.priority).toBe(MIDDLEWARE_PRIORITY.MATERIAL_CONTEXT)
    })

    it('caseId 为空（独立文书草稿）→ 不挂 caseMaterialContextMiddleware', async () => {
        mockFindDraft.mockResolvedValueOnce({
            id: 11,
            sessionId: 's-B',
            templateId: 9,
            caseId: null,
            sourceRef: null,
        })
        const { runDocumentChat } = await import(
            '~~/server/services/workflow/agents/documentMainAgent'
        )
        await runDocumentChat('s-B', undefined, { userId: 2 })

        expect(mockCaseMaterialContextMiddleware).not.toHaveBeenCalled()
        const stackItems = mockBuildMiddlewareStack.mock.calls[0][0]
        expect(stackItems.find((i: any) => i.name === 'caseMaterialContext')).toBeUndefined()
    })
})
