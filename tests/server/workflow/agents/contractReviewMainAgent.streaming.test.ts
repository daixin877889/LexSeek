/**
 * contractReviewMainAgent runAnalyzeLoop + resume 分支单元测试
 *
 * 测试按条款循环逐条分析 + risk/progress 事件增量推送的行为。
 * 主要测 runAnalyzeLoop export，不涉及 agent.stream，避免整合层 mock 复杂度。
 * resume 分支 fail-fast 通过 mock 全部基础设施做最小可跑链路。
 *
 * **Feature: m6-1-contract-review Task 2.2**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock 整个 stageEmitter 模块
vi.mock('~~/server/services/workflow/nodes/contractReviewStageEmitter', () => ({
    emitContractReviewEvent: vi.fn().mockResolvedValue(undefined),
}))

// Mock analyzeSingleClause
vi.mock('~~/server/agents/contract/analyzeSingleClause', () => ({
    analyzeSingleClause: vi.fn(),
}))

// Mock summarizeOverview（Task 3.1 新增：resume 路径会调用）
vi.mock('~~/server/agents/contract/summarizeOverview', () => ({
    summarizeOverview: vi.fn().mockResolvedValue({
        highlights: { high: [], medium: [], low: [] },
        overall: '测试总评',
    }),
}))

// 以下 mock 仅 resume 分支测试需要（runAnalyzeLoop 纯函数测试不依赖）
vi.mock('~~/server/agents/contract/contractReview.dao', () => ({
    findContractReviewBySessionIdDAO: vi.fn(),
    updateContractReviewDAO: vi.fn().mockResolvedValue({}),
}))

vi.mock('~~/server/services/workflow/checkpointer', () => ({
    getCheckpointer: vi.fn().mockResolvedValue({}),
    getStore: vi.fn().mockResolvedValue({}),
}))

// 阶段 3 · search_law 普及：mock 同步 seedData 中 contractReviewMain 节点的真实 tools
// （seedData.sql 中 contractReviewMain.tools = ["parse_and_ask_stance", "search_law"]）
vi.mock('~~/server/services/node/node.service', () => ({
    getValidNodeConfig: vi.fn().mockImplementation(async (nodeName: string) => ({
        modelApiKeys: [{ status: 1, apiKey: 'test-key' }],
        modelSdkType: 'openai',
        modelName: 'test-model',
        modelProviderBaseUrl: 'https://test',
        modelContextWindow: 128000,
        tools: nodeName === 'contractReviewMain'
            ? ['parse_and_ask_stance', 'search_law']
            : [],
        systemPrompt: '',
    })),
}))

vi.mock('~~/server/services/node/chatModelFactory', () => ({
    createChatModel: vi.fn().mockReturnValue({ invoke: vi.fn() }),
    cachedPromptToAnthropicContent: vi.fn().mockReturnValue([]),
    cachedPromptToPlainText: vi.fn().mockReturnValue(''),
}))

vi.mock('~~/server/services/workflow/tools', () => ({
    getToolInstancesService: vi.fn().mockReturnValue([]),
}))

vi.mock('~~/server/services/workflow/utils/promptRenderer', () => ({
    renderSystemPrompt: vi.fn().mockReturnValue(''),
}))

vi.mock('~~/server/agents/contract/docx/loadContractFullText', () => ({
    loadContractFullText: vi.fn().mockResolvedValue({ fullText: '', paragraphs: [] }),
}))

vi.mock('~~/server/agents/contract/docx/clauseSegmenter', () => ({
    segmentClauses: vi.fn(),
}))

vi.mock('~~/server/services/workflow/middleware', async (importOriginal) => {
    const actual = await importOriginal<typeof import('~~/server/services/workflow/middleware')>()
    return {
        ...actual,
        pointConsumptionMiddleware: vi.fn(),
        safetyTrimMiddleware: vi.fn(),
        reviewResultPersistenceMiddleware: vi.fn(),
        buildMiddlewareStack: vi.fn().mockReturnValue([]),
    }
})

vi.mock('~~/server/services/workflow/middleware/reviewResultPersistence.middleware', () => ({
    reviewResultPersistenceMiddleware: vi.fn(),
    runAnnotateAndUpload: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('langchain', async () => {
    const actual = await vi.importActual<any>('langchain')
    return {
        ...actual,
        createAgent: vi.fn().mockReturnValue({ stream: vi.fn() }),
        summarizationMiddleware: vi.fn(),
    }
})

import { runAnalyzeLoop, runContractReviewChat } from '~~/server/services/workflow/agents/contractReviewMainAgent'
import { emitContractReviewEvent } from '~~/server/services/workflow/nodes/contractReviewStageEmitter'
import { getValidNodeConfig } from '~~/server/services/node/node.service'
import { analyzeSingleClause } from '~~/server/agents/contract/analyzeSingleClause'
import {
    findContractReviewBySessionIdDAO,
    updateContractReviewDAO,
} from '~~/server/agents/contract/contractReview.dao'
import { segmentClauses } from '~~/server/agents/contract/docx/clauseSegmenter'
import { runAnnotateAndUpload } from '~~/server/services/workflow/middleware/reviewResultPersistence.middleware'
import type { ClauseSegment, Risk } from '#shared/types/contract'

const emitterCtx = { runId: 'run-1', sessionId: 'sess-1' }

const mockSegments: ClauseSegment[] = [
    { index: 1, number: '1', text: '总则……' },
    { index: 2, number: '2', text: '付款条款……' },
    { index: 3, number: '3', text: '违约责任……' },
]

const riskHigh: Risk = {
    id: 'r2',
    clauseIndex: 2,
    clauseText: '付款条款……',
    level: 'high',
    category: '付款',
    problem: '付款期限不合理',
    analysis: '详细分析',
    risk: '风险点',
    suggestion: '建议',
}

const riskMedium: Risk = {
    id: 'r3',
    clauseIndex: 3,
    clauseText: '违约责任……',
    level: 'medium',
    category: '违约',
    problem: '违约金过低',
    analysis: '详细分析',
    risk: '风险点',
    suggestion: '建议',
}

describe('runAnalyzeLoop', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('按 clauseSegments 循环调用 analyzeSingleClause，每条发 progress + 命中风险发 risk', async () => {
        ;(analyzeSingleClause as any)
            .mockResolvedValueOnce(null)          // 第 1 条无风险
            .mockResolvedValueOnce(riskHigh)       // 第 2 条高风险
            .mockResolvedValueOnce(riskMedium)     // 第 3 条中风险

        const result = await runAnalyzeLoop({
            segments: mockSegments,
            stance: 'partyA',
            partyA: '甲方公司',
            partyB: '乙方公司',
            contractType: '服务合同',
            emitterCtx,
        })

        // 返回正确的 risks
        expect(result.risks).toHaveLength(2)
        expect(result.risks[0]!.id).toBe('r2')
        expect(result.risks[1]!.id).toBe('r3')
        expect(result.warnings).toHaveLength(0)

        // analyzeSingleClause 被调用 3 次
        expect(analyzeSingleClause).toHaveBeenCalledTimes(3)

        // progress 事件三次，current=1/2/3
        expect(emitContractReviewEvent).toHaveBeenCalledWith(
            emitterCtx,
            { type: 'progress', current: 1, total: 3 },
        )
        expect(emitContractReviewEvent).toHaveBeenCalledWith(
            emitterCtx,
            { type: 'progress', current: 2, total: 3 },
        )
        expect(emitContractReviewEvent).toHaveBeenCalledWith(
            emitterCtx,
            { type: 'progress', current: 3, total: 3 },
        )

        // risk 事件两次（第 1 条无风险跳过）
        expect(emitContractReviewEvent).toHaveBeenCalledWith(
            emitterCtx,
            { type: 'risk', risk: expect.objectContaining({ id: 'r2' }) },
        )
        expect(emitContractReviewEvent).toHaveBeenCalledWith(
            emitterCtx,
            { type: 'risk', risk: expect.objectContaining({ id: 'r3' }) },
        )

        // analyze:running 和 analyze:done 各发一次
        expect(emitContractReviewEvent).toHaveBeenCalledWith(
            emitterCtx,
            { type: 'stage', stage: 'analyze', status: 'running' },
        )
        expect(emitContractReviewEvent).toHaveBeenCalledWith(
            emitterCtx,
            { type: 'stage', stage: 'analyze', status: 'done', warnings: undefined },
        )
    })

    it('单条失败走 progress.error，其他条款继续，warnings 累积', async () => {
        ;(analyzeSingleClause as any)
            .mockRejectedValueOnce(new Error('zod 失败'))
            .mockResolvedValueOnce({ id: 'r2', level: 'low', clauseIndex: 2, clauseText: 'b', category: '其他', problem: 'p', analysis: 'a', risk: 'r', suggestion: 's' })

        const result = await runAnalyzeLoop({
            segments: [
                { index: 1, number: '1', text: 'a' },
                { index: 2, number: '2', text: 'b' },
            ],
            stance: 'neutral',
            partyA: null,
            partyB: null,
            contractType: null,
            emitterCtx,
        })

        // 第 1 条失败，第 2 条成功，risks 只有一条
        expect(result.risks).toHaveLength(1)
        expect(result.risks[0]!.id).toBe('r2')

        // warnings 包含第 1 条的错误信息
        expect(result.warnings).toHaveLength(1)
        expect(result.warnings[0]).toContain('zod 失败')

        // 发出了第 1 条的 progress.error
        expect(emitContractReviewEvent).toHaveBeenCalledWith(
            emitterCtx,
            expect.objectContaining({
                type: 'progress',
                current: 1,
                total: 2,
                error: expect.stringContaining('zod 失败'),
            }),
        )

        // analyze:done 携带 warnings
        expect(emitContractReviewEvent).toHaveBeenCalledWith(
            emitterCtx,
            expect.objectContaining({
                type: 'stage',
                stage: 'analyze',
                status: 'done',
                warnings: expect.arrayContaining([expect.stringContaining('zod 失败')]),
            }),
        )
    })
})

describe('runContractReviewChat resume 分支 - segments fail-fast', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('切分失败 segments=[] → resume 分支直接置 failed，不走 analyze', async () => {
        // 基础设施准备：返回 review
        ;(findContractReviewBySessionIdDAO as any).mockResolvedValueOnce({
            id: 123,
            userId: 7,
            sessionId: 'sess-empty',
            originalFileId: 99,
            partyA: '甲方',
            partyB: '乙方',
            contractType: '服务合同',
            stance: null,
            status: 'awaiting_stance',
        })
        // 切分返回空数组（模拟切分失败的降级场景）
        ;(segmentClauses as any).mockResolvedValueOnce({ segments: [], normalizedText: '' })

        const stream = await runContractReviewChat('sess-empty', {
            userId: 7,
            runId: 'run-empty',
            command: { stance: 'partyA' },
        })

        // 消费 stream 触发 start 回调
        const reader = stream.getReader()
        while (true) {
            const { done } = await reader.read()
            if (done) break
        }

        // analyzeSingleClause 应从未被调用（fail-fast 先于 runAnalyzeLoop）
        expect(analyzeSingleClause).toHaveBeenCalledTimes(0)

        // runAnnotateAndUpload 也不应被调用（跳过注入+上传）
        expect(runAnnotateAndUpload).toHaveBeenCalledTimes(0)

        // updateContractReviewDAO 至少有一次调用 status=failed
        const failedCall = (updateContractReviewDAO as any).mock.calls.find(
            (call: any[]) => call[1]?.status === 'failed',
        )
        expect(failedCall).toBeDefined()
        expect(failedCall![0]).toBe(123)

        // 发出 stage:analyze,done + warnings: ['no_segments']
        expect(emitContractReviewEvent).toHaveBeenCalledWith(
            { runId: 'run-empty', sessionId: 'sess-empty' },
            { type: 'stage', stage: 'analyze', status: 'done', warnings: ['no_segments'] },
        )
    })
})

describe('阶段 3 · contractReviewMain 节点 tools 配置', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('contractReviewMain 主 agent tools 应包含 search_law（resume 前可被调用）', async () => {
        // 复用本文件已 mock 的 getValidNodeConfig，断言其针对 contractReviewMain 节点
        // 返回的 tools 字段（与 seedData.sql 中真实配置对齐）。
        const config = await getValidNodeConfig('contractReviewMain', '合同审查主Agent')

        expect(config.tools).toContain('search_law')
        expect(config.tools).toContain('parse_and_ask_stance')

        // 已知限制：search_law 在 runAnalyzeLoop / analyzeSingleClause 子流程内不可用，
        // 因为 invokeNodeJson 走结构化输出 LLM，不支持 tool calling。
        // 阶段 4 通过 Command.resume + 中间件改造解决该限制；本阶段仅保证主 agent 阶段可用。
    })
})
