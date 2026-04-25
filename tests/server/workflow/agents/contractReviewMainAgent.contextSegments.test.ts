/**
 * contractReviewMainAgent buildContextSegments 接入测试
 *
 * **Feature: context-segments-rollout (Phase 5)**
 * **Validates: contractReviewMainAgent 调用 buildContextSegments，caseId 真值/null 两个场景**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

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
}))

vi.mock('~~/server/services/workflow/checkpointer', () => ({
    getCheckpointer: vi.fn(async () => ({ __mock: 'checkpointer' })),
    getStore: vi.fn(async () => ({ __mock: 'store' })),
}))

const mockNodeConfig = {
    id: 1,
    name: 'contractReviewMain',
    title: '合同审查主Agent',
    modelSdkType: 'openai',
    modelName: 'gpt-4o',
    modelProviderBaseUrl: 'https://api.openai.com/v1',
    modelMaxOutputTokens: 4096,
    modelContextWindow: 128000,
    modelApiKeys: [{ id: 1, apiKey: 'sk-test', status: 1 }],
    tools: [],
    prompts: [{ name: 'system', content: 'contract role', type: 'system', status: 1 }],
}
vi.mock('~~/server/services/node/node.service', () => ({
    getValidNodeConfig: vi.fn(async () => mockNodeConfig),
}))

const mockFindReview = vi.fn()
vi.mock('~~/server/services/assistant/contract/contractReview.dao', () => ({
    findContractReviewBySessionIdDAO: (...args: unknown[]) => mockFindReview(...args),
    updateContractReviewDAO: vi.fn(),
}))

vi.mock('~~/server/services/assistant/contract/docx/loadContractFullText', () => ({
    loadContractFullText: vi.fn(async () => ({ fullText: '', paragraphs: [] })),
}))
vi.mock('~~/server/services/assistant/contract/docx/clauseSegmenter', () => ({
    segmentClauses: vi.fn(async () => ({ segments: [], normalizedText: '' })),
}))
vi.mock('~~/server/services/workflow/nodes/contractReviewStageEmitter', () => ({
    emitContractReviewEvent: vi.fn(),
}))

vi.mock('~~/server/services/workflow/utils/promptRenderer', () => ({
    renderSystemPrompt: vi.fn(() => 'rendered contract role'),
}))

vi.mock('~~/server/services/workflow/tools', () => ({
    getToolInstancesService: vi.fn(() => []),
}))

vi.mock('~~/server/services/workflow/middleware', () => ({
    pointConsumptionMiddleware: vi.fn(() => ({})),
    safetyTrimMiddleware: vi.fn(() => ({})),
    reviewResultPersistenceMiddleware: vi.fn(() => ({})),
    createMessageIntegrityMiddleware: vi.fn(() => ({})),
    createScopeGuardMiddleware: vi.fn(() => ({})),
    createAuditMiddleware: vi.fn(() => ({})),
    buildMiddlewareStack: vi.fn((items: unknown[]) => items.map(() => ({}))),
    MIDDLEWARE_PRIORITY: { MESSAGE_INTEGRITY: 1, SCOPE_GUARD: 2, POINT_CONSUMPTION: 3, SUMMARIZATION: 4, SAFETY_TRIM: 5, RESULT_PERSISTENCE: 6, AUDIT: 7 },
    MIDDLEWARE_NAMES: { MESSAGE_INTEGRITY: 'mi', SCOPE_GUARD: 'sg', POINT_CONSUMPTION: 'pc', SUMMARIZATION: 'sm', SAFETY_TRIM: 'st', REVIEW_RESULT_PERSISTENCE: 'rp', AUDIT: 'au' },
}))
vi.mock('~~/server/services/workflow/middleware/reviewResultPersistence.middleware', () => ({
    runAnnotateAndUpload: vi.fn(),
}))

vi.mock('~~/server/services/workflow/context/messageCompressor', () => ({
    resolveContextWindow: vi.fn(() => ({
        triggerTokens: 100000,
        maxTokens: 120000,
        maxOutputTokens: 4096,
    })),
}))

vi.stubGlobal('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
vi.stubGlobal('prisma', {
    contractReviews: { findUnique: vi.fn(async () => null) },
})

describe('runContractReviewChat - buildContextSegments 接入', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockBuildContextSegments.mockResolvedValue({
            roleAndFlow: 'rendered contract role',
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

    it('review.caseId 非空 → 透传真实 caseId 给 buildContextSegments', async () => {
        mockFindReview.mockResolvedValueOnce({
            id: 11,
            sessionId: 'sess-c1',
            originalFileId: 1,
            contractType: '租赁合同',
            caseId: 888,
            partyA: 'A',
            partyB: 'B',
        })

        const { runContractReviewChat } = await import(
            '~~/server/services/workflow/agents/contractReviewMainAgent'
        )

        await runContractReviewChat('sess-c1', { userId: 1 })

        expect(mockBuildContextSegments).toHaveBeenCalledTimes(1)
        const args = mockBuildContextSegments.mock.calls[0][0]
        expect(args.caseId).toBe(888)
        expect(args.agentName).toBe('contractReviewMain')
        expect(args.roleAndFlowTemplate).toBe('rendered contract role')
        expect(typeof args.userQuery).toBe('string')
        expect(args.userQuery).toContain('reviewId=11')
    })

    it('独立合同审查（review.caseId 为 null）→ caseId=null', async () => {
        mockFindReview.mockResolvedValueOnce({
            id: 22,
            sessionId: 'sess-c2',
            originalFileId: 2,
            contractType: null,
            caseId: null,
            partyA: null,
            partyB: null,
        })

        const { runContractReviewChat } = await import(
            '~~/server/services/workflow/agents/contractReviewMainAgent'
        )

        await runContractReviewChat('sess-c2', { userId: 1 })

        expect(mockBuildContextSegments).toHaveBeenCalledTimes(1)
        const args = mockBuildContextSegments.mock.calls[0][0]
        expect(args.caseId).toBeNull()
        expect(args.agentName).toBe('contractReviewMain')
    })
})
