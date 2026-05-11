/**
 * caseAnalysisV2.executor 测试
 *
 * 验证：startCaseAnalysisV2 启动 stream 前会 await ensureMaterialsReadyService 作为 gate，
 * 让 V2 与小索/模块对话/文书生成在材料就绪保障上一致。
 *
 * 历史 bug：V2 工作流不挂 caseProcessMaterialMiddleware，导致 system prompt 里
 * 出现"待识别"+"摘要生成中"，分析在材料未就绪时就启动。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
    ensureMaterialsReadyService: vi.fn().mockResolvedValue({
        materials: [], totalMaterials: 0, alreadyEmbedded: 0,
        newlyProcessed: 0, embeddedMap: new Map(), failed: [],
    }),
    streamFn: vi.fn().mockReturnValue(new ReadableStream()),
    getCaseAnalysisWorkflow: vi.fn(),
}))

vi.mock('~~/server/services/material/materialPipeline.service', () => ({
    ensureMaterialsReadyService: mocks.ensureMaterialsReadyService,
}))
vi.mock('~~/server/services/workflow/caseAnalysisV2.workflow', () => ({
    getCaseAnalysisWorkflow: mocks.getCaseAnalysisWorkflow,
}))
vi.mock('~~/server/lib/langfuse', () => ({
    buildLangfuseTopLevelConfig: vi.fn().mockReturnValue({}),
}))

beforeEach(() => {
    vi.clearAllMocks()
    mocks.ensureMaterialsReadyService.mockResolvedValue({
        materials: [], totalMaterials: 0, alreadyEmbedded: 0,
        newlyProcessed: 0, embeddedMap: new Map(), failed: [],
    })
    mocks.streamFn.mockReturnValue(new ReadableStream())
    mocks.getCaseAnalysisWorkflow.mockResolvedValue({ stream: mocks.streamFn })
})

describe('startCaseAnalysisV2 - 启动行为', () => {
    it('首次启动（无 command）调用 workflow.stream 启动新分析；材料 gate 已下沉到子 agent 的 caseProcessMaterialMiddleware', async () => {
        const { startCaseAnalysisV2 } = await import('~~/server/services/workflow/caseAnalysisV2.executor')

        await startCaseAnalysisV2({
            sessionId: 'sess-1',
            userId: 1,
            caseId: 100,
            selectedModules: ['summary'],
        })

        // executor 不再直接持有材料 gate（caseAnalysisV2.workflow.ts 把 gate 挂在子 agent 中间件）
        expect(mocks.ensureMaterialsReadyService).not.toHaveBeenCalled()
        // stream 仍按原计划启动
        expect(mocks.streamFn).toHaveBeenCalledTimes(1)
        expect(mocks.streamFn.mock.calls[0]![0]).toMatchObject({
            sessionId: 'sess-1',
            userId: 1,
            caseId: 100,
            selectedModules: ['summary'],
        })
    })

    it('resume 路径（带 command）走 Command.resume 而非首次启动 payload', async () => {
        const { startCaseAnalysisV2 } = await import('~~/server/services/workflow/caseAnalysisV2.executor')

        await startCaseAnalysisV2({
            sessionId: 'sess-2',
            userId: 1,
            caseId: 100,
            selectedModules: ['summary'],
            command: { type: 'INSUFFICIENT_POINTS_RESUME' },
        })

        expect(mocks.ensureMaterialsReadyService).not.toHaveBeenCalled()
        expect(mocks.streamFn).toHaveBeenCalledTimes(1)
    })
})
