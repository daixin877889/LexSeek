/**
 * 材料就绪保障 Pipeline - 补充覆盖率测试
 *
 * 覆盖 materialPipeline.service.ts 中已有测试未覆盖的路径：
 * - extractTextFromAsrResult: 各种格式
 * - fetchMaterialContents: 各类型材料获取内容
 * - getMaterialContextService: token 预算、摘要降级、空材料
 * - buildMaterialContextMessage / buildIncrementalMaterialMessage
 * - searchMaterialsService: 各种检索模式
 * - MATERIAL_PRIORITY / TOKEN_THRESHOLD
 *
 * **Feature: material-pipeline-coverage-extra**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MaterialWithFile } from '../../../server/services/material/material.service'
import { CaseMaterialType } from '#shared/types/case'

vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

const mockPrisma = {
    textContentRecords: { findMany: vi.fn() },
    docRecognitionRecords: { findMany: vi.fn() },
    imageRecognitionRecords: { findMany: vi.fn() },
    asrRecords: { findMany: vi.fn() },
}
vi.stubGlobal('prisma', mockPrisma)

// Mock 依赖（用于 searchMaterialsService）
const mockGetMaterialsByCaseIdService = vi.fn()
vi.mock('~~/server/services/material/material.service', () => ({
    getMaterialsByCaseIdService: (...args: any[]) => mockGetMaterialsByCaseIdService(...args),
    // T9：getMaterialContextService 跨表查 summary，本测试不关心 summary 命中，mock 成空 Map
    getMaterialSummariesByMaterials: vi.fn().mockResolvedValue(new Map()),
}))

const mockBatchCheckMaterialEmbeddedService = vi.fn()
const mockEmbedMaterialUnifiedService = vi.fn()
vi.mock('~~/server/services/material/materialEmbedding.service', () => ({
    batchCheckMaterialEmbeddedService: (...args: any[]) => mockBatchCheckMaterialEmbeddedService(...args),
    embedMaterialUnifiedService: (...args: any[]) => mockEmbedMaterialUnifiedService(...args),
    caseMaterialVectorConfig: {
        tableName: 'case_material_embeddings',
        vectorColumnName: 'embedding',
        contentColumnName: 'text',
        metadataColumnName: 'metadata',
    },
}))

vi.mock('~~/server/services/material/materialProcess.service', () => ({
    processMaterialService: vi.fn(),
    batchCheckMaterialRecognizedService: vi.fn().mockResolvedValue(new Map()),
}))

const mockRetrievalRouterService = vi.fn()
vi.mock('~~/server/services/retrieval/retrievalRouter.service', () => ({
    retrievalRouterService: (...args: any[]) => mockRetrievalRouterService(...args),
}))

vi.mock('~~/server/services/legal/vectorStore.service', () => ({
    similaritySearchWithScore: vi.fn().mockResolvedValue([]),
}))

import {
    extractTextFromAsrResult,
    fetchMaterialContents,
    getMaterialContextService,
    buildMaterialContextMessage,
    buildIncrementalMaterialMessage,
    searchMaterialsService,
    getSourceId,
    estimateTokens,
    MATERIAL_PRIORITY,
    TOKEN_THRESHOLD,
} from '../../../server/services/material/materialPipeline.service'

function makeMaterial(overrides: Partial<MaterialWithFile> & { id: number; type: number; name: string }): MaterialWithFile {
    return {
        caseId: 1,
        ossFileId: null,
        isEncrypted: false,
        status: 3,
        summary: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...overrides,
    } as MaterialWithFile
}

describe('materialPipeline.service - 补充覆盖率', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ==================== extractTextFromAsrResult ====================

    describe('extractTextFromAsrResult', () => {
        it('null 输入返回 null', () => {
            expect(extractTextFromAsrResult(null)).toBeNull()
            expect(extractTextFromAsrResult(undefined)).toBeNull()
        })

        it('扁平格式: sentences 数组', () => {
            const result = extractTextFromAsrResult({
                sentences: [
                    { text: '第一句' },
                    { text: '第二句' },
                ],
            })
            expect(result).toBe('第一句\n第二句')
        })

        it('嵌套格式: transcripts 数组', () => {
            const result = extractTextFromAsrResult({
                transcripts: [
                    { sentences: [{ text: '片段1' }] },
                    { sentences: [{ text: '片段2' }] },
                ],
            })
            expect(result).toBe('片段1\n片段2')
        })

        it('兜底: text 字段', () => {
            const result = extractTextFromAsrResult({ text: '直接文本' })
            expect(result).toBe('直接文本')
        })

        it('空 text 字段返回 null', () => {
            expect(extractTextFromAsrResult({ text: '   ' })).toBeNull()
        })

        it('无匹配字段返回 null', () => {
            expect(extractTextFromAsrResult({ foo: 'bar' })).toBeNull()
        })

        it('sentences 数组含空文本时过滤', () => {
            const result = extractTextFromAsrResult({
                sentences: [
                    { text: '有效' },
                    { text: '' },
                    { text: null },
                ],
            })
            expect(result).toBe('有效')
        })

        it('空 sentences 数组 fallback 到 transcripts', () => {
            const result = extractTextFromAsrResult({
                sentences: [],
                transcripts: [{ sentences: [{ text: '转录文本' }] }],
            })
            expect(result).toBe('转录文本')
        })
    })

    // ==================== fetchMaterialContents ====================

    describe('fetchMaterialContents', () => {
        it('获取文本材料内容', async () => {
            mockPrisma.textContentRecords.findMany.mockResolvedValue([
                { materialId: 1, content: '文本内容' },
            ])
            mockPrisma.docRecognitionRecords.findMany.mockResolvedValue([])
            mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([])
            mockPrisma.asrRecords.findMany.mockResolvedValue([])

            const materials = [
                { id: 1, type: CaseMaterialType.CASE_CONTENT, ossFileId: null },
            ]

            const contentMap = await fetchMaterialContents(materials)

            expect(contentMap.get(1)).toBe('文本内容')
        })

        it('获取文档材料内容（按 ossFileId 查找）', async () => {
            mockPrisma.textContentRecords.findMany.mockResolvedValue([])
            mockPrisma.docRecognitionRecords.findMany.mockResolvedValue([
                { ossFileId: 100, markdownContent: '文档Markdown' },
            ])
            mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([])
            mockPrisma.asrRecords.findMany.mockResolvedValue([])

            const materials = [
                { id: 1, type: CaseMaterialType.DOCUMENT, ossFileId: 100 },
            ]

            const contentMap = await fetchMaterialContents(materials)

            expect(contentMap.get(1)).toBe('文档Markdown')
        })

        it('获取图片材料内容', async () => {
            mockPrisma.textContentRecords.findMany.mockResolvedValue([])
            mockPrisma.docRecognitionRecords.findMany.mockResolvedValue([])
            mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([
                { ossFileId: 200, markdownContent: '图片识别' },
            ])
            mockPrisma.asrRecords.findMany.mockResolvedValue([])

            const materials = [
                { id: 2, type: CaseMaterialType.IMAGE, ossFileId: 200 },
            ]

            const contentMap = await fetchMaterialContents(materials)

            expect(contentMap.get(2)).toBe('图片识别')
        })

        it('获取音频材料内容（优先 summary）', async () => {
            mockPrisma.textContentRecords.findMany.mockResolvedValue([])
            mockPrisma.docRecognitionRecords.findMany.mockResolvedValue([])
            mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([])
            mockPrisma.asrRecords.findMany.mockResolvedValue([
                { ossFileId: 300, summary: '音频摘要', result: null },
            ])

            const materials = [
                { id: 3, type: CaseMaterialType.AUDIO, ossFileId: 300 },
            ]

            const contentMap = await fetchMaterialContents(materials)

            expect(contentMap.get(3)).toBe('音频摘要')
        })

        it('获取音频材料内容（fallback 到 result）', async () => {
            mockPrisma.textContentRecords.findMany.mockResolvedValue([])
            mockPrisma.docRecognitionRecords.findMany.mockResolvedValue([])
            mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([])
            mockPrisma.asrRecords.findMany.mockResolvedValue([
                { ossFileId: 300, summary: null, result: { sentences: [{ text: '转录文本' }] } },
            ])

            const materials = [
                { id: 3, type: CaseMaterialType.AUDIO, ossFileId: 300 },
            ]

            const contentMap = await fetchMaterialContents(materials)

            expect(contentMap.get(3)).toBe('转录文本')
        })

        it('空材料列表返回空 Map', async () => {
            const contentMap = await fetchMaterialContents([])
            expect(contentMap.size).toBe(0)
        })

        it('重复 ossFileId 的文档记录只取第一条', async () => {
            mockPrisma.textContentRecords.findMany.mockResolvedValue([])
            mockPrisma.docRecognitionRecords.findMany.mockResolvedValue([
                { ossFileId: 100, markdownContent: '第一版' },
                { ossFileId: 100, markdownContent: '第二版' },
            ])

            const materials = [
                { id: 1, type: CaseMaterialType.DOCUMENT, ossFileId: 100 },
            ]

            const contentMap = await fetchMaterialContents(materials)

            // orderBy createdAt desc，第一条是最新的
            expect(contentMap.get(1)).toBe('第一版')
        })
    })

    // ==================== getMaterialContextService ====================

    describe('getMaterialContextService', () => {
        it('空材料返回 empty 模式', async () => {
            const result = await getMaterialContextService([])

            expect(result.mode).toBe('empty')
            expect(result.totalTokens).toBe(0)
        })

        it('全部有内容且在预算内返回 full 模式', async () => {
            mockPrisma.textContentRecords.findMany.mockResolvedValue([
                { materialId: 1, content: '短内容' },
            ])

            const materials = [
                makeMaterial({ id: 1, type: CaseMaterialType.CASE_CONTENT, name: '描述' }),
            ]

            const result = await getMaterialContextService(materials, 100000)

            expect(result.mode).toBe('full')
            expect(result.materialList).toHaveLength(1)
            expect(result.materialList[0].mode).toBe('full')
        })

        it('无内容时标记为 summary 模式', async () => {
            mockPrisma.textContentRecords.findMany.mockResolvedValue([])

            const materials = [
                makeMaterial({ id: 1, type: CaseMaterialType.CASE_CONTENT, name: '空材料' }),
            ]

            const result = await getMaterialContextService(materials)

            expect(result.mode).toBe('summary')
            expect(result.materialList[0].hasContent).toBe(false)
            expect(result.materialList[0].summary).toContain('暂无内容')
        })
    })

    // ==================== buildMaterialContextMessage ====================

    describe('buildMaterialContextMessage', () => {
        it('empty 模式返回空字符串', () => {
            const result = buildMaterialContextMessage({
                mode: 'empty',
                totalTokens: 0,
                materialList: [],
            })

            expect(result).toBe('')
        })

        it('包含统计信息和材料内容', () => {
            const result = buildMaterialContextMessage({
                mode: 'full',
                totalTokens: 100,
                materialList: [
                    {
                        sourceId: 1,
                        name: '测试材料',
                        type: 1,
                        hasContent: true,
                        mode: 'full',
                        content: '材料全文',
                    },
                ],
            })

            expect(result).toContain('材料内容')
            expect(result).toContain('1 份全文')
            expect(result).toContain('材料全文')
        })

        it('摘要材料包含摘要文本', () => {
            const result = buildMaterialContextMessage({
                mode: 'summary',
                totalTokens: 0,
                materialList: [
                    {
                        sourceId: 2,
                        name: '摘要材料',
                        type: 2,
                        hasContent: true,
                        mode: 'summary',
                        summary: '这是摘要',
                    },
                ],
            })

            expect(result).toContain('摘要')
            expect(result).toContain('这是摘要')
        })
    })

    // ==================== buildIncrementalMaterialMessage ====================

    describe('buildIncrementalMaterialMessage', () => {
        it('empty 模式返回空字符串', () => {
            const result = buildIncrementalMaterialMessage({
                mode: 'empty',
                totalTokens: 0,
                materialList: [],
            })

            expect(result).toBe('')
        })

        it('包含"新增"提示', () => {
            const result = buildIncrementalMaterialMessage({
                mode: 'full',
                totalTokens: 100,
                materialList: [
                    {
                        sourceId: 1,
                        name: '新材料',
                        type: 1,
                        hasContent: true,
                        mode: 'full',
                        content: '新材料内容',
                    },
                ],
            })

            expect(result).toContain('新增')
        })
    })

    // ==================== searchMaterialsService ====================

    describe('searchMaterialsService', () => {
        it('无 query 时返回完整内容（精确查询）', async () => {
            mockGetMaterialsByCaseIdService.mockResolvedValue([
                makeMaterial({ id: 1, type: CaseMaterialType.CASE_CONTENT, name: '描述' }),
            ])
            mockPrisma.textContentRecords.findMany.mockResolvedValue([
                { materialId: 1, content: '材料全文内容' },
            ])

            const results = await searchMaterialsService(1, 1, {})

            expect(results).toHaveLength(1)
            expect(results[0].content).toBe('材料全文内容')
            expect(results[0].source.sourceName).toBe('描述')
        })

        it('无 query + 指定 sourceId 时只返回匹配材料', async () => {
            mockGetMaterialsByCaseIdService.mockResolvedValue([
                makeMaterial({ id: 1, type: CaseMaterialType.CASE_CONTENT, name: '材料1' }),
                makeMaterial({ id: 2, type: CaseMaterialType.CASE_CONTENT, name: '材料2' }),
            ])
            mockPrisma.textContentRecords.findMany.mockResolvedValue([
                { materialId: 1, content: '内容1' },
            ])

            const results = await searchMaterialsService(1, 1, { sourceId: 1 })

            expect(results).toHaveLength(1)
        })

        it('有 query 时走检索路由器', async () => {
            mockGetMaterialsByCaseIdService.mockResolvedValue([
                makeMaterial({ id: 1, type: CaseMaterialType.DOCUMENT, name: 'doc', ossFileId: 100 }),
            ])
            mockRetrievalRouterService.mockResolvedValue([
                {
                    content: '检索到的内容',
                    score: 0.9,
                    metadata: { sourceId: '100', sourceName: 'doc', chunkIndex: 0 },
                },
            ])

            const results = await searchMaterialsService(1, 1, { query: '关键词' })

            expect(results).toHaveLength(1)
            expect(results[0].content).toBe('检索到的内容')
            expect(results[0].relevanceScore).toBe(0.9)
            expect(mockRetrievalRouterService).toHaveBeenCalledWith(
                expect.objectContaining({
                    query: '关键词',
                    type: 'case_material',
                }),
            )
        })

        it('目标材料为空时返回空数组', async () => {
            mockGetMaterialsByCaseIdService.mockResolvedValue([])

            const results = await searchMaterialsService(1, 1, { query: '查询' })

            expect(results).toEqual([])
        })

        it('无内容的材料显示[暂无内容]', async () => {
            mockGetMaterialsByCaseIdService.mockResolvedValue([
                makeMaterial({ id: 1, type: CaseMaterialType.CASE_CONTENT, name: '空材料' }),
            ])
            mockPrisma.textContentRecords.findMany.mockResolvedValue([])

            const results = await searchMaterialsService(1, 1, {})

            expect(results[0].content).toBe('[暂无内容]')
        })
    })

    // ==================== 常量和工具函数 ====================

    describe('MATERIAL_PRIORITY 常量', () => {
        it('CASE_CONTENT 优先级最高', () => {
            expect(MATERIAL_PRIORITY[1]).toBeGreaterThan(MATERIAL_PRIORITY[2]!)
            expect(MATERIAL_PRIORITY[2]).toBeGreaterThan(MATERIAL_PRIORITY[3]!)
            expect(MATERIAL_PRIORITY[3]).toBeGreaterThan(MATERIAL_PRIORITY[4]!)
        })
    })

    describe('TOKEN_THRESHOLD 常量', () => {
        it('默认阈值大于 0 且为合理预算', () => {
            // 业务方按模型上下文预算调整（当前 15000，给 system prompt 留余量）
            expect(TOKEN_THRESHOLD).toBeGreaterThan(0)
            expect(TOKEN_THRESHOLD).toBeLessThanOrEqual(200000)
        })
    })

    describe('estimateTokens', () => {
        it('空字符串返回 0', () => {
            expect(estimateTokens('')).toBe(0)
        })

        it('非空字符串返回正整数 token 数', () => {
            // 业务方改用 tiktoken (cl100k_base)，token 数依赖 BPE 词表，不再是固定字符比
            const tokens = estimateTokens('中文内容测试')
            expect(tokens).toBeGreaterThan(0)
            expect(Number.isInteger(tokens)).toBe(true)
        })

        it('英文字符串返回正整数 token 数', () => {
            const tokens = estimateTokens('hello world')
            expect(tokens).toBeGreaterThan(0)
            expect(Number.isInteger(tokens)).toBe(true)
        })
    })

    describe('getSourceId', () => {
        it('音频材料返回 ossFileId', () => {
            const m = makeMaterial({ id: 10, type: CaseMaterialType.AUDIO, name: 'audio', ossFileId: 400 })
            expect(getSourceId(m)).toBe(400)
        })

        it('图片材料返回 ossFileId', () => {
            const m = makeMaterial({ id: 10, type: CaseMaterialType.IMAGE, name: 'img', ossFileId: 300 })
            expect(getSourceId(m)).toBe(300)
        })
    })
})
