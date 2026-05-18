/**
 * server/api/v1/cases/** handler 单元覆盖（33 文件）
 *
 * 策略：覆盖鉴权 / 参数校验 / 主要分支。SSE 等运行时复杂逻辑接受较低覆盖。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../_helpers/handler-test'
import { makeEvent, expectSuccess, expectError } from '../_helpers/handler-test'

vi.mock('~~/server/services/case/case.service', () => ({
    getUserCasesService: vi.fn(),
    getCaseStatusSummaryService: vi.fn(),
    getActiveCasesService: vi.fn(),
    createCaseService: vi.fn(),
    getCaseByIdService: vi.fn(),
    validateCaseAccessService: vi.fn(),
    updateCaseService: vi.fn(),
    deleteCaseService: vi.fn(),
    getSessionByIdService: vi.fn(),
    getCaseBySessionIdService: vi.fn(),
}))
vi.mock('~~/server/services/case/caseSession.service', () => ({
    findCaseBySessionIdService: vi.fn(),
}))
vi.mock('~~/server/services/case/analysis.service', () => ({
    getSessionAnalysesService: vi.fn(),
    getCaseAnalysisHistoryService: vi.fn(),
    switchActiveVersionService: vi.fn(),
}))
vi.mock('~~/server/services/case/caseExtraction.service', () => ({
    saveCaseInfoService: vi.fn(),
}))
vi.mock('~~/server/services/case/caseType.service', () => ({
    getEnabledCaseTypesService: vi.fn(),
    getFirstEnabledCaseTypeService: vi.fn(),
}))
vi.mock('~~/server/services/case/initAnalysis.service', () => ({
    getInitAnalysisStatusService: vi.fn(),
    validateAndSortModules: vi.fn(),
}))
vi.mock('~~/server/services/case/session.dao', () => ({
    createSessionDAO: vi.fn(),
    softDeleteSessionDAO: vi.fn(),
    listSessionsWithActiveRunDAO: vi.fn(),
    renameSessionDAO: vi.fn(),
}))
vi.mock('~~/server/services/case/analysis.dao', () => ({
    AnalysisStatus: { COMPLETED: 'completed' },
    findAnalysisByIdDao: vi.fn(),
}))
vi.mock('~~/server/services/agent/agentRun.service', () => ({
    enqueueRunService: vi.fn(),
    getActiveRunService: vi.fn(),
    getLatestRunService: vi.fn(),
    cancelRunService: vi.fn(),
    getRunListService: vi.fn(),
}))
vi.mock('~~/server/services/agent/agentRun.dao', () => ({
    updateRunStatusDAO: vi.fn(),
}))
vi.mock('~~/server/services/agent/agentEventBridge', () => ({
    replayEvents: vi.fn(),
    createEventSubscription: vi.fn(),
}))
vi.mock('~~/server/services/sse/agentSseStream', () => ({
    createAgentSseStream: vi.fn(() => new ReadableStream()),
}))
vi.mock('~~/server/services/memory/consolidator.service', () => ({
    scheduleConsolidation: vi.fn(async () => undefined),
}))
vi.mock('~~/server/services/memory/memory.dao', () => ({
    softDeleteMemoryDAO: vi.fn(),
    listMemoriesDAO: vi.fn(),
    findActiveMemoryBySubjectDAO: vi.fn(),
}))
vi.mock('~~/server/services/memory/memory.service', () => ({
    writeMemoryService: vi.fn(),
}))
vi.mock('~~/server/services/memory/memorySubjectInfer.service', () => ({
    inferSubjectKeyService: vi.fn(),
}))
vi.mock('~~/server/services/material/material.service', () => ({
    createMaterialService: vi.fn(),
    getMaterialsByCaseIdWithStatusService: vi.fn(),
    // 2026-05-06：source 把材料摘要查询从 caseMaterials.summary 字段拆到识别记录表，
    // 引入了 getMaterialSummariesByMaterials；mock 必须同步导出
    getMaterialSummariesByMaterials: vi.fn(async () => new Map<number, string>()),
}))
vi.mock('~~/server/services/material/material.dao', () => ({
    deleteMaterialsDao: vi.fn(),
}))
vi.mock('~~/server/services/material/materialEmbedding.service', () => ({
    deleteMaterialsEmbeddings: vi.fn(),
}))
vi.mock('~~/server/services/material/materialProcess.service', () => ({
    processMaterialService: vi.fn(),
}))
vi.mock('~~/server/services/material/fileProcess.service', () => ({
    processFileMaterials: vi.fn(async () => []),
}))
vi.mock('~~/server/services/case/caseMaterial.service', () => ({
    batchAddCaseMaterialsService: vi.fn(),
}))
vi.mock('~~/server/services/workflow/agents', () => ({
    getThreadValuesService: vi.fn(),
    loadSubAgentThreads: vi.fn(),
}))
vi.mock('~~/server/services/node/node.service', () => ({
    getNodeByNameService: vi.fn(),
    getValidNodeConfig: vi.fn(),
}))
vi.mock('~~/server/services/node/chatModelFactory', () => ({
    createChatModel: vi.fn(),
}))
vi.mock('~~/server/services/ai/summaryService', () => ({
    generateSummaryService: vi.fn(),
}))
vi.mock('~~/server/utils/tokenCounter', () => ({
    countTokens: vi.fn(async () => 100),
}))
vi.mock('~~/server/lib/langfuse', () => ({
    buildLangfuseTopLevelConfig: vi.fn(() => ({})),
    withLangfuseContext: vi.fn(async (_ctx: any, fn: any) => fn()),
}))
vi.mock('~~/server/utils/chat-branch-utils', () => ({
    shouldRejectMessage: vi.fn(() => false),
    isValidResumeCommand: vi.fn(() => true),
    shouldRejectResume: vi.fn(() => false),
    getResumeCount: vi.fn(() => 0),
    extractChatParams: vi.fn((b: any) => ({
        sessionId: b?.config?.configurable?.thread_id ?? b?.sessionId,
        message: b?.input?.message,
        command: b?.command,
        thinking: b?.input?.thinking,
    })),
    MAX_RESUME_COUNT: 5,
}))

;(globalThis as any).prisma = {
    cases: { findFirst: vi.fn(), findUnique: vi.fn() },
    caseSessions: { findFirst: vi.fn(), update: vi.fn() },
    caseTypes: { findMany: vi.fn(async () => []) },
    caseMaterials: { findMany: vi.fn() },
    caseAnalyses: { findMany: vi.fn(async () => []) },
    agentRuns: { findUnique: vi.fn(), update: vi.fn() },
    $queryRawUnsafe: vi.fn(async () => []),
}

import { getUserCasesService, getCaseStatusSummaryService, getActiveCasesService, createCaseService, getCaseByIdService, validateCaseAccessService, updateCaseService, deleteCaseService, getSessionByIdService, getCaseBySessionIdService } from '~~/server/services/case/case.service'
import { findCaseBySessionIdService } from '~~/server/services/case/caseSession.service'
import { getSessionAnalysesService, getCaseAnalysisHistoryService, switchActiveVersionService } from '~~/server/services/case/analysis.service'
import { getFirstEnabledCaseTypeService } from '~~/server/services/case/caseType.service'
import { getInitAnalysisStatusService } from '~~/server/services/case/initAnalysis.service'
import { createSessionDAO, softDeleteSessionDAO, listSessionsWithActiveRunDAO, renameSessionDAO } from '~~/server/services/case/session.dao'
import { findAnalysisByIdDao } from '~~/server/services/case/analysis.dao'
import { enqueueRunService, getActiveRunService, getLatestRunService, cancelRunService, getRunListService } from '~~/server/services/agent/agentRun.service'
import { writeMemoryService } from '~~/server/services/memory/memory.service'
import { inferSubjectKeyService } from '~~/server/services/memory/memorySubjectInfer.service'
import { listMemoriesDAO, softDeleteMemoryDAO, findActiveMemoryBySubjectDAO } from '~~/server/services/memory/memory.dao'
import { getMaterialsByCaseIdWithStatusService } from '~~/server/services/material/material.service'
import { batchAddCaseMaterialsService } from '~~/server/services/case/caseMaterial.service'
import { deleteMaterialsDao } from '~~/server/services/material/material.dao'
import { getThreadValuesService, loadSubAgentThreads } from '~~/server/services/workflow/agents'
import { getNodeByNameService, getValidNodeConfig } from '~~/server/services/node/node.service'

const mGetCases = vi.mocked(getUserCasesService)
const mGetCaseStatusSummary = vi.mocked(getCaseStatusSummaryService)
const mActiveCases = vi.mocked(getActiveCasesService)
const mCreateCase = vi.mocked(createCaseService)
const mGetCaseById = vi.mocked(getCaseByIdService)
const mValidateAccess = vi.mocked(validateCaseAccessService)
const mUpdateCase = vi.mocked(updateCaseService)
const mDeleteCase = vi.mocked(deleteCaseService)
const mGetSessionById = vi.mocked(getSessionByIdService)
const mGetCaseBySession = vi.mocked(getCaseBySessionIdService)
const mFindCaseBySession = vi.mocked(findCaseBySessionIdService)
const mGetAnalyses = vi.mocked(getSessionAnalysesService)
const mGetHistory = vi.mocked(getCaseAnalysisHistoryService)
const mSwitchVersion = vi.mocked(switchActiveVersionService)
const mFirstCaseType = vi.mocked(getFirstEnabledCaseTypeService)
const mInitStatus = vi.mocked(getInitAnalysisStatusService)
const mCreateSession = vi.mocked(createSessionDAO)
const mSoftDeleteSession = vi.mocked(softDeleteSessionDAO)
const mListSessions = vi.mocked(listSessionsWithActiveRunDAO)
const mRenameSession = vi.mocked(renameSessionDAO)
const mFindAnalysis = vi.mocked(findAnalysisByIdDao)
const mEnqueueRun = vi.mocked(enqueueRunService)
const mActiveRun = vi.mocked(getActiveRunService)
const mLatestRun = vi.mocked(getLatestRunService)
const mCancelRun = vi.mocked(cancelRunService)
const mGetRunList = vi.mocked(getRunListService)
const mWriteMemory = vi.mocked(writeMemoryService)
const mInferSubject = vi.mocked(inferSubjectKeyService)
const mListMemories = vi.mocked(listMemoriesDAO)
const mSoftDeleteMemory = vi.mocked(softDeleteMemoryDAO)
const mFindMemBySubj = vi.mocked(findActiveMemoryBySubjectDAO)
const mGetMaterials = vi.mocked(getMaterialsByCaseIdWithStatusService)
const mBatchAddMaterials = vi.mocked(batchAddCaseMaterialsService)
const mDeleteMaterials = vi.mocked(deleteMaterialsDao)
const mGetThreadValues = vi.mocked(getThreadValuesService)
const mLoadSubAgents = vi.mocked(loadSubAgentThreads)
const mGetNodeByName = vi.mocked(getNodeByNameService)
const mGetNodeConfig = vi.mocked(getValidNodeConfig)

const { default: listHandler } = await import('../../../server/api/v1/cases/index.get')
const { default: activeHandler } = await import('../../../server/api/v1/cases/active.get')
const { default: createHandler } = await import('../../../server/api/v1/cases/create.post')
const { default: getHandler } = await import('../../../server/api/v1/cases/[caseId].get')
const { default: patchHandler } = await import('../../../server/api/v1/cases/[caseId].patch')
const { default: putHandler } = await import('../../../server/api/v1/cases/[caseId].put')
const { default: deleteHandler } = await import('../../../server/api/v1/cases/[caseId].delete')
const { default: historyHandler } = await import('../../../server/api/v1/cases/history/[caseId].get')
const { default: sessionHandler } = await import('../../../server/api/v1/cases/session/[sessionId].get')
const { default: extractHandler } = await import('../../../server/api/v1/cases/extract.post')
const { default: initStatusHandler } = await import('../../../server/api/v1/cases/init-analysis-status/[caseId].get')
const { default: chatHandler } = await import('../../../server/api/v1/cases/analysis/chat.post')
const { default: initSessionHandler } = await import('../../../server/api/v1/cases/analysis/init-session.post')
const { default: moduleSessionHandler } = await import('../../../server/api/v1/cases/analysis/module-session.post')
const { default: deleteModuleSessionHandler } = await import('../../../server/api/v1/cases/analysis/module-session/[sessionId].delete')
const { default: moduleSessionsHandler } = await import('../../../server/api/v1/cases/analysis/module-sessions.get')
const { default: runsHandler } = await import('../../../server/api/v1/cases/analysis/runs/[sessionId].get')
const { default: cancelRunHandler } = await import('../../../server/api/v1/cases/analysis/runs/cancel/[runId].post')
const { default: currentRunHandler } = await import('../../../server/api/v1/cases/analysis/runs/current/[sessionId].get')
const { default: renameHandler } = await import('../../../server/api/v1/cases/analysis/session/rename/[sessionId].patch')
const { default: threadHandler } = await import('../../../server/api/v1/cases/analysis/thread/[sessionId].get')
const { default: versionsHandler } = await import('../../../server/api/v1/cases/analysis/versions/[caseId].get')
const { default: activateHandler } = await import('../../../server/api/v1/cases/analysis/versions/activate/[analysisId].post')
const { default: xiaosuoCreateHandler } = await import('../../../server/api/v1/cases/analysis/xiaosuo-session.post')
const { default: xiaosuoDeleteHandler } = await import('../../../server/api/v1/cases/analysis/xiaosuo-session/[sessionId].delete')
const { default: xiaosuoListHandler } = await import('../../../server/api/v1/cases/analysis/xiaosuo-sessions.get')
const { default: materialsListHandler } = await import('../../../server/api/v1/cases/materials/[caseId].get')
const { default: materialsAddHandler } = await import('../../../server/api/v1/cases/materials/[caseId].post')
const { default: materialsDeleteHandler } = await import('../../../server/api/v1/cases/materials/delete/[caseId].delete')
const { default: memDeleteHandler } = await import('../../../server/api/v1/cases/memories/[memoryId].delete')
const { default: memListHandler } = await import('../../../server/api/v1/cases/memories/by-case/[caseId].get')
const { default: memCreateHandler } = await import('../../../server/api/v1/cases/memories/by-case/[caseId].post')

describe('GET /api/v1/cases', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mGetCaseStatusSummary.mockResolvedValue({ total: 0, inProgress: 0, closed: 0 } as any)
    })
    it('happy', async () => {
        mGetCases.mockResolvedValue({ list: [{ id: 1, title: 'A', content: 'C', caseTypeId: 1, status: 1, isDemo: false, createdAt: new Date(), updatedAt: new Date(), caseType: { id: 1, name: 'X' }, caseSessions: [{ sessionId: 'S', status: 1, createdAt: new Date() }] }], total: 1 } as any)
        const res: any = await listHandler(makeEvent({ userId: 100, query: {} }) as any)
        expectSuccess(res)
    })
    it('未登录 → 401', async () => { expectError(await listHandler(makeEvent({ query: {} }) as any), 401) })
    it('参数非法 → 400', async () => { expectError(await listHandler(makeEvent({ userId: 100, query: { status: 'abc' } }) as any), 400) })
    it('service 抛错 → 500', async () => { mGetCases.mockRejectedValue(new Error('db')); expectError(await listHandler(makeEvent({ userId: 100, query: {} }) as any), 500) })
})

describe('GET /api/v1/cases/active', () => {
    beforeEach(() => vi.clearAllMocks())
    it('happy', async () => { mActiveCases.mockResolvedValue([{ id: 1, title: 'A' }] as any); expectSuccess(await activeHandler(makeEvent({ userId: 100, query: {} }) as any)) })
    it('未登录 → 401', async () => { expectError(await activeHandler(makeEvent({ query: {} }) as any), 401) })
    it('参数非法 → 400', async () => { expectError(await activeHandler(makeEvent({ userId: 100, query: { limit: '999' } }) as any), 400) })
})

describe('POST /api/v1/cases/create', () => {
    beforeEach(() => vi.clearAllMocks())
    it('happy', async () => {
        mCreateCase.mockResolvedValue({
            caseId: 1, sessionId: 'S',
            case: { id: 1, title: 'A', content: 'C', caseTypeId: 1, status: 1, createdAt: new Date() },
            session: { id: 1, sessionId: 'S', status: 1, createdAt: new Date() },
        } as any)
        const res: any = await createHandler(makeEvent({
            userId: 100, body: { title: 'A', content: '案情', caseTypeId: 1 },
        }) as any)
        expectSuccess(res)
    })
    it('未登录 → 401', async () => { expectError(await createHandler(makeEvent({ body: {} }) as any), 401) })
    it('参数非法（content 与 materials 都缺）→ 400', async () => { expectError(await createHandler(makeEvent({ userId: 100, body: { caseTypeId: 1 } }) as any), 400) })
    it('service 抛错 → 500', async () => {
        mCreateCase.mockRejectedValue(new Error('db'))
        const res: any = await createHandler(makeEvent({ userId: 100, body: { content: 'X', caseTypeId: 1 } }) as any)
        expectError(res, 500)
    })
})

describe('GET /api/v1/cases/:caseId', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mValidateAccess.mockResolvedValue(undefined as any)
    })
    it('happy', async () => {
        mGetCaseById.mockResolvedValue({
            id: 1, title: 'A', content: 'C', caseTypeId: 1,
            plaintiff: [], defendant: [], status: 1, isDemo: false,
            createdAt: new Date(), updatedAt: new Date(),
            caseType: { id: 1, name: 'X', description: '' },
            caseSessions: [{ id: 1, sessionId: 'S', status: 1, createdAt: new Date() }],
        } as any)
        mGetAnalyses.mockResolvedValue([] as any)
        const res: any = await getHandler(makeEvent({ userId: 100, params: { caseId: '1' } }) as any)
        expectSuccess(res)
    })
    it('未登录 → 401', async () => { expectError(await getHandler(makeEvent({ params: { caseId: '1' } }) as any), 401) })
    it('id 非法 → 400', async () => { expectError(await getHandler(makeEvent({ userId: 100, params: { caseId: 'x' } }) as any), 400) })
    it('案件不存在 → 404', async () => { mGetCaseById.mockResolvedValue(null as any); expectError(await getHandler(makeEvent({ userId: 100, params: { caseId: '1' } }) as any), 404) })
    it('无权访问 → 403', async () => {
        mValidateAccess.mockRejectedValue(new Error('无权访问该案件'))
        expectError(await getHandler(makeEvent({ userId: 100, params: { caseId: '1' } }) as any), 403)
    })
})

describe('PATCH /api/v1/cases/:caseId', () => {
    beforeEach(() => { vi.clearAllMocks(); mValidateAccess.mockResolvedValue(undefined as any) })
    it('happy', async () => { expectSuccess(await patchHandler(makeEvent({ userId: 100, params: { caseId: '1' }, body: { status: 1 } }) as any)) })
    it('未登录 → 401', async () => { expectError(await patchHandler(makeEvent({ params: { caseId: '1' }, body: { status: 1 } }) as any), 401) })
    it('id 非法 → 400', async () => { expectError(await patchHandler(makeEvent({ userId: 100, params: { caseId: 'x' }, body: { status: 1 } }) as any), 400) })
    it('参数非法 → 400', async () => { expectError(await patchHandler(makeEvent({ userId: 100, params: { caseId: '1' }, body: {} }) as any), 400) })
    it('案件归档 → 403', async () => {
        mUpdateCase.mockRejectedValue(new Error('案件已归档，不可编辑'))
        expectError(await patchHandler(makeEvent({ userId: 100, params: { caseId: '1' }, body: { status: 1 } }) as any), 403)
    })
})

describe('PUT /api/v1/cases/:caseId', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mValidateAccess.mockResolvedValue(undefined as any)
        mUpdateCase.mockResolvedValue({ id: 1 } as any)
        mGetCaseById.mockResolvedValue({
            id: 1, title: 'A', plaintiff: [], defendant: [],
            extractedInfo: null, summary: '', caseType: { name: 'X' },
        } as any)
    })
    it('happy', async () => { expectSuccess(await putHandler(makeEvent({ userId: 100, params: { caseId: '1' }, body: { title: '新' } }) as any)) })
    it('未登录 → 401', async () => { expectError(await putHandler(makeEvent({ params: { caseId: '1' }, body: { title: '新' } }) as any), 401) })
    it('id 非法 → 400', async () => { expectError(await putHandler(makeEvent({ userId: 100, params: { caseId: 'x' }, body: { title: '新' } }) as any), 400) })
    it('参数非法（无字段）→ 400', async () => { expectError(await putHandler(makeEvent({ userId: 100, params: { caseId: '1' }, body: {} }) as any), 400) })
    it('案件不存在 → 404', async () => {
        mValidateAccess.mockRejectedValue(new Error('案件不存在'))
        expectError(await putHandler(makeEvent({ userId: 100, params: { caseId: '1' }, body: { title: '新' } }) as any), 404)
    })
    it('无权访问 → 403', async () => {
        mValidateAccess.mockRejectedValue(new Error('无权访问该案件'))
        expectError(await putHandler(makeEvent({ userId: 100, params: { caseId: '1' }, body: { title: '新' } }) as any), 403)
    })
})

describe('DELETE /api/v1/cases/:caseId', () => {
    beforeEach(() => { vi.clearAllMocks(); mValidateAccess.mockResolvedValue(undefined as any) })
    it('happy', async () => { mDeleteCase.mockResolvedValue(undefined as any); expectSuccess(await deleteHandler(makeEvent({ userId: 100, params: { caseId: '1' } }) as any)) })
    it('未登录 → 401', async () => { expectError(await deleteHandler(makeEvent({ params: { caseId: '1' } }) as any), 401) })
    it('id 非法 → 400', async () => { expectError(await deleteHandler(makeEvent({ userId: 100, params: { caseId: 'x' } }) as any), 400) })
    it('案件不存在 → 404', async () => { mValidateAccess.mockRejectedValue(new Error('案件不存在')); expectError(await deleteHandler(makeEvent({ userId: 100, params: { caseId: '1' } }) as any), 404) })
})

describe('GET /api/v1/cases/history/:caseId', () => {
    beforeEach(() => { vi.clearAllMocks(); mValidateAccess.mockResolvedValue(undefined as any) })
    it('happy', async () => {
        mGetCaseById.mockResolvedValue({ id: 1, title: 'A' } as any)
        mGetHistory.mockResolvedValue([] as any)
        expectSuccess(await historyHandler(makeEvent({ userId: 100, params: { caseId: '1' } }) as any))
    })
    it('未登录 → 401', async () => { expectError(await historyHandler(makeEvent({ params: { caseId: '1' } }) as any), 401) })
    it('id 非法 → 400', async () => { expectError(await historyHandler(makeEvent({ userId: 100, params: { caseId: 'x' } }) as any), 400) })
    it('案件不存在 → 404', async () => { mGetCaseById.mockResolvedValue(null as any); expectError(await historyHandler(makeEvent({ userId: 100, params: { caseId: '1' } }) as any), 404) })
})

describe('GET /api/v1/cases/session/:sessionId', () => {
    beforeEach(() => { vi.clearAllMocks(); mValidateAccess.mockResolvedValue(undefined as any) })
    it('happy', async () => {
        mGetSessionById.mockResolvedValue({ id: 1, sessionId: 'S', status: 1, createdAt: new Date(), updatedAt: new Date() } as any)
        mGetCaseBySession.mockResolvedValue({ id: 1, title: 'A', caseType: { name: 'X' } } as any)
        expectSuccess(await sessionHandler(makeEvent({ userId: 100, params: { sessionId: 'S' } }) as any))
    })
    it('未登录 → 401', async () => { expectError(await sessionHandler(makeEvent({ params: { sessionId: 'S' } }) as any), 401) })
    it('session 不存在 → 404', async () => { mGetSessionById.mockResolvedValue(null as any); expectError(await sessionHandler(makeEvent({ userId: 100, params: { sessionId: 'S' } }) as any), 404) })
    it('案件不存在 → 404', async () => {
        mGetSessionById.mockResolvedValue({ sessionId: 'S' } as any)
        mGetCaseBySession.mockResolvedValue(null as any)
        expectError(await sessionHandler(makeEvent({ userId: 100, params: { sessionId: 'S' } }) as any), 404)
    })
    it('无权访问 → 403', async () => {
        mGetSessionById.mockResolvedValue({ sessionId: 'S' } as any)
        mGetCaseBySession.mockResolvedValue({ id: 1 } as any)
        mValidateAccess.mockRejectedValue(new Error('无权访问该案件'))
        expectError(await sessionHandler(makeEvent({ userId: 100, params: { sessionId: 'S' } }) as any), 403)
    })
})

describe('POST /api/v1/cases/extract', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mGetNodeConfig.mockResolvedValue({
            modelApiKeys: [{ apiKey: 'k', status: 1 }],
            modelSdkType: 'openai', modelName: 'gpt', modelProviderBaseUrl: 'u',
            modelContextWindow: 100000, prompts: [], outputSchema: null,
        } as any)
    })
    it('未登录 → 401', async () => { expectError(await extractHandler(makeEvent({ body: { message: 'x' } }) as any), 401) })
    it('Zod 失败 → 400', async () => { expectError(await extractHandler(makeEvent({ userId: 100, body: { message: '' } }) as any), 400) })
    it('节点未配置 → 500', async () => {
        mGetNodeConfig.mockRejectedValue(new Error('extract 节点未配置'))
        expectError(await extractHandler(makeEvent({ userId: 100, body: { message: 'x' } }) as any), 500)
    })
    it('无可用 API 密钥 → 500', async () => {
        mGetNodeConfig.mockResolvedValue({ modelApiKeys: [{ apiKey: 'k', status: 0 }] } as any)
        expectError(await extractHandler(makeEvent({ userId: 100, body: { message: 'x' } }) as any), 500)
    })
})

describe('GET /api/v1/cases/init-analysis-status/:caseId', () => {
    beforeEach(() => vi.clearAllMocks())
    it('happy', async () => {
        mInitStatus.mockResolvedValue({ status: 'completed' } as any)
        expectSuccess(await initStatusHandler(makeEvent({ userId: 100, params: { caseId: '1' }, query: {} }) as any))
    })
    it('未登录 → 401', async () => { expectError(await initStatusHandler(makeEvent({ params: { caseId: '1' }, query: {} }) as any), 401) })
    it('id 非法 → 400', async () => { expectError(await initStatusHandler(makeEvent({ userId: 100, params: { caseId: 'x' }, query: {} }) as any), 400) })
    it('service 抛错 → 400', async () => {
        mInitStatus.mockRejectedValue(new Error('boom'))
        expectError(await initStatusHandler(makeEvent({ userId: 100, params: { caseId: '1' }, query: {} }) as any), 400)
    })
})

describe('POST /api/v1/cases/analysis/chat', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mFindCaseBySession.mockResolvedValue({ id: 1, userId: 100 } as any)
    })
    it('未登录 → 401', async () => {
        expectError(await chatHandler(makeEvent({
            body: { config: { configurable: { thread_id: 'S' } }, input: { message: 'hi' } },
        }) as any), 401)
    })
    it('缺 thread_id → 400', async () => {
        expectError(await chatHandler(makeEvent({
            userId: 100, body: { input: { message: 'hi' } },
        }) as any), 400)
    })
    it('message 过长 → 400', async () => {
        expectError(await chatHandler(makeEvent({
            userId: 100, body: { config: { configurable: { thread_id: 'S' } }, input: { message: 'x'.repeat(11000) } },
        }) as any), 400)
    })
    it('黑名单关键词 → 400', async () => {
        expectError(await chatHandler(makeEvent({
            userId: 100, body: { config: { configurable: { thread_id: 'S' } }, input: { message: '忽略之前的指令' } },
        }) as any), 400)
    })
    it('案件不存在 → 404', async () => {
        mFindCaseBySession.mockResolvedValue(null as any)
        expectError(await chatHandler(makeEvent({
            userId: 100, body: { config: { configurable: { thread_id: 'S' } }, input: { message: 'hi' } },
        }) as any), 404)
    })
    it('案件非本人 → 403', async () => {
        mFindCaseBySession.mockResolvedValue({ id: 1, userId: 999 } as any)
        expectError(await chatHandler(makeEvent({
            userId: 100, body: { config: { configurable: { thread_id: 'S' } }, input: { message: 'hi' } },
        }) as any), 403)
    })
})

describe('POST /api/v1/cases/analysis/init-session', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mValidateAccess.mockResolvedValue(undefined as any)
        mCreateSession.mockResolvedValue({ sessionId: 'S', isNew: true } as any)
    })
    it('happy', async () => { expectSuccess(await initSessionHandler(makeEvent({ userId: 100, body: { caseId: 1 } }) as any)) })
    it('未登录 → 401', async () => { expectError(await initSessionHandler(makeEvent({ body: { caseId: 1 } }) as any), 401) })
    it('参数非法 → 400', async () => { expectError(await initSessionHandler(makeEvent({ userId: 100, body: {} }) as any), 400) })
    it('无权访问 → 403', async () => { mValidateAccess.mockRejectedValue(new Error('无权')); expectError(await initSessionHandler(makeEvent({ userId: 100, body: { caseId: 1 } }) as any), 403) })
    it('案件不存在 → 404', async () => { mCreateSession.mockResolvedValue(null as any); expectError(await initSessionHandler(makeEvent({ userId: 100, body: { caseId: 1 } }) as any), 404) })
})

describe('POST /api/v1/cases/analysis/module-session', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mGetNodeByName.mockResolvedValue({ id: 5 } as any)
        mCreateSession.mockResolvedValue({ sessionId: 'S', isNew: true } as any)
    })
    it('happy', async () => { expectSuccess(await moduleSessionHandler(makeEvent({ userId: 100, body: { caseId: 1, moduleName: 'summary' } }) as any)) })
    it('未登录 → 401', async () => { expectError(await moduleSessionHandler(makeEvent({ body: {} }) as any), 401) })
    it('参数非法 → 400', async () => { expectError(await moduleSessionHandler(makeEvent({ userId: 100, body: {} }) as any), 400) })
    it('节点不存在 → 404', async () => { mGetNodeByName.mockResolvedValue(null as any); expectError(await moduleSessionHandler(makeEvent({ userId: 100, body: { caseId: 1, moduleName: 'X' } }) as any), 404) })
    it('案件不存在 → 404', async () => { mCreateSession.mockResolvedValue(null as any); expectError(await moduleSessionHandler(makeEvent({ userId: 100, body: { caseId: 1, moduleName: 'summary' } }) as any), 404) })
})

describe('DELETE /api/v1/cases/analysis/module-session/:sessionId', () => {
    beforeEach(() => vi.clearAllMocks())
    it('happy', async () => { mSoftDeleteSession.mockResolvedValue({ success: true } as any); expectSuccess(await deleteModuleSessionHandler(makeEvent({ userId: 100, params: { sessionId: 'S' } }) as any)) })
    it('未登录 → 401', async () => { expectError(await deleteModuleSessionHandler(makeEvent({ params: { sessionId: 'S' } }) as any), 401) })
    it('缺 sessionId → 400', async () => { expectError(await deleteModuleSessionHandler(makeEvent({ userId: 100, params: {} }) as any), 400) })
    it('不存在 → 404', async () => { mSoftDeleteSession.mockResolvedValue({ success: false, error: 'session 不存在' } as any); expectError(await deleteModuleSessionHandler(makeEvent({ userId: 100, params: { sessionId: 'S' } }) as any), 404) })
    it('无权 → 403', async () => { mSoftDeleteSession.mockResolvedValue({ success: false, error: '无权' } as any); expectError(await deleteModuleSessionHandler(makeEvent({ userId: 100, params: { sessionId: 'S' } }) as any), 403) })
})

describe('GET /api/v1/cases/analysis/module-sessions', () => {
    beforeEach(() => vi.clearAllMocks())
    it('happy', async () => { mListSessions.mockResolvedValue([{ sessionId: 'S', metadata: { moduleName: 'summary' }, hasActiveRun: false, createdAt: new Date(), updatedAt: new Date() }] as any); expectSuccess(await moduleSessionsHandler(makeEvent({ userId: 100, query: { caseId: '1' } }) as any)) })
    it('未登录 → 401', async () => { expectError(await moduleSessionsHandler(makeEvent({ query: {} }) as any), 401) })
    it('缺 caseId → 400', async () => { expectError(await moduleSessionsHandler(makeEvent({ userId: 100, query: {} }) as any), 400) })
    it('案件不存在 → 404', async () => { mListSessions.mockResolvedValue(null as any); expectError(await moduleSessionsHandler(makeEvent({ userId: 100, query: { caseId: '1' } }) as any), 404) })
})

describe('GET /api/v1/cases/analysis/runs/:sessionId', () => {
    beforeEach(() => vi.clearAllMocks())
    it('happy', async () => { mFindCaseBySession.mockResolvedValue({ id: 1, userId: 100 } as any); mGetRunList.mockResolvedValue([] as any); expectSuccess(await runsHandler(makeEvent({ userId: 100, params: { sessionId: 'S' } }) as any)) })
    it('未登录 → 401', async () => { expectError(await runsHandler(makeEvent({ params: { sessionId: 'S' } }) as any), 401) })
    it('案件不存在 → 404', async () => { mFindCaseBySession.mockResolvedValue(null as any); expectError(await runsHandler(makeEvent({ userId: 100, params: { sessionId: 'S' } }) as any), 404) })
    it('非本人 → 403', async () => { mFindCaseBySession.mockResolvedValue({ id: 1, userId: 999 } as any); expectError(await runsHandler(makeEvent({ userId: 100, params: { sessionId: 'S' } }) as any), 403) })
})

describe('POST /api/v1/cases/analysis/runs/cancel/:runId', () => {
    beforeEach(() => vi.clearAllMocks())
    it('happy', async () => {
        ;(globalThis as any).prisma.agentRuns.findUnique.mockResolvedValue({ id: 'R', userId: 100 })
        mCancelRun.mockResolvedValue({ success: true } as any)
        expectSuccess(await cancelRunHandler(makeEvent({ userId: 100, params: { runId: 'R' } }) as any))
    })
    it('未登录 → 401', async () => { expectError(await cancelRunHandler(makeEvent({ params: { runId: 'R' } }) as any), 401) })
    it('run 不存在 → 404', async () => { ;(globalThis as any).prisma.agentRuns.findUnique.mockResolvedValue(null); expectError(await cancelRunHandler(makeEvent({ userId: 100, params: { runId: 'R' } }) as any), 404) })
    it('非本人 → 403', async () => { ;(globalThis as any).prisma.agentRuns.findUnique.mockResolvedValue({ id: 'R', userId: 999 }); expectError(await cancelRunHandler(makeEvent({ userId: 100, params: { runId: 'R' } }) as any), 403) })
    it('cancel 失败 → 400', async () => {
        ;(globalThis as any).prisma.agentRuns.findUnique.mockResolvedValue({ id: 'R', userId: 100 })
        mCancelRun.mockResolvedValue({ success: false, error: '已结束' } as any)
        expectError(await cancelRunHandler(makeEvent({ userId: 100, params: { runId: 'R' } }) as any), 400)
    })
})

describe('GET /api/v1/cases/analysis/runs/current/:sessionId', () => {
    beforeEach(() => vi.clearAllMocks())
    it('happy', async () => { mFindCaseBySession.mockResolvedValue({ id: 1, userId: 100 } as any); mActiveRun.mockResolvedValue({ id: 'R' } as any); expectSuccess(await currentRunHandler(makeEvent({ userId: 100, params: { sessionId: 'S' } }) as any)) })
    it('未登录 → 401', async () => { expectError(await currentRunHandler(makeEvent({ params: { sessionId: 'S' } }) as any), 401) })
    it('案件不存在 → 404', async () => { mFindCaseBySession.mockResolvedValue(null as any); expectError(await currentRunHandler(makeEvent({ userId: 100, params: { sessionId: 'S' } }) as any), 404) })
})

describe('PATCH /api/v1/cases/analysis/session/rename/:sessionId', () => {
    beforeEach(() => vi.clearAllMocks())
    it('happy', async () => { mRenameSession.mockResolvedValue({ success: true } as any); expectSuccess(await renameHandler(makeEvent({ userId: 100, params: { sessionId: 'S' }, body: { title: '新名' } }) as any)) })
    it('未登录 → 401', async () => { expectError(await renameHandler(makeEvent({ params: { sessionId: 'S' }, body: { title: '新' } }) as any), 401) })
    it('缺 sessionId → 400', async () => { expectError(await renameHandler(makeEvent({ userId: 100, params: {}, body: { title: '新' } }) as any), 400) })
    it('参数非法 → 400', async () => { expectError(await renameHandler(makeEvent({ userId: 100, params: { sessionId: 'S' }, body: {} }) as any), 400) })
    it('不存在 → 404', async () => { mRenameSession.mockResolvedValue({ success: false, error: 'session 不存在' } as any); expectError(await renameHandler(makeEvent({ userId: 100, params: { sessionId: 'S' }, body: { title: 'X' } }) as any), 404) })
})

describe('GET /api/v1/cases/analysis/thread/:sessionId', () => {
    beforeEach(() => vi.clearAllMocks())
    it('happy', async () => {
        mFindCaseBySession.mockResolvedValue({ id: 1, userId: 100 } as any)
        mGetThreadValues.mockResolvedValue({ messages: [] } as any)
        mLoadSubAgents.mockResolvedValue([] as any)
        expectSuccess(await threadHandler(makeEvent({ userId: 100, params: { sessionId: 'S' } }) as any))
    })
    it('未登录 → 401', async () => { expectError(await threadHandler(makeEvent({ params: { sessionId: 'S' } }) as any), 401) })
    it('案件不存在 → 404', async () => { mFindCaseBySession.mockResolvedValue(null as any); expectError(await threadHandler(makeEvent({ userId: 100, params: { sessionId: 'S' } }) as any), 404) })
    it('非本人 → 403', async () => { mFindCaseBySession.mockResolvedValue({ id: 1, userId: 999 } as any); expectError(await threadHandler(makeEvent({ userId: 100, params: { sessionId: 'S' } }) as any), 403) })
    it('checkpoint 抛错 → 仍 success（降级）', async () => {
        mFindCaseBySession.mockResolvedValue({ id: 1, userId: 100 } as any)
        mGetThreadValues.mockRejectedValue(new Error('boom'))
        expectSuccess(await threadHandler(makeEvent({ userId: 100, params: { sessionId: 'S' } }) as any))
    })
})

describe('GET /api/v1/cases/analysis/versions/:caseId', () => {
    beforeEach(() => { vi.clearAllMocks(); mValidateAccess.mockResolvedValue(undefined as any) })
    it('happy', async () => { expectSuccess(await versionsHandler(makeEvent({ userId: 100, params: { caseId: '1' }, query: { analysisType: 'summary' } }) as any)) })
    it('未登录 → 401', async () => { expectError(await versionsHandler(makeEvent({ params: { caseId: '1' }, query: {} }) as any), 401) })
    it('id 非法 → 400', async () => { expectError(await versionsHandler(makeEvent({ userId: 100, params: { caseId: 'x' }, query: {} }) as any), 400) })
    it('缺 analysisType → 400', async () => { expectError(await versionsHandler(makeEvent({ userId: 100, params: { caseId: '1' }, query: {} }) as any), 400) })
})

describe('POST /api/v1/cases/analysis/versions/activate/:analysisId', () => {
    beforeEach(() => { vi.clearAllMocks(); mValidateAccess.mockResolvedValue(undefined as any) })
    it('happy', async () => {
        mFindAnalysis.mockResolvedValue({ id: 1, caseId: 5 } as any)
        mSwitchVersion.mockResolvedValue({ id: 1, version: 2, isActive: true } as any)
        expectSuccess(await activateHandler(makeEvent({ userId: 100, params: { analysisId: '1' } }) as any))
    })
    it('未登录 → 401', async () => { expectError(await activateHandler(makeEvent({ params: { analysisId: '1' } }) as any), 401) })
    it('id 非法 → 400', async () => { expectError(await activateHandler(makeEvent({ userId: 100, params: { analysisId: 'x' } }) as any), 400) })
    it('记录不存在 → 404', async () => { mFindAnalysis.mockResolvedValue(null as any); expectError(await activateHandler(makeEvent({ userId: 100, params: { analysisId: '1' } }) as any), 404) })
    it('switch 抛错 → 400', async () => {
        mFindAnalysis.mockResolvedValue({ id: 1, caseId: 5 } as any)
        mSwitchVersion.mockRejectedValue(new Error('boom'))
        expectError(await activateHandler(makeEvent({ userId: 100, params: { analysisId: '1' } }) as any), 400)
    })
})

describe('POST /api/v1/cases/analysis/xiaosuo-session', () => {
    beforeEach(() => { vi.clearAllMocks(); mCreateSession.mockResolvedValue({ sessionId: 'S' } as any) })
    it('happy', async () => { expectSuccess(await xiaosuoCreateHandler(makeEvent({ userId: 100, body: { caseId: 1 } }) as any)) })
    it('未登录 → 401', async () => { expectError(await xiaosuoCreateHandler(makeEvent({ body: {} }) as any), 401) })
    it('参数非法 → 400', async () => { expectError(await xiaosuoCreateHandler(makeEvent({ userId: 100, body: {} }) as any), 400) })
    it('案件不存在 → 404', async () => { mCreateSession.mockResolvedValue(null as any); expectError(await xiaosuoCreateHandler(makeEvent({ userId: 100, body: { caseId: 1 } }) as any), 404) })
})

describe('DELETE /api/v1/cases/analysis/xiaosuo-session/:sessionId', () => {
    beforeEach(() => vi.clearAllMocks())
    it('happy', async () => {
        ;(globalThis as any).prisma.caseSessions.findFirst.mockResolvedValue({
            sessionId: 'S', case: { userId: 100 }, metadata: { source: 'xiaosuo' },
        })
        mActiveRun.mockResolvedValue(null as any)
        ;(globalThis as any).prisma.caseSessions.update.mockResolvedValue({})
        expectSuccess(await xiaosuoDeleteHandler(makeEvent({ userId: 100, params: { sessionId: 'S' } }) as any))
    })
    it('未登录 → 401', async () => { expectError(await xiaosuoDeleteHandler(makeEvent({ params: { sessionId: 'S' } }) as any), 401) })
    it('缺 sessionId → 400', async () => { expectError(await xiaosuoDeleteHandler(makeEvent({ userId: 100, params: {} }) as any), 400) })
    it('session 不存在 → 404', async () => {
        ;(globalThis as any).prisma.caseSessions.findFirst.mockResolvedValue(null)
        expectError(await xiaosuoDeleteHandler(makeEvent({ userId: 100, params: { sessionId: 'S' } }) as any), 404)
    })
    it('session 非本人 → 403', async () => {
        ;(globalThis as any).prisma.caseSessions.findFirst.mockResolvedValue({
            sessionId: 'S', case: { userId: 999 }, metadata: { source: 'xiaosuo' },
        })
        expectError(await xiaosuoDeleteHandler(makeEvent({ userId: 100, params: { sessionId: 'S' } }) as any), 403)
    })
    it('非小索 session → 400', async () => {
        ;(globalThis as any).prisma.caseSessions.findFirst.mockResolvedValue({
            sessionId: 'S', case: { userId: 100 }, metadata: { source: 'main' },
        })
        expectError(await xiaosuoDeleteHandler(makeEvent({ userId: 100, params: { sessionId: 'S' } }) as any), 400)
    })
})

describe('GET /api/v1/cases/analysis/xiaosuo-sessions', () => {
    beforeEach(() => vi.clearAllMocks())
    it('happy', async () => {
        mListSessions.mockResolvedValue([{ sessionId: 'S', metadata: { title: '新对话' }, hasActiveRun: false, createdAt: new Date(), updatedAt: new Date() }] as any)
        expectSuccess(await xiaosuoListHandler(makeEvent({ userId: 100, query: { caseId: '1' } }) as any))
    })
    it('未登录 → 401', async () => { expectError(await xiaosuoListHandler(makeEvent({ query: {} }) as any), 401) })
    it('缺 caseId → 400', async () => { expectError(await xiaosuoListHandler(makeEvent({ userId: 100, query: {} }) as any), 400) })
    it('案件不存在 → 404', async () => { mListSessions.mockResolvedValue(null as any); expectError(await xiaosuoListHandler(makeEvent({ userId: 100, query: { caseId: '1' } }) as any), 404) })
})

describe('GET /api/v1/cases/materials/:caseId', () => {
    beforeEach(() => { vi.clearAllMocks(); mValidateAccess.mockResolvedValue(undefined as any) })
    it('happy', async () => { mGetMaterials.mockResolvedValue([{ id: 1, name: 'A', type: 1, ossFileId: null, isEncrypted: false, realStatus: 2, summary: '', createdAt: new Date(), fileName: '', fileSize: 0, fileType: '' }] as any); expectSuccess(await materialsListHandler(makeEvent({ userId: 100, params: { caseId: '1' } }) as any)) })
    it('未登录 → 401', async () => { expectError(await materialsListHandler(makeEvent({ params: { caseId: '1' } }) as any), 401) })
    it('id 非法 → 400', async () => { expectError(await materialsListHandler(makeEvent({ userId: 100, params: { caseId: 'x' } }) as any), 400) })
    it('无权访问 → 403', async () => { mValidateAccess.mockRejectedValue(new Error('无权访问该案件')); expectError(await materialsListHandler(makeEvent({ userId: 100, params: { caseId: '1' } }) as any), 403) })
})

describe('POST /api/v1/cases/materials/:caseId', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mValidateAccess.mockResolvedValue(undefined as any)
        mGetMaterials.mockResolvedValue([] as any)
        mBatchAddMaterials.mockResolvedValue(undefined as any)
    })
    it('happy', async () => {
        mGetMaterials
            .mockResolvedValueOnce([] as any)  // 已有材料
            .mockResolvedValueOnce([{ id: 1, name: 'doc', type: 2, ossFileId: 99, isEncrypted: false, realStatus: 1, summary: '', fileName: '', fileSize: 0, fileType: '' }] as any)  // 添加后查询
        expectSuccess(await materialsAddHandler(makeEvent({ userId: 100, params: { caseId: '1' }, body: { materials: [{ type: 2, ossFileId: 99 }] } }) as any))
    })
    it('未登录 → 401', async () => { expectError(await materialsAddHandler(makeEvent({ params: { caseId: '1' }, body: {} }) as any), 401) })
    it('参数非法 → 400', async () => { expectError(await materialsAddHandler(makeEvent({ userId: 100, params: { caseId: '1' }, body: { materials: [] } }) as any), 400) })
    it('无权访问 → 403', async () => { mValidateAccess.mockRejectedValue(new Error('无权访问该案件')); expectError(await materialsAddHandler(makeEvent({ userId: 100, params: { caseId: '1' }, body: { materials: [{ type: 2, ossFileId: 99 }] } }) as any), 403) })
    it('全部已存在 → success 空数组', async () => {
        mGetMaterials.mockResolvedValueOnce([{ ossFileId: 99 }] as any)
        expectSuccess(await materialsAddHandler(makeEvent({ userId: 100, params: { caseId: '1' }, body: { materials: [{ type: 2, ossFileId: 99 }] } }) as any))
    })
})

describe('DELETE /api/v1/cases/materials/delete/:caseId', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mValidateAccess.mockResolvedValue(undefined as any)
        ;(globalThis as any).prisma.caseMaterials.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }])
        mDeleteMaterials.mockResolvedValue(2 as any)
    })
    it('happy', async () => { expectSuccess(await materialsDeleteHandler(makeEvent({ userId: 100, params: { caseId: '1' }, body: { materialIds: [1, 2] } }) as any)) })
    it('未登录 → 401', async () => { expectError(await materialsDeleteHandler(makeEvent({ params: { caseId: '1' }, body: { materialIds: [1] } }) as any), 401) })
    it('参数非法 → 400', async () => { expectError(await materialsDeleteHandler(makeEvent({ userId: 100, params: { caseId: '1' }, body: { materialIds: [] } }) as any), 400) })
    it('无权访问 → 403', async () => { mValidateAccess.mockRejectedValue(new Error('无权访问该案件')); expectError(await materialsDeleteHandler(makeEvent({ userId: 100, params: { caseId: '1' }, body: { materialIds: [1] } }) as any), 403) })
    it('材料不属于案件 → 400', async () => {
        ;(globalThis as any).prisma.caseMaterials.findMany.mockResolvedValue([])
        expectError(await materialsDeleteHandler(makeEvent({ userId: 100, params: { caseId: '1' }, body: { materialIds: [1] } }) as any), 400)
    })
})

describe('DELETE /api/v1/cases/memories/:memoryId', () => {
    const VALID_UUID = '11111111-1111-4111-8111-111111111111'
    beforeEach(() => vi.clearAllMocks())
    it('happy', async () => {
        ;(globalThis as any).prisma.$queryRawUnsafe.mockResolvedValue([{ caseId: 1, source: 'manual_user' }])
        ;(globalThis as any).prisma.cases.findUnique.mockResolvedValue({ userId: 100 })
        mSoftDeleteMemory.mockResolvedValue(undefined as any)
        expectSuccess(await memDeleteHandler(makeEvent({ userId: 100, params: { memoryId: VALID_UUID } }) as any))
    })
    it('未登录 → 401', async () => { expectError(await memDeleteHandler(makeEvent({ params: { memoryId: VALID_UUID } }) as any), 401) })
    it('记忆不存在 → 404', async () => {
        ;(globalThis as any).prisma.$queryRawUnsafe.mockResolvedValue([])
        expectError(await memDeleteHandler(makeEvent({ userId: 100, params: { memoryId: VALID_UUID } }) as any), 404)
    })
    it('非 manual_user → 403', async () => {
        ;(globalThis as any).prisma.$queryRawUnsafe.mockResolvedValue([{ caseId: 1, source: 'consolidator' }])
        expectError(await memDeleteHandler(makeEvent({ userId: 100, params: { memoryId: VALID_UUID } }) as any), 403)
    })
    it('案件 owner 非本人 → 403', async () => {
        ;(globalThis as any).prisma.$queryRawUnsafe.mockResolvedValue([{ caseId: 1, source: 'manual_user' }])
        ;(globalThis as any).prisma.cases.findUnique.mockResolvedValue({ userId: 999 })
        expectError(await memDeleteHandler(makeEvent({ userId: 100, params: { memoryId: VALID_UUID } }) as any), 403)
    })
})

describe('GET /api/v1/cases/memories/by-case/:caseId', () => {
    beforeEach(() => vi.clearAllMocks())
    it('happy', async () => {
        ;(globalThis as any).prisma.cases.findUnique.mockResolvedValue({ userId: 100 })
        mListMemories.mockResolvedValue({ memories: [], nextCursor: null } as any)
        expectSuccess(await memListHandler(makeEvent({ userId: 100, params: { caseId: '1' }, query: {} }) as any))
    })
    it('未登录 → 401', async () => { expectError(await memListHandler(makeEvent({ params: { caseId: '1' }, query: {} }) as any), 401) })
    it('id 非法 → 400', async () => { expectError(await memListHandler(makeEvent({ userId: 100, params: { caseId: 'x' }, query: {} }) as any), 400) })
    it('案件不存在 → 404', async () => {
        ;(globalThis as any).prisma.cases.findUnique.mockResolvedValue(null)
        expectError(await memListHandler(makeEvent({ userId: 100, params: { caseId: '1' }, query: {} }) as any), 404)
    })
    it('非本人 → 403', async () => {
        ;(globalThis as any).prisma.cases.findUnique.mockResolvedValue({ userId: 999 })
        expectError(await memListHandler(makeEvent({ userId: 100, params: { caseId: '1' }, query: {} }) as any), 403)
    })
})

describe('POST /api/v1/cases/memories/by-case/:caseId', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ;(globalThis as any).prisma.cases.findUnique.mockResolvedValue({ userId: 100 })
        mInferSubject.mockResolvedValue('S' as any)
        mWriteMemory.mockResolvedValue({ id: 'mem-1' } as any)
        mFindMemBySubj.mockResolvedValue(null as any)
    })
    it('happy', async () => {
        expectSuccess(await memCreateHandler(makeEvent({
            userId: 100, params: { caseId: '1' },
            body: { text: '案件信息长一点', kind: 'fact' },
        }) as any))
    })
    it('未登录 → 401', async () => { expectError(await memCreateHandler(makeEvent({ params: { caseId: '1' }, body: {} }) as any), 401) })
    it('id 非法 → 400', async () => { expectError(await memCreateHandler(makeEvent({ userId: 100, params: { caseId: 'x' }, body: {} }) as any), 400) })
    it('案件不存在 → 404', async () => {
        ;(globalThis as any).prisma.cases.findUnique.mockResolvedValue(null)
        expectError(await memCreateHandler(makeEvent({ userId: 100, params: { caseId: '1' }, body: { text: 'x'.repeat(20), kind: 'fact' } }) as any), 404)
    })
    it('非本人 → 403', async () => {
        ;(globalThis as any).prisma.cases.findUnique.mockResolvedValue({ userId: 999 })
        expectError(await memCreateHandler(makeEvent({ userId: 100, params: { caseId: '1' }, body: { text: 'x'.repeat(20), kind: 'fact' } }) as any), 403)
    })
    it('参数非法 → 400', async () => { expectError(await memCreateHandler(makeEvent({ userId: 100, params: { caseId: '1' }, body: {} }) as any), 400) })
})
