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

// S1：persistRisksAndCreateV1Snapshot 内部依赖，mock 掉避免 resume 分支测试触达真实 DB 写
vi.mock('~~/server/services/assistant/contract/contractRisk.service', async (importOriginal) => {
    const actual = await importOriginal<typeof import('~~/server/services/assistant/contract/contractRisk.service')>()
    return { ...actual, persistAiRisksAsContractRows: vi.fn().mockResolvedValue([]) }
})
vi.mock('~~/server/services/assistant/contract/contractReviewVersion.service', async (importOriginal) => {
    const actual = await importOriginal<typeof import('~~/server/services/assistant/contract/contractReviewVersion.service')>()
    return { ...actual, saveContractReviewVersionService: vi.fn().mockResolvedValue({ id: 1 }) }
})
// V1：mock 积分扣费服务，断言 resume 分支逐条分析阶段确实扣费
vi.mock('~~/server/services/point/pointConsumption.service', async (importOriginal) => {
    const actual = await importOriginal<typeof import('~~/server/services/point/pointConsumption.service')>()
    return { ...actual, consumePointsService: vi.fn().mockResolvedValue({ consumedAmount: 6 }) }
})

const mockStream = vi.hoisted(() => vi.fn(() => new ReadableStream<Uint8Array>({ start(c) { c.close() } })))

vi.mock('langchain', async () => {
    const actual = await vi.importActual<any>('langchain')
    return {
        ...actual,
        createAgent: vi.fn().mockReturnValue({ stream: mockStream }),
        summarizationMiddleware: vi.fn(),
    }
})

import { runAnalyzeLoop, runContractReviewChat } from '~~/server/services/workflow/agents/contractReviewMainAgent'
import { emitContractReviewEvent } from '~~/server/services/workflow/nodes/contractReviewStageEmitter'
import { getValidNodeConfig } from '~~/server/services/node/node.service'
import { analyzeSingleClause } from '~~/server/agents/contract/analyzeSingleClause'
import { summarizeOverview } from '~~/server/agents/contract/summarizeOverview'
import {
    findContractReviewBySessionIdDAO,
    updateContractReviewDAO,
} from '~~/server/agents/contract/contractReview.dao'
import { segmentClauses } from '~~/server/agents/contract/docx/clauseSegmenter'
import { runAnnotateAndUpload } from '~~/server/services/workflow/middleware/reviewResultPersistence.middleware'
import { consumePointsService } from '~~/server/services/point/pointConsumption.service'
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
            .mockResolvedValueOnce([])            // 第 1 条无风险
            .mockResolvedValueOnce([riskHigh])    // 第 2 条高风险
            .mockResolvedValueOnce([riskMedium])  // 第 3 条中风险

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
            .mockResolvedValueOnce([{ id: 'r2', level: 'low', clauseIndex: 2, clauseText: 'b', category: '其他', problem: 'p', analysis: 'a', risk: 'r', suggestion: 's' }])

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

describe('runContractReviewChat resume 分支 - V1 逐条分析阶段计费', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('逐条分析 + 总览的 token 用量按 contract_review_token 扣积分', async () => {
        ;(findContractReviewBySessionIdDAO as any).mockResolvedValueOnce({
            id: 777,
            userId: 7,
            sessionId: 'sess-billing',
            originalFileId: 99,
            partyA: '甲方',
            partyB: '乙方',
            contractType: '服务合同',
            stance: 'partyA',
            status: 'reviewing',
        })
        ;(segmentClauses as any).mockResolvedValueOnce({ segments: mockSegments, normalizedText: '全文' })
        // analyzeSingleClause：每条款返回 1 条风险并上报 2000 token
        ;(analyzeSingleClause as any).mockImplementation(async (ctx: any) => {
            ctx.onTokenUsage?.(2000)
            return [riskHigh]
        })

        const stream = await runContractReviewChat('sess-billing', {
            userId: 7,
            runId: 'run-billing',
            command: { stance: 'partyA' },
        })
        const reader = stream.getReader()
        while (true) {
            const { done } = await reader.read()
            if (done) break
        }

        // 3 条款 × 2000 token = 6000 token → ceil(6000 / 1000) = 6 个计费单位
        expect(consumePointsService).toHaveBeenCalledTimes(1)
        const call = (consumePointsService as any).mock.calls[0]
        expect(call[0]).toBe(7)                      // userId
        expect(call[1]).toBe('contract_review_token') // itemKey
        expect(call[2]).toBe(6)                       // quantity
    })
})

describe('阶段 5 · skipStanceInterrupt 路径（review_contract 子代理工具）', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('skipStanceInterrupt=true && review.stance 已落库 → 跳过 createAgent，走 resume 分支', async () => {
        // review 已含 stance（子代理工具内部已完成 stance interrupt + 落库）
        ;(findContractReviewBySessionIdDAO as any).mockResolvedValueOnce({
            id: 555,
            userId: 7,
            sessionId: 'sub-sess-555',
            originalFileId: 99,
            partyA: '甲方A',
            partyB: '乙方B',
            contractType: '采购合同',
            stance: 'partyA',
            status: 'reviewing',
        })
        // 切分返回空 → fail-fast 进 failed，无需 mock analyze loop
        ;(segmentClauses as any).mockResolvedValueOnce({ segments: [], normalizedText: '' })

        const stream = await runContractReviewChat('sub-sess-555', {
            userId: 7,
            runId: 'main-run',
            skipStanceInterrupt: true,
            // 注意：command 不传，验证仅靠 skipStanceInterrupt 也能进 resume 分支
        })

        const reader = stream.getReader()
        while (true) {
            const { done } = await reader.read()
            if (done) break
        }

        // resume 分支被命中：fail-fast 写 status='failed'
        const failedCall = (updateContractReviewDAO as any).mock.calls.find(
            (call: any[]) => call[1]?.status === 'failed',
        )
        expect(failedCall).toBeDefined()
        expect(failedCall![0]).toBe(555)
    })

    it('skipStanceInterrupt=false（默认）+ command 不存在 → 不进 resume，正常进 createAgent 路径', async () => {
        // 默认场景：review.stance 已有但 skipStanceInterrupt 未传，command 也未传
        // → 不应走 resume 分支（合同 vertical 自身页面首轮启动场景）
        ;(findContractReviewBySessionIdDAO as any).mockResolvedValueOnce({
            id: 666,
            userId: 7,
            sessionId: 'sess-666',
            originalFileId: 99,
            partyA: null,
            partyB: null,
            contractType: null,
            stance: null,
            status: 'pending',
        })
        ;(segmentClauses as any).mockResolvedValueOnce({ segments: mockSegments, normalizedText: 'text' })

        // 不传 command 也不传 skipStanceInterrupt → 默认走 agent.stream（createAgent 路径）
        // mock 的 agent.stream 是 vi.fn()（返回 undefined），不影响断言
        await runContractReviewChat('sess-666', { userId: 7 })

        // 关键断言：resume 分支专属的写动作未被触发（status='reviewing' 是 resume 分支
        // 写入的；createAgent 路径下不应有这条调用）
        const reviewingCall = (updateContractReviewDAO as any).mock.calls.find(
            (call: any[]) => call[1]?.status === 'reviewing',
        )
        expect(reviewingCall).toBeUndefined()
        expect(runAnnotateAndUpload).toHaveBeenCalledTimes(0)
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

import type { CallbackHandlerMethods } from '@langchain/core/callbacks/base'

describe('callbacks 选项透传', () => {
    beforeEach(() => {
        mockStream.mockClear()
        // 复用 segmentClauses / loadContractFullText 等 happy 默认 mock
        if (typeof segmentClauses !== 'undefined') {
            (segmentClauses as any).mockResolvedValue({ segments: [], normalizedText: '' })
        }
        // Mock findContractReviewBySessionIdDAO for happy path (no stance - fresh review)
        if (typeof findContractReviewBySessionIdDAO !== 'undefined') {
            (findContractReviewBySessionIdDAO as any).mockResolvedValue({
                id: 1, originalFileId: 9, status: 'pending',
                stance: null, partyA: null, partyB: null, contractType: null,
                caseId: null, sessionId: 'sess-z',
            })
        }
    })

    it('首轮（command=undefined + skipStanceInterrupt=false）+ 传 callbacks → agent.stream 收到', async () => {
        const userCallback: CallbackHandlerMethods = { handleLLMNewToken: vi.fn() }
        const { runContractReviewChat } = await import('~~/server/services/workflow/agents/contractReviewMainAgent')
        await runContractReviewChat('sess-z', {
            userId: 1,
            callbacks: [userCallback],
        })
        const streamArgs = mockStream.mock.calls.at(-1)?.[1] as any
        expect(streamArgs).toBeDefined()
        expect(streamArgs.callbacks).toBeDefined()
        expect(streamArgs.callbacks).toContain(userCallback)
    })

    it('首轮不传 callbacks → agent.stream callbacks 仅含 langfuseHandler（buildLangfuseTopLevelConfig 注入）', async () => {
        const { runContractReviewChat } = await import('~~/server/services/workflow/agents/contractReviewMainAgent')
        await runContractReviewChat('sess-z2', { userId: 1 })
        const streamArgs = mockStream.mock.calls.at(-1)?.[1] as any
        // langfuse 集成后由 buildLangfuseTopLevelConfig 在 stream 顶层注入 langfuseHandler；
        // 业务未传 callbacks 时这里应是 [langfuseHandler]
        expect(Array.isArray(streamArgs.callbacks)).toBe(true)
        expect(streamArgs.callbacks).toHaveLength(1)
    })

    it('skipStanceInterrupt=true（review.stance 已落库）→ 不走 agent.stream（callbacks 不触发，设计意图）', async () => {
        if (typeof findContractReviewBySessionIdDAO !== 'undefined') {
            // Mock review with stance already set - triggers skip branch
            (findContractReviewBySessionIdDAO as any).mockResolvedValue({
                id: 1, originalFileId: 9, status: 'awaiting_stance',
                stance: 'partyA', partyA: '甲', partyB: '乙', contractType: '采购',
                caseId: null, sessionId: 'sess-skip',
            })
        }
        const userCallback: CallbackHandlerMethods = { handleLLMNewToken: vi.fn() }
        const { runContractReviewChat } = await import('~~/server/services/workflow/agents/contractReviewMainAgent')
        await runContractReviewChat('sess-skip', {
            userId: 1,
            skipStanceInterrupt: true,
            callbacks: [userCallback],
        })
        // skip 分支返回手工构造的 ReadableStream，不调用 agent.stream
        expect(mockStream).not.toHaveBeenCalled()
    })
})

describe('runContractReviewChat resume 分支 - 全/部分条款分析失败（S1）', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    /** resume 分支测试公共准备：review + 切分成功的 3 条 segments */
    function setupResumeReview(id: number, sessionId: string) {
        ;(findContractReviewBySessionIdDAO as any).mockResolvedValueOnce({
            id, userId: 7, sessionId,
            originalFileId: 99,
            partyA: '甲方', partyB: '乙方',
            contractType: null, stance: null,
            status: 'reviewing', currentVersionId: null,
        })
        ;(segmentClauses as any).mockResolvedValueOnce({ segments: mockSegments, normalizedText: '正文' })
    }

    async function drain(stream: ReadableStream<Uint8Array>) {
        const reader = stream.getReader()
        while (true) {
            const { done } = await reader.read()
            if (done) break
        }
    }

    it('全部条款分析失败 → 置 failed，不走 summarize / annotate（不误判完成无风险）', async () => {
        setupResumeReview(777, 'sess-allfail')
        // 3 条 analyzeSingleClause 全部抛错
        ;(analyzeSingleClause as any).mockRejectedValue(new Error('LLM 全线故障'))

        const stream = await runContractReviewChat('sess-allfail', {
            userId: 7, runId: 'run-allfail', command: { stance: 'partyA' },
        })
        await drain(stream)

        // 确实尝试分析过全部 3 条
        expect(analyzeSingleClause).toHaveBeenCalledTimes(3)
        // 全失败 → 不得进入 summarize / 注入上传，否则会误判"审查完成·无风险"
        expect(summarizeOverview).not.toHaveBeenCalled()
        expect(runAnnotateAndUpload).not.toHaveBeenCalled()
        // 置 failed
        const failedCall = (updateContractReviewDAO as any).mock.calls.find(
            (call: any[]) => call[1]?.status === 'failed',
        )
        expect(failedCall).toBeDefined()
        expect(failedCall![0]).toBe(777)
    })

    it('部分条款分析失败 → 审查继续，总评里标注失败条款数', async () => {
        setupResumeReview(778, 'sess-partfail')
        // 第 1 条失败，第 2、3 条成功
        ;(analyzeSingleClause as any)
            .mockRejectedValueOnce(new Error('单条 LLM 故障'))
            .mockResolvedValueOnce([riskHigh])
            .mockResolvedValueOnce([riskMedium])
        ;(summarizeOverview as any).mockResolvedValueOnce({
            highlights: { high: [], medium: [], low: [] },
            overall: '本合同总体风险可控',
        })

        const stream = await runContractReviewChat('sess-partfail', {
            userId: 7, runId: 'run-partfail', command: { stance: 'partyA' },
        })
        await drain(stream)

        // 部分失败：审查继续，summarize 被调用
        expect(summarizeOverview).toHaveBeenCalledTimes(1)
        // 总评里应标注失败条款数，避免律师误以为已完整覆盖全部条款
        const summaryCall = (updateContractReviewDAO as any).mock.calls.find(
            (call: any[]) => call[1]?.summary,
        )
        expect(summaryCall).toBeDefined()
        expect((summaryCall![1].summary as { overall: string }).overall).toContain('1 条条款')
    })
})
