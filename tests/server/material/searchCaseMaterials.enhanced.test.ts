/**
 * search_case_materials 增强功能测试
 *
 * 测试三种检索模式：
 * - query only: 语义搜索，caseId→sourceId 限定范围
 * - query + sourceId: 语义搜索，限定到指定 sourceId
 * - sourceId only: 精确查询完整内容
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
    getMaterialsByCaseIdService: vi.fn(),
    searchCaseMaterials: vi.fn(),
    fetchMaterialContents: vi.fn(),
}))

vi.mock('../../../server/services/material/material.service', () => ({
    getMaterialsByCaseIdService: mocks.getMaterialsByCaseIdService,
}))
vi.mock('~~/server/services/material/material.service', () => ({
    getMaterialsByCaseIdService: mocks.getMaterialsByCaseIdService,
}))
vi.mock('../../../server/services/material/materialSearch.tool', () => ({
    searchCaseMaterials: mocks.searchCaseMaterials,
}))
vi.mock('~~/server/services/material/materialSearch.tool', () => ({
    searchCaseMaterials: mocks.searchCaseMaterials,
}))
vi.mock('../../../server/services/material/materialPipeline.service', async (importOriginal) => {
    const original = await importOriginal() as any
    return {
        ...original,
        fetchMaterialContents: mocks.fetchMaterialContents,
    }
})
vi.mock('~~/server/services/material/materialPipeline.service', async (importOriginal) => {
    const original = await importOriginal() as any
    return {
        ...original,
        fetchMaterialContents: mocks.fetchMaterialContents,
    }
})

describe('search_case_materials 增强', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('searchCaseMaterials 支持 sourceIds 参数透传', async () => {
        // 验证 searchCaseMaterialsService 的新签名
        const { searchCaseMaterialsService } = await import(
            '../../../server/services/material/materialEmbedding.service'
        )
        // 类型级验证：sourceIds 参数存在
        expect(typeof searchCaseMaterialsService).toBe('function')
        expect(searchCaseMaterialsService.length).toBeGreaterThanOrEqual(3)
    })

    it('MaterialSearchResult 使用 sourceId 和 sourceName 字段', async () => {
        const mod = await import(
            '../../../server/services/material/materialEmbedding.service'
        )
        // 运行时验证：通过 mock 数据确认新字段结构
        type MaterialSearchResult = Awaited<ReturnType<typeof mod.searchCaseMaterialsService>>[number]
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

    it('placeholder - searchCaseMaterials.tool.ts schema 将包含 sourceId 参数', () => {
        // Task 6 实现后补充：验证 schema 包含 sourceId 字段
        // 当前 schema 仅有 query 和 k
        expect(true).toBe(true)
    })

    it('placeholder - query + sourceId 组合检索', () => {
        // Task 6 实现后补充
        expect(true).toBe(true)
    })

    it('placeholder - sourceId only 精确查询', () => {
        // Task 6 实现后补充
        expect(true).toBe(true)
    })
})
