import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../_helpers/handler-test'
import { expectError, makeEvent } from '../_helpers/handler-test'

vi.mock('~~/server/services/case/initAnalysis.service', () => ({
    validateAndSortModules: vi.fn((modules: string[]) => modules),
}))

vi.mock('~~/server/services/case/case.service', () => ({
    validateCaseAccessService: vi.fn(),
}))

vi.mock('~~/server/services/agent/agentRun.service', () => ({
    enqueueRunService: vi.fn(),
    getActiveRunService: vi.fn(),
    getLatestRunService: vi.fn(),
}))

vi.mock('~~/server/services/sse/agentSseStream', () => ({
    createAgentSseStream: vi.fn(() => new ReadableStream()),
}))

;(globalThis as any).prisma = {
    caseSessions: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
    },
    agentRuns: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
    },
    caseAnalyses: {
        findMany: vi.fn(async () => []),
    },
}

import { validateCaseAccessService } from '~~/server/services/case/case.service'
import { enqueueRunService, getActiveRunService } from '~~/server/services/agent/agentRun.service'

const { default: initAnalysisHandler } = await import('../../../server/api/v1/cases/init-analysis.post')

const mockPrisma = (globalThis as any).prisma
const mValidateAccess = vi.mocked(validateCaseAccessService)
const mGetActiveRun = vi.mocked(getActiveRunService)
const mEnqueueRun = vi.mocked(enqueueRunService)

describe('POST /api/v1/cases/init-analysis resume', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('thread_id 指向他人案件时拒绝恢复，且不触碰 run', async () => {
        mockPrisma.caseSessions.findFirst.mockResolvedValue({
            sessionId: 'foreign-thread',
            caseId: 200,
            type: 2,
            deletedAt: null,
        })
        mValidateAccess.mockRejectedValue(new Error('无权访问该案件'))

        const res = await initAnalysisHandler(makeEvent({
            userId: 100,
            body: {
                config: { configurable: { thread_id: 'foreign-thread' } },
                command: { resume: { approved: true } },
            },
        }) as any)

        expectError(res, 403, '案件不存在或无权访问')
        expect(mValidateAccess).toHaveBeenCalledWith(200, 100)
        expect(mGetActiveRun).not.toHaveBeenCalled()
        expect(mockPrisma.agentRuns.update).not.toHaveBeenCalled()
        expect(mEnqueueRun).not.toHaveBeenCalled()
    })
})
