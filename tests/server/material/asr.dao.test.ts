/**
 * ASR 识别记录 DAO 层测试
 *
 * **Feature: asr-record-dao**
 * **Validates: Requirements 3.2.1-3.2.10**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AsrRecordStatus } from '#shared/types/recognition'

// Mock prisma
const mockPrisma = {
    asrRecords: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
    },
}
vi.stubGlobal('prisma', mockPrisma)
vi.stubGlobal('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
vi.stubGlobal('AsrRecordStatus', AsrRecordStatus)

import {
    createAsrRecordDao,
    findAsrRecordByIdDao,
    findAsrRecordByOssFileIdDao,
    findAsrRecordsByOssFileIdsDao,
    findAsrRecordsByTaskIdDao,
    updateAsrRecordDao,
    updateAsrRecordsByTaskIdDao,
} from '~~/server/services/material/asr.dao'

const baseMockRecord = {
    id: 1,
    userId: 1,
    ossFileId: 100,
    asrTasksId: 10,
    status: AsrRecordStatus.PENDING,
    audioUrl: 'https://example.com/audio.mp3',
    audioDuration: 120,
    result: {},
    jsonOssFileId: null,
    speakers: [],
    tempFilePath: null,
    keywords: null,
    summary: null,
    vectorIds: null,
    lastEmbeddingAt: null,
    lastEditAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
}

describe('ASR 识别记录 DAO 层', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ==================== createAsrRecordDao ====================
    describe('createAsrRecordDao', () => {
        it('应使用默认值创建记录', async () => {
            mockPrisma.asrRecords.create.mockResolvedValue(baseMockRecord)

            const result = await createAsrRecordDao({ userId: 1, ossFileId: 100 })

            expect(mockPrisma.asrRecords.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    userId: 1,
                    ossFileId: 100,
                    status: AsrRecordStatus.PENDING,
                    result: {},
                    speakers: [],
                }),
            })
            expect(result).toEqual(baseMockRecord)
        })

        it('应使用全部自定义值创建记录', async () => {
            const input = {
                userId: 2,
                ossFileId: 200,
                asrTasksId: 20,
                status: AsrRecordStatus.PROCESSING,
                audioUrl: 'https://example.com/audio2.mp3',
                audioDuration: 300,
                result: { text: 'hello' },
                jsonOssFileId: 50,
                speakers: [{ id: 1, name: '说话人1', color: '#ff0000' }],
                tempFilePath: '/tmp/audio.mp3',
            }
            mockPrisma.asrRecords.create.mockResolvedValue({ ...baseMockRecord, ...input })

            const result = await createAsrRecordDao(input)

            expect(mockPrisma.asrRecords.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    asrTasksId: 20,
                    audioUrl: 'https://example.com/audio2.mp3',
                    tempFilePath: '/tmp/audio.mp3',
                }),
            })
            expect(result.asrTasksId).toBe(20)
        })

        it('应使用事务客户端', async () => {
            const mockTx = { asrRecords: { create: vi.fn().mockResolvedValue(baseMockRecord) } }

            await createAsrRecordDao({ userId: 1, ossFileId: 100 }, mockTx as any)

            expect(mockTx.asrRecords.create).toHaveBeenCalled()
            expect(mockPrisma.asrRecords.create).not.toHaveBeenCalled()
        })

        it('创建失败时应抛出错误', async () => {
            mockPrisma.asrRecords.create.mockRejectedValue(new Error('DB error'))
            await expect(createAsrRecordDao({ userId: 1, ossFileId: 100 })).rejects.toThrow('DB error')
        })
    })

    // ==================== findAsrRecordByIdDao ====================
    describe('findAsrRecordByIdDao', () => {
        it('应通过 ID 查询记录', async () => {
            mockPrisma.asrRecords.findFirst.mockResolvedValue(baseMockRecord)

            const result = await findAsrRecordByIdDao(1)

            expect(mockPrisma.asrRecords.findFirst).toHaveBeenCalledWith({
                where: { id: 1, deletedAt: null },
            })
            expect(result).toEqual(baseMockRecord)
        })

        it('记录不存在时应返回 null', async () => {
            mockPrisma.asrRecords.findFirst.mockResolvedValue(null)
            expect(await findAsrRecordByIdDao(999)).toBeNull()
        })

        it('查询失败时应抛出错误', async () => {
            mockPrisma.asrRecords.findFirst.mockRejectedValue(new Error('DB error'))
            await expect(findAsrRecordByIdDao(1)).rejects.toThrow('DB error')
        })
    })

    // ==================== findAsrRecordByOssFileIdDao ====================
    describe('findAsrRecordByOssFileIdDao', () => {
        it('应通过 ossFileId 查询记录', async () => {
            mockPrisma.asrRecords.findFirst.mockResolvedValue(baseMockRecord)

            const result = await findAsrRecordByOssFileIdDao(100)

            expect(mockPrisma.asrRecords.findFirst).toHaveBeenCalledWith({
                where: { ossFileId: 100, deletedAt: null },
            })
            expect(result).toEqual(baseMockRecord)
        })

        it('记录不存在时应返回 null', async () => {
            mockPrisma.asrRecords.findFirst.mockResolvedValue(null)
            expect(await findAsrRecordByOssFileIdDao(999)).toBeNull()
        })
    })

    // ==================== findAsrRecordsByOssFileIdsDao ====================
    describe('findAsrRecordsByOssFileIdsDao', () => {
        it('应通过 ossFileId 集合查询记录', async () => {
            mockPrisma.asrRecords.findMany.mockResolvedValue([baseMockRecord])

            const result = await findAsrRecordsByOssFileIdsDao([100, 200])

            expect(mockPrisma.asrRecords.findMany).toHaveBeenCalledWith({
                where: { ossFileId: { in: [100, 200] }, deletedAt: null },
            })
            expect(result).toEqual([baseMockRecord])
        })

        it('空数组应返回空列表', async () => {
            mockPrisma.asrRecords.findMany.mockResolvedValue([])
            expect(await findAsrRecordsByOssFileIdsDao([])).toEqual([])
        })
    })

    // ==================== findAsrRecordsByTaskIdDao ====================
    describe('findAsrRecordsByTaskIdDao', () => {
        it('应通过 asrTasksId 查询记录列表', async () => {
            mockPrisma.asrRecords.findMany.mockResolvedValue([baseMockRecord])

            const result = await findAsrRecordsByTaskIdDao(10)

            expect(mockPrisma.asrRecords.findMany).toHaveBeenCalledWith({
                where: { asrTasksId: 10, deletedAt: null },
            })
            expect(result).toEqual([baseMockRecord])
        })

        it('无关联记录时应返回空列表', async () => {
            mockPrisma.asrRecords.findMany.mockResolvedValue([])
            expect(await findAsrRecordsByTaskIdDao(999)).toEqual([])
        })
    })

    // ==================== updateAsrRecordDao ====================
    describe('updateAsrRecordDao', () => {
        it('应更新记录', async () => {
            const updated = { ...baseMockRecord, status: AsrRecordStatus.SUCCESS }
            mockPrisma.asrRecords.update.mockResolvedValue(updated)

            const result = await updateAsrRecordDao(1, { status: AsrRecordStatus.SUCCESS })

            expect(mockPrisma.asrRecords.update).toHaveBeenCalledWith({
                where: { id: 1 },
                data: expect.objectContaining({
                    status: AsrRecordStatus.SUCCESS,
                    updatedAt: expect.any(Date),
                }),
            })
            expect(result.status).toBe(AsrRecordStatus.SUCCESS)
        })

        it('应支持更新多个字段', async () => {
            const updated = {
                ...baseMockRecord,
                summary: '测试摘要',
                keywords: ['关键词1'],
            }
            mockPrisma.asrRecords.update.mockResolvedValue(updated)

            await updateAsrRecordDao(1, {
                summary: '测试摘要',
                keywords: ['关键词1'],
            })

            expect(mockPrisma.asrRecords.update).toHaveBeenCalledWith({
                where: { id: 1 },
                data: expect.objectContaining({
                    summary: '测试摘要',
                    keywords: ['关键词1'],
                }),
            })
        })

        it('更新失败时应抛出错误', async () => {
            mockPrisma.asrRecords.update.mockRejectedValue(new Error('Not found'))
            await expect(updateAsrRecordDao(999, { status: 2 })).rejects.toThrow('Not found')
        })
    })

    // ==================== updateAsrRecordsByTaskIdDao ====================
    describe('updateAsrRecordsByTaskIdDao', () => {
        it('应批量更新记录状态', async () => {
            mockPrisma.asrRecords.updateMany.mockResolvedValue({ count: 3 })

            const result = await updateAsrRecordsByTaskIdDao(10, AsrRecordStatus.SUCCESS)

            expect(mockPrisma.asrRecords.updateMany).toHaveBeenCalledWith({
                where: { asrTasksId: 10, deletedAt: null },
                data: expect.objectContaining({
                    status: AsrRecordStatus.SUCCESS,
                    updatedAt: expect.any(Date),
                }),
            })
            expect(result).toBe(3)
        })

        it('无匹配记录时应返回 0', async () => {
            mockPrisma.asrRecords.updateMany.mockResolvedValue({ count: 0 })

            const result = await updateAsrRecordsByTaskIdDao(999, AsrRecordStatus.FAILED)
            expect(result).toBe(0)
        })

        it('更新失败时应抛出错误', async () => {
            mockPrisma.asrRecords.updateMany.mockRejectedValue(new Error('DB error'))
            await expect(updateAsrRecordsByTaskIdDao(10, 2)).rejects.toThrow('DB error')
        })
    })
})
