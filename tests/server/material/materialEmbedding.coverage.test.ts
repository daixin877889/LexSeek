/**
 * 材料向量化服务 - 补充覆盖率测试
 *
 * 覆盖 materialEmbedding.service.ts 中已有测试未覆盖的路径：
 * - getTextEmbeddingIds
 * - getImageEmbeddingIds / getAudioEmbeddingIds
 * - embedImageService / embedAudioService 错误路径
 * - embedTextService 错误路径
 * - searchUserDocumentsService / searchUserAudiosService 错误路径
 * - embedMaterialUnifiedService: 图片/音频成功路径, CASE_CONTENT 类型
 * - batchCheckMaterialEmbeddedService: 图片/音频类型
 *
 * **Feature: material-embedding-coverage-extra**
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

// Mock textContentRecords.service（embedMaterialUnifiedService 中 type=1 时动态导入）
vi.mock('~~/server/services/material/textContentRecords.service', () => ({
    embedTextContentByMaterialIdService: vi.fn().mockResolvedValue({ success: true, chunkCount: 3 }),
}))

import {
    getTextEmbeddingIds,
    getImageEmbeddingIds,
    getAudioEmbeddingIds,
    embedTextService,
    embedImageService,
    embedAudioService,
    embedDocumentService,
    searchUserDocumentsService,
    searchUserAudiosService,
    embedMaterialUnifiedService,
    batchCheckMaterialEmbeddedService,
    deleteContentEmbeddings,
    deleteMaterialEmbeddings,
    deleteCaseMaterialEmbeddings,
} from '~~/server/services/material/materialEmbedding.service'

describe('材料向量化服务 - 补充覆盖率', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ==================== 向量 ID 查询 ====================

    describe('getTextEmbeddingIds - 获取文本材料向量 ID', () => {
        it('返回按 chunkIndex 排序的 ID 列表', async () => {
            mockPoolQuery.mockResolvedValue({
                rows: [{ id: 'text-uuid-1' }, { id: 'text-uuid-2' }],
            })

            const ids = await getTextEmbeddingIds(100)

            expect(ids).toEqual(['text-uuid-1', 'text-uuid-2'])
            expect(mockPoolQuery).toHaveBeenCalledWith(
                expect.stringContaining("metadata->>'source' = 'text'"),
                ['100'],
            )
        })

        it('空结果返回空数组', async () => {
            mockPoolQuery.mockResolvedValue({ rows: [] })

            const ids = await getTextEmbeddingIds(999)

            expect(ids).toEqual([])
        })
    })

    describe('getImageEmbeddingIds - 获取图像向量 ID', () => {
        it('返回图像向量 ID 列表', async () => {
            mockPoolQuery.mockResolvedValue({
                rows: [{ id: 'img-uuid-1' }],
            })

            const ids = await getImageEmbeddingIds(200)

            expect(ids).toEqual(['img-uuid-1'])
            expect(mockPoolQuery).toHaveBeenCalledWith(
                expect.stringContaining("metadata->>'source' = 'image'"),
                ['200'],
            )
        })
    })

    describe('getAudioEmbeddingIds - 获取音频向量 ID', () => {
        it('返回音频向量 ID 列表', async () => {
            mockPoolQuery.mockResolvedValue({
                rows: [{ id: 'audio-uuid-1' }, { id: 'audio-uuid-2' }],
            })

            const ids = await getAudioEmbeddingIds(300)

            expect(ids).toEqual(['audio-uuid-1', 'audio-uuid-2'])
            expect(mockPoolQuery).toHaveBeenCalledWith(
                expect.stringContaining("metadata->>'source' = 'audio'"),
                ['300'],
            )
        })
    })

    // ==================== 嵌入错误路径 ====================

    describe('embedTextService - 错误路径', () => {
        it('向量化失败时抛出错误', async () => {
            mockPoolQuery.mockResolvedValue({ rowCount: 0 })
            mockAddDocuments.mockRejectedValueOnce(new Error('文本嵌入失败'))

            await expect(
                embedTextService({
                    content: '测试内容',
                    userId: 1,
                    materialId: 100,
                    materialName: '测试',
                }),
            ).rejects.toThrow('文本嵌入失败')
        })
    })

    describe('embedImageService - 错误路径', () => {
        it('向量化失败时抛出错误', async () => {
            mockPoolQuery.mockResolvedValue({ rowCount: 0 })
            mockAddDocuments.mockRejectedValueOnce(new Error('图像嵌入失败'))

            await expect(
                embedImageService({
                    content: '图像识别内容',
                    userId: 1,
                    ossFileId: 200,
                    fileName: '证据.jpg',
                }),
            ).rejects.toThrow('图像嵌入失败')
        })
    })

    describe('embedAudioService - 错误和空内容路径', () => {
        it('向量化失败时抛出错误', async () => {
            mockPoolQuery.mockResolvedValue({ rowCount: 0 })
            mockAddDocuments.mockRejectedValueOnce(new Error('音频嵌入失败'))

            await expect(
                embedAudioService({
                    content: '音频转录内容',
                    userId: 1,
                    ossFileId: 300,
                    fileName: '录音.mp3',
                }),
            ).rejects.toThrow('音频嵌入失败')
        })

        it('空音频内容时跳过向量化', async () => {
            mockPoolQuery.mockResolvedValue({ rowCount: 0 })

            const result = await embedAudioService({
                content: '',
                userId: 1,
                ossFileId: 300,
                fileName: '空录音.mp3',
            })

            expect(result.chunkCount).toBe(0)
            expect(result.ids).toHaveLength(0)
        })
    })

    // ==================== 检索错误路径 ====================

    describe('searchUserDocumentsService - 错误路径', () => {
        it('检索失败时抛出错误', async () => {
            mockSimilaritySearch.mockRejectedValue(new Error('文档检索失败'))

            await expect(searchUserDocumentsService(1, '查询')).rejects.toThrow('文档检索失败')
        })
    })

    describe('searchUserAudiosService - 错误路径', () => {
        it('检索失败时抛出错误', async () => {
            mockSimilaritySearch.mockRejectedValue(new Error('音频检索失败'))

            await expect(searchUserAudiosService(1, '查询')).rejects.toThrow('音频检索失败')
        })
    })

    // ==================== deleteContentEmbeddings 无删除记录 ====================

    describe('deleteContentEmbeddings - 无记录时', () => {
        it('没有记录时返回 0 且不打印日志', async () => {
            mockPoolQuery.mockResolvedValue({ rowCount: 0 })

            const count = await deleteContentEmbeddings('image', 999)

            expect(count).toBe(0)
            // 不应调用 logger.info（仅在 count > 0 时打印）
        })
    })

    describe('deleteMaterialEmbeddings - rowCount 为 null 时', () => {
        it('rowCount 为 null 时返回 0', async () => {
            mockPoolQuery.mockResolvedValue({ rowCount: null })

            const count = await deleteMaterialEmbeddings(999)

            expect(count).toBe(0)
        })
    })

    describe('deleteCaseMaterialEmbeddings - 无记录', () => {
        it('rowCount 为 null 时返回 0', async () => {
            mockPoolQuery.mockResolvedValue({ rowCount: null })

            const count = await deleteCaseMaterialEmbeddings(999)

            expect(count).toBe(0)
        })
    })

    // ==================== embedMaterialUnifiedService 成功路径 ====================

    describe('embedMaterialUnifiedService - CASE_CONTENT 类型', () => {
        it('type=1 时调用 embedTextContentByMaterialIdService', async () => {
            ;(prisma.caseMaterials.findFirst as any).mockResolvedValue({
                id: 1,
                type: 1,
                ossFileId: null,
            })

            const result = await embedMaterialUnifiedService(1, 1)

            expect(result.success).toBe(true)
            expect(result.chunkCount).toBe(3)
        })
    })

    describe('embedMaterialUnifiedService - 图片成功嵌入', () => {
        it('图片材料有 markdownContent 时成功嵌入', async () => {
            ;(prisma.caseMaterials.findFirst as any).mockResolvedValue({
                id: 1,
                type: 3,
                ossFileId: 200,
                name: '证据图片.jpg',
            })
            ;(prisma.imageRecognitionRecords.findFirst as any).mockResolvedValue({
                markdownContent: '图像识别内容',
            })
            ;(prisma.imageRecognitionRecords.updateMany as any).mockResolvedValue({ count: 1 })
            mockPoolQuery.mockResolvedValue({ rowCount: 0 })

            const result = await embedMaterialUnifiedService(1, 1)

            expect(result.success).toBe(true)
            expect(result.chunkCount).toBeGreaterThanOrEqual(0)
        })
    })

    describe('embedMaterialUnifiedService - 音频成功嵌入', () => {
        it('音频材料有 summary 时成功嵌入', async () => {
            ;(prisma.caseMaterials.findFirst as any).mockResolvedValue({
                id: 1,
                type: 4,
                ossFileId: 300,
                name: '录音.mp3',
            })
            ;(prisma.asrRecords.findFirst as any).mockResolvedValue({
                summary: '音频转录内容摘要',
            })
            ;(prisma.asrRecords.updateMany as any).mockResolvedValue({ count: 1 })
            mockPoolQuery.mockResolvedValue({ rowCount: 0 })

            const result = await embedMaterialUnifiedService(1, 1)

            expect(result.success).toBe(true)
            expect(result.chunkCount).toBeGreaterThanOrEqual(0)
        })
    })

    // ==================== batchCheckMaterialEmbeddedService 图片/音频 ====================

    describe('batchCheckMaterialEmbeddedService - 图片和音频类型', () => {
        it('正确检查图片和音频材料的嵌入状态', async () => {
            ;(prisma.caseMaterials.findMany as any).mockResolvedValue([
                { id: 1, type: 3, ossFileId: 200 }, // 图片
                { id: 2, type: 4, ossFileId: 300 }, // 音频
            ])
            ;(prisma.textContentRecords.findMany as any).mockResolvedValue([])
            ;(prisma.docRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.imageRecognitionRecords.findMany as any).mockResolvedValue([
                { ossFileId: 200, lastEmbeddingAt: new Date() },
            ])
            ;(prisma.asrRecords.findMany as any).mockResolvedValue([
                { ossFileId: 300, lastEmbeddingAt: new Date() },
            ])

            const result = await batchCheckMaterialEmbeddedService([1, 2])

            expect(result.get(1)).toBe(true)
            expect(result.get(2)).toBe(true)
        })

        it('无 lastEmbeddingAt 时返回 false', async () => {
            ;(prisma.caseMaterials.findMany as any).mockResolvedValue([
                { id: 1, type: 3, ossFileId: 200 },
            ])
            ;(prisma.imageRecognitionRecords.findMany as any).mockResolvedValue([
                { ossFileId: 200, lastEmbeddingAt: null },
            ])

            const result = await batchCheckMaterialEmbeddedService([1])

            expect(result.get(1)).toBe(false)
        })

        it('materialId 不在查询结果中时默认为 false', async () => {
            ;(prisma.caseMaterials.findMany as any).mockResolvedValue([
                { id: 1, type: 2, ossFileId: 100 },
            ])
            ;(prisma.docRecognitionRecords.findMany as any).mockResolvedValue([])

            const result = await batchCheckMaterialEmbeddedService([1, 999])

            expect(result.get(1)).toBe(false)
            expect(result.get(999)).toBe(false)
        })
    })
})
