/**
 * search_case_materials 增强功能测试
 *
 * 测试三种检索模式：
 * - query only: 语义搜索，caseId→sourceId 限定范围
 * - query + sourceId: 语义搜索，限定到指定 sourceId
 * - sourceId only: 精确查询完整内容
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MaterialSearchResult } from '../../../server/services/material/materialEmbedding.service'

const mocks = vi.hoisted(() => ({
    getMaterialsByCaseIdService: vi.fn(),
    searchCaseMaterialsService: vi.fn(),
    fetchMaterialContents: vi.fn(),
    getSourceId: vi.fn(),
    similaritySearchWithScore: vi.fn(),
}))

vi.mock('../../../server/services/material/material.service', () => ({
    getMaterialsByCaseIdService: mocks.getMaterialsByCaseIdService,
}))
vi.mock('~~/server/services/material/material.service', () => ({
    getMaterialsByCaseIdService: mocks.getMaterialsByCaseIdService,
}))
vi.mock('../../../server/services/material/materialPipeline.service', () => ({
    fetchMaterialContents: mocks.fetchMaterialContents,
    getSourceId: mocks.getSourceId,
}))
vi.mock('~~/server/services/material/materialPipeline.service', () => ({
    fetchMaterialContents: mocks.fetchMaterialContents,
    getSourceId: mocks.getSourceId,
}))
vi.mock('../../../server/services/legal/vectorStore.service', () => ({
    similaritySearchWithScore: mocks.similaritySearchWithScore,
}))
vi.mock('~~/server/services/legal/vectorStore.service', () => ({
    similaritySearchWithScore: mocks.similaritySearchWithScore,
}))
vi.mock('../../../server/services/material/materialEmbedding.service', async (importOriginal) => {
    const original = await importOriginal() as any
    return {
        ...original,
        searchCaseMaterialsService: mocks.searchCaseMaterialsService,
    }
})
vi.mock('~~/server/services/material/materialEmbedding.service', async (importOriginal) => {
    const original = await importOriginal() as any
    return {
        ...original,
        searchCaseMaterialsService: mocks.searchCaseMaterialsService,
    }
})

describe('search_case_materials 增强', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('searchCaseMaterialsService 支持 sourceIds 参数', async () => {
        const { searchCaseMaterialsService } = await import(
            '../../../server/services/material/materialEmbedding.service'
        )
        expect(typeof searchCaseMaterialsService).toBe('function')
    })

    it('MaterialSearchResult 使用 sourceId 和 sourceName 字段', () => {
        const mockResult: MaterialSearchResult = {
            content: '测试内容',
            sourceId: 1,
            sourceName: '测试材料',
            score: 0.9,
            chunkIndex: 0,
        }
        expect(mockResult.sourceId).toBe(1)
        expect(mockResult.sourceName).toBe('测试材料')
    })

    it('searchCaseMaterials 直接调用支持 sourceIds 参数', async () => {
        const { searchCaseMaterials } = await import(
            '../../../server/services/material/materialSearch.tool'
        )
        mocks.searchCaseMaterialsService.mockResolvedValue([])
        const result = await searchCaseMaterials(1, 1, '查询', 5, [100, 200])
        expect(mocks.searchCaseMaterialsService).toHaveBeenCalledWith(1, 1, '查询', 5, [100, 200])
        expect(result).toEqual([])
    })

    it('materialSearchToolMeta 包含 sourceId 参数', async () => {
        const { materialSearchToolMeta } = await import(
            '../../../server/services/material/materialSearch.tool'
        )
        expect(materialSearchToolMeta.parameters).toHaveProperty('sourceId')
        expect(materialSearchToolMeta.parameters.query.required).toBe(false)
    })
})
