// tests/server/material/textContentRecords.service.test.ts

/**
 * textContentRecords Service 测试
 *
 * 测试文本材料嵌入的完整流程（含状态管理）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
    createTextContentRecordDAO: vi.fn(),
    findTextContentRecordByIdDAO: vi.fn(),
    findTextContentRecordByMaterialIdDAO: vi.fn(),
    updateTextContentRecordEmbeddingDAO: vi.fn(),
    embedTextService: vi.fn(),
}))

vi.mock('../../../server/services/material/textContentRecords.dao', () => ({
    createTextContentRecordDAO: mocks.createTextContentRecordDAO,
    findTextContentRecordByIdDAO: mocks.findTextContentRecordByIdDAO,
    findTextContentRecordByMaterialIdDAO: mocks.findTextContentRecordByMaterialIdDAO,
    updateTextContentRecordEmbeddingDAO: mocks.updateTextContentRecordEmbeddingDAO,
}))
vi.mock('~~/server/services/material/textContentRecords.dao', () => ({
    createTextContentRecordDAO: mocks.createTextContentRecordDAO,
    findTextContentRecordByIdDAO: mocks.findTextContentRecordByIdDAO,
    findTextContentRecordByMaterialIdDAO: mocks.findTextContentRecordByMaterialIdDAO,
    updateTextContentRecordEmbeddingDAO: mocks.updateTextContentRecordEmbeddingDAO,
}))

vi.mock('../../../server/services/material/materialEmbedding.service', () => ({
    embedTextService: mocks.embedTextService,
}))
vi.mock('~~/server/services/material/materialEmbedding.service', () => ({
    embedTextService: mocks.embedTextService,
}))

import {
    embedTextContentService,
} from '../../../server/services/material/textContentRecords.service'

describe('embedTextContentService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('应嵌入文本内容并更新记录', async () => {
        const mockRecord = {
            id: 1, userId: 1, caseId: 1, materialId: 10,
            content: '测试内容', htmlContent: null,
            status: 0, vectorIds: [], lastEmbeddingAt: null,
        }
        mocks.findTextContentRecordByIdDAO.mockResolvedValue(mockRecord)
        mocks.embedTextService.mockResolvedValue({
            ids: ['v1', 'v2'], lastEmbeddingAt: '2026-03-20T12:00:00+08:00', chunkCount: 2,
        })
        mocks.updateTextContentRecordEmbeddingDAO.mockResolvedValue(undefined)

        const result = await embedTextContentService(1, 1)

        expect(result.success).toBe(true)
        expect(result.chunkCount).toBe(2)
        expect(mocks.updateTextContentRecordEmbeddingDAO).toHaveBeenCalledWith(
            1,
            expect.objectContaining({
                vectorIds: ['v1', 'v2'],
                status: 2,
            })
        )
    })

    it('记录不存在应返回失败', async () => {
        mocks.findTextContentRecordByIdDAO.mockResolvedValue(null)

        const result = await embedTextContentService(999, 1)

        expect(result.success).toBe(false)
        expect(result.error).toContain('不存在')
    })

    it('内容为空应返回失败', async () => {
        mocks.findTextContentRecordByIdDAO.mockResolvedValue({
            id: 1, content: null, status: 0,
        })

        const result = await embedTextContentService(1, 1)

        expect(result.success).toBe(false)
        expect(result.error).toContain('内容为空')
    })

    it('嵌入失败应更新状态为失败', async () => {
        mocks.findTextContentRecordByIdDAO.mockResolvedValue({
            id: 1, content: '测试内容', materialId: 10, status: 0,
        })
        mocks.embedTextService.mockRejectedValue(new Error('向量化失败'))
        mocks.updateTextContentRecordEmbeddingDAO.mockResolvedValue(undefined)

        const result = await embedTextContentService(1, 1)

        expect(result.success).toBe(false)
        expect(mocks.updateTextContentRecordEmbeddingDAO).toHaveBeenCalledWith(
            1,
            expect.objectContaining({ status: 3 })
        )
    })
})
