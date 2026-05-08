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

describe('startCaseAnalysisV2 - 材料就绪 gate', () => {
    it('首次启动（无 command）时先 await ensureMaterialsReadyService 再启动 stream', async () => {
        const { startCaseAnalysisV2 } = await import('~~/server/services/workflow/caseAnalysisV2.executor')

        await startCaseAnalysisV2({
            sessionId: 'sess-1',
            userId: 1,
            caseId: 100,
            selectedModules: ['summary'],
        })

        expect(mocks.ensureMaterialsReadyService).toHaveBeenCalledTimes(1)
        expect(mocks.ensureMaterialsReadyService).toHaveBeenCalledWith(100, 1)
        // gate 应在 stream 之前
        const ensureOrder = mocks.ensureMaterialsReadyService.mock.invocationCallOrder[0]!
        const streamOrder = mocks.streamFn.mock.invocationCallOrder[0]!
        expect(ensureOrder).toBeLessThan(streamOrder)
    })

    it('resume 路径（带 command）跳过 gate（材料早就 ready）', async () => {
        const { startCaseAnalysisV2 } = await import('~~/server/services/workflow/caseAnalysisV2.executor')

        await startCaseAnalysisV2({
            sessionId: 'sess-2',
            userId: 1,
            caseId: 100,
            selectedModules: ['summary'],
            command: { type: 'INSUFFICIENT_POINTS_RESUME' },
        })

        expect(mocks.ensureMaterialsReadyService).not.toHaveBeenCalled()
    })
})
