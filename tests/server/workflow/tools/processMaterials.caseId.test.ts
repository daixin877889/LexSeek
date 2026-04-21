/**
 * processMaterials tool: 从 ctx 取 caseId 并透传给 ensureMaterialsReadyByDraftService
 *
 * **Feature: document-case-materials-sync / Task 5**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock 两个批处理入口（跨模块 mock，live binding 生效）
vi.mock('~~/server/services/material/materialPipeline.service', () => ({
    ensureMaterialsReadyService: vi.fn(async () => ({ materials: [], embeddedMap: new Map() })),
    ensureMaterialsReadyByDraftService: vi.fn(async () => ({ materials: [], embeddedMap: new Map() })),
    getMaterialContextService: vi.fn(async () => ({ materialList: [], mode: 'full', totalTokens: 0 })),
    estimateTokens: vi.fn(() => 0),
    getSourceId: vi.fn((m: any) => m.id),
    TOKEN_THRESHOLD: 32000,
}))

import { createTool } from '~~/server/services/workflow/tools/processMaterials.tool'
import { ensureMaterialsReadyByDraftService } from '~~/server/services/material/materialPipeline.service'

const mockByDraft = ensureMaterialsReadyByDraftService as ReturnType<typeof vi.fn>

describe('processMaterials tool 透传 caseId', () => {
    beforeEach(() => {
        mockByDraft.mockClear()
    })

    it('ctx 同时含 draftId + caseId 时，以 { fileIds, caseId } 调用 ensureMaterialsReadyByDraftService', async () => {
        const tool = createTool({ userId: 10, draftId: 20, caseId: 30 })
        await tool.invoke({ fileIds: [101, 102] })

        expect(mockByDraft).toHaveBeenCalledTimes(1)
        expect(mockByDraft).toHaveBeenCalledWith(20, 10, { fileIds: [101, 102], caseId: 30 })
    })

    it('ctx 仅含 draftId 时，caseId 透传为 null（独立文书页）', async () => {
        const tool = createTool({ userId: 10, draftId: 20 })
        await tool.invoke({ fileIds: [101] })

        expect(mockByDraft).toHaveBeenCalledTimes(1)
        expect(mockByDraft).toHaveBeenCalledWith(20, 10, { fileIds: [101], caseId: null })
    })
})
