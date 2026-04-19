import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
    updateDocumentDraftDAO: vi.fn(),
    createSnapshotService: vi.fn(),
    applyAITitleIfAllowedService: vi.fn(),
}))

vi.mock('~~/server/services/assistant/document/documentDraft.dao', () => ({
    updateDocumentDraftDAO: mocks.updateDocumentDraftDAO,
}))
vi.mock('~~/server/services/assistant/document/documentDraftSnapshot.service', () => ({
    createSnapshotService: mocks.createSnapshotService,
}))
vi.mock('~~/server/services/assistant/document/documentDraft.service', () => ({
    applyAITitleIfAllowedService: mocks.applyAITitleIfAllowedService,
}))

import { draftResultPersistenceMiddleware } from '~~/server/services/workflow/middleware/draftResultPersistence.middleware'

function invokeAfter(state: any, draftId = 1) {
    const mw = draftResultPersistenceMiddleware({ draftId, sessionId: 'sid' })
    return (mw as any).afterAgent.hook(state)
}

describe('draftResultPersistence afterAgent', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.updateDocumentDraftDAO.mockResolvedValue({})
        mocks.createSnapshotService.mockResolvedValue({ id: 1 })
        mocks.applyAITitleIfAllowedService.mockResolvedValue(true)
    })

    it('structuredResponse 含 values + aiTitle → 写 snapshot、更新 values、应用 aiTitle', async () => {
        await invokeAfter({
            structuredResponse: {
                values: { f1: 'v1' },
                suggestions: { f1: '来自材料' },
                aiTitle: '张三诉李四起诉状',
            },
        })
        expect(mocks.createSnapshotService).toHaveBeenCalledWith(
            1, 'ai-extract',
            expect.objectContaining({ values: { f1: 'v1' }, aiTitle: '张三诉李四起诉状' }),
        )
        expect(mocks.updateDocumentDraftDAO).toHaveBeenCalledWith(1, expect.objectContaining({
            values: { f1: 'v1' },
            status: 'ready',
        }))
        expect(mocks.applyAITitleIfAllowedService).toHaveBeenCalledWith(1, '张三诉李四起诉状')
    })

    it('无 aiTitle 时不调用 applyAITitleIfAllowedService，但仍写 snapshot 与 values', async () => {
        await invokeAfter({
            structuredResponse: { values: { f1: 'v1' } },
        })
        expect(mocks.createSnapshotService).toHaveBeenCalled()
        expect(mocks.applyAITitleIfAllowedService).not.toHaveBeenCalled()
    })

    it('结构化缺失且消息体无 JSON → status=failed，不写 snapshot', async () => {
        await invokeAfter({ messages: [] })
        expect(mocks.createSnapshotService).not.toHaveBeenCalled()
        expect(mocks.updateDocumentDraftDAO).toHaveBeenCalledWith(1, { status: 'failed' })
    })

    it('snapshot 创建失败不阻塞主流程（仍能更新 draft.values）', async () => {
        mocks.createSnapshotService.mockRejectedValueOnce(new Error('snapshot boom'))
        await invokeAfter({
            structuredResponse: { values: { f1: 'v1' } },
        })
        // 即使 snapshot 失败，draft.values 仍应被写入 + status=ready
        expect(mocks.updateDocumentDraftDAO).toHaveBeenCalledWith(1, expect.objectContaining({
            values: { f1: 'v1' },
            status: 'ready',
        }))
    })
})
