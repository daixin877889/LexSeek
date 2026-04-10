/**
 * 材料向量化服务测试
 *
 * Mock 向量存储和数据库调用，测试各类嵌入、检索、删除逻辑
 *
 * **Feature: material-embedding-coverage**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Document } from '@langchain/core/documents'

// Mock Nuxt 自动导入
vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

vi.stubGlobal('prisma', {
    caseMaterials: { findFirst: vi.fn(), findMany: vi.fn() },
    docRecognitionRecords: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    imageRecognitionRecords: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    asrRecords: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    textContentRecords: { findMany: vi.fn() },
})

// Mock vector store service
const mockPoolQuery = vi.fn()
const mockAddDocuments = vi.fn().mockResolvedValue(undefined)
const mockSimilaritySearch = vi.fn().mockResolvedValue([])

vi.mock('~~/server/services/legal/vectorStore.service', () => ({
    addDocumentsToVectorStore: (...args: any[]) => mockAddDocuments(...args),
    similaritySearchWithScore: (...args: any[]) => mockSimilaritySearch(...args),
    getPool: () => ({ query: mockPoolQuery }),
}))

import {
    deleteMaterialEmbeddings,
    deleteCaseMaterialEmbeddings,
    searchCaseMaterialsService,
    getMaterialEmbeddingIds,
    getCaseMaterialEmbeddingStats,
    isMaterialEmbedded,
    embedTextService,
    isTextEmbedded,
    getTextEmbeddingIds,
    deleteContentEmbeddings,
    embedDocumentService,
    isDocumentEmbedded,
    getDocumentEmbeddingIds,
    searchUserDocumentsService,
    embedImageService,
    isImageEmbedded,
    embedAudioService,
    isAudioEmbedded,
    searchUserImagesService,
    searchUserAudiosService,
    formatAsrResultForEmbedding,
    embedMaterialUnifiedService,
    batchCheckMaterialEmbeddedService,
    isMaterialEmbeddedService,
} from '~~/server/services/material/materialEmbedding.service'

describe('材料向量化服务测试', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('deleteMaterialEmbeddings - 删除材料嵌入', () => {
        it('返回删除的记录数', async () => {
            mockPoolQuery.mockResolvedValue({ rowCount: 5 })

            const count = await deleteMaterialEmbeddings(123)

            expect(count).toBe(5)
            expect(mockPoolQuery).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM'),
                ['123'],
            )
        })

        it('没有记录时返回 0', async () => {
            mockPoolQuery.mockResolvedValue({ rowCount: 0 })

            const count = await deleteMaterialEmbeddings(999)

            expect(count).toBe(0)
        })
    })

    describe('deleteCaseMaterialEmbeddings - 删除案件材料嵌入', () => {
        it('返回删除的记录数', async () => {
            mockPoolQuery.mockResolvedValue({ rowCount: 10 })

            const count = await deleteCaseMaterialEmbeddings(1)

            expect(count).toBe(10)
        })
    })

    describe('searchCaseMaterialsService - 检索案件材料', () => {
        it('返回格式化的检索结果', async () => {
            mockSimilaritySearch.mockResolvedValue([
                [
                    new Document({
                        pageContent: '合同第一条',
                        metadata: { sourceId: 1, sourceName: '合同.pdf', chunkIndex: 0 },
                    }),
                    0.95,
                ],
            ])

            const results = await searchCaseMaterialsService(1, 1, '合同条款')

            expect(results).toHaveLength(1)
            expect(results[0].content).toBe('合同第一条')
            expect(results[0].sourceId).toBe(1)
            expect(results[0].score).toBe(0.95)
        })

        it('支持 sourceIds 过滤', async () => {
            mockSimilaritySearch.mockResolvedValue([])

            await searchCaseMaterialsService(1, 1, '查询', 5, [10, 20])

            expect(mockSimilaritySearch).toHaveBeenCalledWith(
                '查询',
                5,
                expect.objectContaining({
                    userId: 1,
                    sourceId: { in: ['10', '20'] },
                }),
                expect.anything(),
            )
        })

        it('检索失败时抛出错误', async () => {
            mockSimilaritySearch.mockRejectedValue(new Error('向量检索失败'))

            await expect(
                searchCaseMaterialsService(1, 1, '查询')
            ).rejects.toThrow('向量检索失败')
        })
    })

    describe('getMaterialEmbeddingIds - 获取材料向量 ID', () => {
        it('返回按 chunkIndex 排序的 ID 列表', async () => {
            mockPoolQuery.mockResolvedValue({
                rows: [{ id: 'uuid-1' }, { id: 'uuid-2' }],
            })

            const ids = await getMaterialEmbeddingIds(1)

            expect(ids).toEqual(['uuid-1', 'uuid-2'])
        })
    })

    describe('getCaseMaterialEmbeddingStats - 获取案件向量统计', () => {
        it('返回统计信息', async () => {
            mockPoolQuery.mockResolvedValueOnce({
                rows: [{ total: '15' }],
            }).mockResolvedValueOnce({
                rows: [
                    { material_id: '1', material_name: '文件A', chunk_count: '10' },
                    { material_id: '2', material_name: '文件B', chunk_count: '5' },
                ],
            })

            const stats = await getCaseMaterialEmbeddingStats(1)

            expect(stats.totalChunks).toBe(15)
            expect(stats.materialCount).toBe(2)
            expect(stats.materials).toHaveLength(2)
            expect(stats.materials[0].materialId).toBe(1)
        })
    })

    describe('isMaterialEmbedded - 检查材料是否已向量化', () => {
        it('已向量化时返回 true', async () => {
            mockPoolQuery.mockResolvedValue({ rows: [{ exists: true }] })

            const result = await isMaterialEmbedded(1)

            expect(result).toBe(true)
        })

        it('未向量化时返回 false', async () => {
            mockPoolQuery.mockResolvedValue({ rows: [{ exists: false }] })

            const result = await isMaterialEmbedded(999)

            expect(result).toBe(false)
        })
    })

    describe('embedTextService - 向量化文本材料', () => {
        it('成功向量化文本', async () => {
            mockPoolQuery.mockResolvedValue({ rowCount: 0 })

            const result = await embedTextService({
                content: '这是一段案件描述内容，用于测试文本向量化功能。',
                userId: 1,
                materialId: 100,
                materialName: '案件描述',
            })

            expect(result.chunkCount).toBeGreaterThan(0)
            expect(result.ids).toHaveLength(result.chunkCount)
            expect(result.lastEmbeddingAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
            expect(mockAddDocuments).toHaveBeenCalled()
        })

        it('空内容时跳过向量化', async () => {
            mockPoolQuery.mockResolvedValue({ rowCount: 0 })

            const result = await embedTextService({
                content: '',
                userId: 1,
                materialId: 100,
                materialName: '空内容',
            })

            expect(result.chunkCount).toBe(0)
            expect(result.ids).toHaveLength(0)
        })
    })

    describe('isTextEmbedded - 检查文本是否已向量化', () => {
        it('已向量化时返回 true', async () => {
            mockPoolQuery.mockResolvedValue({ rows: [{ exists: true }] })

            expect(await isTextEmbedded(1)).toBe(true)
        })
    })

    describe('deleteContentEmbeddings - 删除内容嵌入', () => {
        it('返回删除数量', async () => {
            mockPoolQuery.mockResolvedValue({ rowCount: 3 })

            const count = await deleteContentEmbeddings('doc', 1)

            expect(count).toBe(3)
        })
    })

    describe('embedDocumentService - 向量化文档', () => {
        it('成功向量化文档', async () => {
            mockPoolQuery.mockResolvedValue({ rowCount: 0 })

            const result = await embedDocumentService({
                content: '# 合同\n\n第一条：...',
                userId: 1,
                ossFileId: 200,
                fileName: '合同.pdf',
            })

            expect(result.chunkCount).toBeGreaterThan(0)
            expect(mockAddDocuments).toHaveBeenCalled()
        })

        it('空文档跳过向量化', async () => {
            mockPoolQuery.mockResolvedValue({ rowCount: 0 })

            const result = await embedDocumentService({
                content: '',
                userId: 1,
                ossFileId: 200,
                fileName: '空文档.pdf',
            })

            expect(result.chunkCount).toBe(0)
        })

        it('向量化失败时抛出错误', async () => {
            mockPoolQuery.mockResolvedValue({ rowCount: 0 })
            mockAddDocuments.mockRejectedValueOnce(new Error('嵌入失败'))

            await expect(
                embedDocumentService({
                    content: '有内容的文档',
                    userId: 1,
                    ossFileId: 200,
                    fileName: 'test.pdf',
                })
            ).rejects.toThrow('嵌入失败')
        })
    })

    describe('isDocumentEmbedded / getDocumentEmbeddingIds', () => {
        it('isDocumentEmbedded 返回布尔值', async () => {
            mockPoolQuery.mockResolvedValue({ rows: [{ exists: false }] })

            expect(await isDocumentEmbedded(1)).toBe(false)
        })

        it('getDocumentEmbeddingIds 返回 ID 列表', async () => {
            mockPoolQuery.mockResolvedValue({ rows: [{ id: 'a' }, { id: 'b' }] })

            const ids = await getDocumentEmbeddingIds(1)

            expect(ids).toEqual(['a', 'b'])
        })
    })

    describe('searchUserDocumentsService - 检索用户文档', () => {
        it('返回检索结果', async () => {
            mockSimilaritySearch.mockResolvedValue([
                [
                    new Document({
                        pageContent: '文档片段',
                        metadata: { sourceId: 1, chunkIndex: 0 },
                    }),
                    0.88,
                ],
            ])

            const results = await searchUserDocumentsService(1, '查询')

            expect(results).toHaveLength(1)
            expect(results[0].content).toBe('文档片段')
            expect(results[0].score).toBe(0.88)
        })
    })

    describe('embedImageService - 向量化图像', () => {
        it('成功向量化图像内容', async () => {
            mockPoolQuery.mockResolvedValue({ rowCount: 0 })

            const result = await embedImageService({
                content: '图像中的文字内容',
                userId: 1,
                ossFileId: 300,
                fileName: '证据.jpg',
            })

            expect(result.chunkCount).toBeGreaterThan(0)
        })

        it('空图像内容跳过向量化', async () => {
            mockPoolQuery.mockResolvedValue({ rowCount: 0 })

            const result = await embedImageService({
                content: '',
                userId: 1,
                ossFileId: 300,
                fileName: 'empty.jpg',
            })

            expect(result.chunkCount).toBe(0)
        })
    })

    describe('embedAudioService - 向量化音频', () => {
        it('成功向量化音频内容', async () => {
            mockPoolQuery.mockResolvedValue({ rowCount: 0 })

            const result = await embedAudioService({
                content: '[00:00-00:10]说话人1：这是一段录音内容',
                userId: 1,
                ossFileId: 400,
                fileName: '录音.mp3',
            })

            expect(result.chunkCount).toBeGreaterThan(0)
        })
    })

    describe('formatAsrResultForEmbedding - ASR 格式化', () => {
        it('格式化标准 ASR 结果', () => {
            const sentences = [
                { text: '你好', begin_time: 0, end_time: 3000, speaker_id: 0 },
                { text: '你好啊', begin_time: 3000, end_time: 6000, speaker_id: 1 },
            ]
            const speakers = [
                { id: 0, name: '张三' },
                { id: 1, name: '李四' },
            ]

            const result = formatAsrResultForEmbedding(sentences, speakers)

            expect(result).toContain('[00:00-00:03]张三：你好')
            expect(result).toContain('[00:03-00:06]李四：你好啊')
        })

        it('无说话人信息时使用默认名称', () => {
            const sentences = [
                { text: '测试', begin_time: 0, end_time: 1000, speaker_id: 0 },
            ]

            const result = formatAsrResultForEmbedding(sentences)

            expect(result).toContain('说话人1：测试')
        })

        it('空 sentences 返回空字符串', () => {
            expect(formatAsrResultForEmbedding([])).toBe('')
            expect(formatAsrResultForEmbedding(null as any)).toBe('')
        })

        it('按开始时间排序', () => {
            const sentences = [
                { text: '后面', begin_time: 5000, end_time: 8000, speaker_id: 0 },
                { text: '前面', begin_time: 0, end_time: 3000, speaker_id: 0 },
            ]

            const result = formatAsrResultForEmbedding(sentences)
            const lines = result.split('\n')

            expect(lines[0]).toContain('前面')
            expect(lines[1]).toContain('后面')
        })
    })

    describe('searchUserImagesService - 检索用户图像', () => {
        it('返回检索结果', async () => {
            mockSimilaritySearch.mockResolvedValue([
                [new Document({ pageContent: '图像内容', metadata: { sourceId: 1, chunkIndex: 0 } }), 0.9],
            ])

            const results = await searchUserImagesService(1, '查询')

            expect(results).toHaveLength(1)
        })

        it('检索失败时抛出错误', async () => {
            mockSimilaritySearch.mockRejectedValue(new Error('检索失败'))

            await expect(searchUserImagesService(1, '查询')).rejects.toThrow('检索失败')
        })
    })

    describe('searchUserAudiosService - 检索用户音频', () => {
        it('返回检索结果', async () => {
            mockSimilaritySearch.mockResolvedValue([
                [new Document({ pageContent: '音频内容', metadata: { sourceId: 1, chunkIndex: 0 } }), 0.85],
            ])

            const results = await searchUserAudiosService(1, '查询')

            expect(results).toHaveLength(1)
        })
    })

    describe('isAudioEmbedded / isImageEmbedded', () => {
        it('isAudioEmbedded', async () => {
            mockPoolQuery.mockResolvedValue({ rows: [{ exists: true }] })
            expect(await isAudioEmbedded(1)).toBe(true)
        })

        it('isImageEmbedded', async () => {
            mockPoolQuery.mockResolvedValue({ rows: [{ exists: false }] })
            expect(await isImageEmbedded(1)).toBe(false)
        })
    })

    describe('embedMaterialUnifiedService - 统一材料嵌入入口', () => {
        it('材料不存在时返回失败', async () => {
            ;(prisma.caseMaterials.findFirst as any).mockResolvedValue(null)

            const result = await embedMaterialUnifiedService(999, 1)

            expect(result.success).toBe(false)
            expect(result.error).toBe('材料不存在')
        })

        it('不支持的材料类型返回失败', async () => {
            ;(prisma.caseMaterials.findFirst as any).mockResolvedValue({ id: 1, type: 99 })

            const result = await embedMaterialUnifiedService(1, 1)

            expect(result.success).toBe(false)
            expect(result.error).toContain('不支持的材料类型')
        })

        it('文档材料缺少 ossFileId 返回失败', async () => {
            ;(prisma.caseMaterials.findFirst as any).mockResolvedValue({ id: 1, type: 2, ossFileId: null })

            const result = await embedMaterialUnifiedService(1, 1)

            expect(result.success).toBe(false)
            expect(result.error).toContain('缺少 ossFileId')
        })

        it('图片材料缺少 ossFileId 返回失败', async () => {
            ;(prisma.caseMaterials.findFirst as any).mockResolvedValue({ id: 1, type: 3, ossFileId: null })

            const result = await embedMaterialUnifiedService(1, 1)

            expect(result.success).toBe(false)
            expect(result.error).toContain('缺少 ossFileId')
        })

        it('音频材料缺少 ossFileId 返回失败', async () => {
            ;(prisma.caseMaterials.findFirst as any).mockResolvedValue({ id: 1, type: 4, ossFileId: null })

            const result = await embedMaterialUnifiedService(1, 1)

            expect(result.success).toBe(false)
            expect(result.error).toContain('缺少 ossFileId')
        })

        it('文档识别记录为空时返回失败', async () => {
            ;(prisma.caseMaterials.findFirst as any).mockResolvedValue({ id: 1, type: 2, ossFileId: 100 })
            ;(prisma.docRecognitionRecords.findFirst as any).mockResolvedValue(null)

            const result = await embedMaterialUnifiedService(1, 1)

            expect(result.success).toBe(false)
            expect(result.error).toContain('内容为空')
        })

        it('图片识别记录为空时返回失败', async () => {
            ;(prisma.caseMaterials.findFirst as any).mockResolvedValue({ id: 1, type: 3, ossFileId: 100 })
            ;(prisma.imageRecognitionRecords.findFirst as any).mockResolvedValue(null)

            const result = await embedMaterialUnifiedService(1, 1)

            expect(result.success).toBe(false)
        })

        it('音频识别记录为空时返回失败', async () => {
            ;(prisma.caseMaterials.findFirst as any).mockResolvedValue({ id: 1, type: 4, ossFileId: 100 })
            ;(prisma.asrRecords.findFirst as any).mockResolvedValue(null)

            const result = await embedMaterialUnifiedService(1, 1)

            expect(result.success).toBe(false)
        })

        it('文档材料成功嵌入', async () => {
            ;(prisma.caseMaterials.findFirst as any).mockResolvedValue({ id: 1, type: 2, ossFileId: 100, name: 'doc.pdf' })
            ;(prisma.docRecognitionRecords.findFirst as any).mockResolvedValue({ markdownContent: '文档内容' })
            ;(prisma.docRecognitionRecords.updateMany as any).mockResolvedValue({ count: 1 })
            mockPoolQuery.mockResolvedValue({ rowCount: 0 })

            const result = await embedMaterialUnifiedService(1, 1)

            expect(result.success).toBe(true)
            expect(result.chunkCount).toBeGreaterThanOrEqual(0)
        })
    })

    describe('batchCheckMaterialEmbeddedService - 批量检查嵌入状态', () => {
        it('空列表返回空 Map', async () => {
            const result = await batchCheckMaterialEmbeddedService([])

            expect(result.size).toBe(0)
        })

        it('正确检查各类型材料', async () => {
            ;(prisma.caseMaterials.findMany as any).mockResolvedValue([
                { id: 1, type: 1, ossFileId: null }, // 文本
                { id: 2, type: 2, ossFileId: 100 }, // 文档
            ])
            ;(prisma.textContentRecords.findMany as any).mockResolvedValue([
                { materialId: 1, lastEmbeddingAt: new Date() },
            ])
            ;(prisma.docRecognitionRecords.findMany as any).mockResolvedValue([
                { ossFileId: 100, lastEmbeddingAt: new Date() },
            ])

            const result = await batchCheckMaterialEmbeddedService([1, 2])

            expect(result.get(1)).toBe(true)
            expect(result.get(2)).toBe(true)
        })
    })

    describe('isMaterialEmbeddedService - 单个材料嵌入状态', () => {
        it('调用 batchCheck 并返回结果', async () => {
            ;(prisma.caseMaterials.findMany as any).mockResolvedValue([
                { id: 1, type: 1, ossFileId: null },
            ])
            ;(prisma.textContentRecords.findMany as any).mockResolvedValue([])

            const result = await isMaterialEmbeddedService(1)

            expect(result).toBe(false)
        })
    })
})
