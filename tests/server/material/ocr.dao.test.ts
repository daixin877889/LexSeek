/**
 * 图片识别记录 DAO 层测试
 *
 * **Feature: ocr-dao**
 * **Validates: Requirements 3.3.1-3.3.11**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ImageRecognitionStatus, ImageType } from '#shared/types/recognition'

// Mock prisma
const mockPrisma = {
    imageRecognitionRecords: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
    },
}
vi.stubGlobal('prisma', mockPrisma)
vi.stubGlobal('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
vi.stubGlobal('ImageRecognitionStatus', ImageRecognitionStatus)
vi.stubGlobal('ImageType', ImageType)

import {
    createImageRecognitionRecordDao,
    findImageRecognitionByOssFileIdDao,
    findImageRecognitionByIdDao,
    updateImageRecognitionRecordDao,
    findImageRecognitionsByOssFileIdsDao,
    deleteImageRecognitionRecordDao,
} from '~~/server/services/material/ocr.dao'

const baseMockRecord = {
    id: 1,
    userId: 1,
    ossFileId: 100,
    status: ImageRecognitionStatus.PENDING,
    imageType: null,
    htmlContent: null,
    markdownContent: null,
    keywords: null,
    summary: null,
    vectorIds: null,
    lastEmbeddingAt: null,
    lastEditAt: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
}

describe('图片识别记录 DAO 层', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ==================== createImageRecognitionRecordDao ====================
    describe('createImageRecognitionRecordDao', () => {
        it('应使用默认值创建记录', async () => {
            mockPrisma.imageRecognitionRecords.create.mockResolvedValue(baseMockRecord)

            const result = await createImageRecognitionRecordDao({
                userId: 1,
                ossFileId: 100,
            })

            expect(mockPrisma.imageRecognitionRecords.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    userId: 1,
                    ossFileId: 100,
                    status: ImageRecognitionStatus.PENDING,
                }),
            })
            expect(result).toEqual(baseMockRecord)
        })

        it('应使用自定义值创建记录', async () => {
            const customRecord = {
                ...baseMockRecord,
                status: ImageRecognitionStatus.COMPLETED,
                imageType: ImageType.DOC,
                htmlContent: '<p>hello</p>',
                markdownContent: 'hello',
            }
            mockPrisma.imageRecognitionRecords.create.mockResolvedValue(customRecord)

            const result = await createImageRecognitionRecordDao({
                userId: 1,
                ossFileId: 100,
                status: ImageRecognitionStatus.COMPLETED,
                imageType: ImageType.DOC,
                htmlContent: '<p>hello</p>',
                markdownContent: 'hello',
            })

            expect(result.status).toBe(ImageRecognitionStatus.COMPLETED)
            expect(result.imageType).toBe(ImageType.DOC)
        })

        it('应使用事务客户端', async () => {
            const mockTx = {
                imageRecognitionRecords: { create: vi.fn().mockResolvedValue(baseMockRecord) },
            }

            await createImageRecognitionRecordDao({ userId: 1, ossFileId: 100 }, mockTx as any)

            expect(mockTx.imageRecognitionRecords.create).toHaveBeenCalled()
            expect(mockPrisma.imageRecognitionRecords.create).not.toHaveBeenCalled()
        })

        it('创建失败时应抛出错误', async () => {
            mockPrisma.imageRecognitionRecords.create.mockRejectedValue(new Error('DB error'))
            await expect(
                createImageRecognitionRecordDao({ userId: 1, ossFileId: 100 }),
            ).rejects.toThrow('DB error')
        })
    })

    // ==================== findImageRecognitionByOssFileIdDao ====================
    describe('findImageRecognitionByOssFileIdDao', () => {
        it('应通过 ossFileId 查询记录', async () => {
            mockPrisma.imageRecognitionRecords.findFirst.mockResolvedValue(baseMockRecord)

            const result = await findImageRecognitionByOssFileIdDao(100)

            expect(mockPrisma.imageRecognitionRecords.findFirst).toHaveBeenCalledWith({
                where: { ossFileId: 100, deletedAt: null },
            })
            expect(result).toEqual(baseMockRecord)
        })

        it('记录不存在时应返回 null', async () => {
            mockPrisma.imageRecognitionRecords.findFirst.mockResolvedValue(null)
            expect(await findImageRecognitionByOssFileIdDao(999)).toBeNull()
        })
    })

    // ==================== findImageRecognitionByIdDao ====================
    describe('findImageRecognitionByIdDao', () => {
        it('应通过 ID 查询记录', async () => {
            mockPrisma.imageRecognitionRecords.findFirst.mockResolvedValue(baseMockRecord)

            const result = await findImageRecognitionByIdDao(1)

            expect(mockPrisma.imageRecognitionRecords.findFirst).toHaveBeenCalledWith({
                where: { id: 1, deletedAt: null },
            })
            expect(result).toEqual(baseMockRecord)
        })

        it('记录不存在时应返回 null', async () => {
            mockPrisma.imageRecognitionRecords.findFirst.mockResolvedValue(null)
            expect(await findImageRecognitionByIdDao(999)).toBeNull()
        })
    })

    // ==================== updateImageRecognitionRecordDao ====================
    describe('updateImageRecognitionRecordDao', () => {
        it('应更新记录', async () => {
            const updated = { ...baseMockRecord, status: ImageRecognitionStatus.COMPLETED }
            mockPrisma.imageRecognitionRecords.update.mockResolvedValue(updated)

            const result = await updateImageRecognitionRecordDao(1, {
                status: ImageRecognitionStatus.COMPLETED,
            })

            expect(mockPrisma.imageRecognitionRecords.update).toHaveBeenCalledWith({
                where: { id: 1 },
                data: expect.objectContaining({
                    status: ImageRecognitionStatus.COMPLETED,
                    updatedAt: expect.any(Date),
                }),
            })
            expect(result.status).toBe(ImageRecognitionStatus.COMPLETED)
        })

        it('更新内容时应同时更新 lastEditAt', async () => {
            mockPrisma.imageRecognitionRecords.update.mockResolvedValue(baseMockRecord)

            await updateImageRecognitionRecordDao(1, { htmlContent: '<p>new</p>' })

            expect(mockPrisma.imageRecognitionRecords.update).toHaveBeenCalledWith({
                where: { id: 1 },
                data: expect.objectContaining({
                    lastEditAt: expect.any(Date),
                }),
            })
        })

        it('更新 markdownContent 时也应更新 lastEditAt', async () => {
            mockPrisma.imageRecognitionRecords.update.mockResolvedValue(baseMockRecord)

            await updateImageRecognitionRecordDao(1, { markdownContent: 'new content' })

            expect(mockPrisma.imageRecognitionRecords.update).toHaveBeenCalledWith({
                where: { id: 1 },
                data: expect.objectContaining({
                    lastEditAt: expect.any(Date),
                }),
            })
        })

        it('仅更新状态时不应更新 lastEditAt', async () => {
            mockPrisma.imageRecognitionRecords.update.mockResolvedValue(baseMockRecord)

            await updateImageRecognitionRecordDao(1, { status: ImageRecognitionStatus.FAILED })

            const callData = mockPrisma.imageRecognitionRecords.update.mock.calls[0]![0].data
            // lastEditAt 不应被显式设置（只有 updatedAt）
            expect(callData.lastEditAt).toBeUndefined()
        })

        it('更新失败时应抛出错误', async () => {
            mockPrisma.imageRecognitionRecords.update.mockRejectedValue(new Error('Not found'))
            await expect(
                updateImageRecognitionRecordDao(999, { status: ImageRecognitionStatus.FAILED }),
            ).rejects.toThrow('Not found')
        })
    })

    // ==================== findImageRecognitionsByOssFileIdsDao ====================
    describe('findImageRecognitionsByOssFileIdsDao', () => {
        it('应批量查询记录', async () => {
            mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([baseMockRecord])

            const result = await findImageRecognitionsByOssFileIdsDao([100, 200])

            expect(mockPrisma.imageRecognitionRecords.findMany).toHaveBeenCalledWith({
                where: { ossFileId: { in: [100, 200] }, deletedAt: null },
            })
            expect(result).toEqual([baseMockRecord])
        })

        it('空数组应返回空列表', async () => {
            mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([])
            expect(await findImageRecognitionsByOssFileIdsDao([])).toEqual([])
        })
    })

    // ==================== deleteImageRecognitionRecordDao ====================
    describe('deleteImageRecognitionRecordDao', () => {
        it('应软删除记录', async () => {
            const deleted = { ...baseMockRecord, deletedAt: new Date() }
            mockPrisma.imageRecognitionRecords.update.mockResolvedValue(deleted)

            const result = await deleteImageRecognitionRecordDao(1)

            expect(mockPrisma.imageRecognitionRecords.update).toHaveBeenCalledWith({
                where: { id: 1 },
                data: expect.objectContaining({
                    deletedAt: expect.any(Date),
                    updatedAt: expect.any(Date),
                }),
            })
            expect(result.deletedAt).not.toBeNull()
        })

        it('删除失败时应抛出错误', async () => {
            mockPrisma.imageRecognitionRecords.update.mockRejectedValue(new Error('Not found'))
            await expect(deleteImageRecognitionRecordDao(999)).rejects.toThrow('Not found')
        })
    })
})
