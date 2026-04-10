/**
 * MinerU 任务 DAO 层测试
 *
 * **Feature: mineru-task-dao**
 * **Validates: Requirements 3.1.2.1-3.1.2.12**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MineruTaskStatus } from '#shared/types/recognition'

// Mock prisma
const mockPrisma = {
    mineruTasks: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        update: vi.fn(),
    },
}
vi.stubGlobal('prisma', mockPrisma)
vi.stubGlobal('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
vi.stubGlobal('MineruTaskStatus', MineruTaskStatus)

import {
    createMineruTaskDao,
    findMineruTaskByIdDao,
    findMineruTaskByTaskIdDao,
    findMineruTaskByOssFileIdDao,
    findManyMineruTasksDao,
    findMineruTasksByIdsDao,
    updateMineruTaskDao,
    updateMineruTaskByTaskIdDao,
    findPendingMineruTasksDao,
} from '~~/server/services/material/mineruTask.dao'

const baseMockTask = {
    id: 1,
    taskId: 'mineru-task-123',
    ossFileId: 100,
    userId: 1,
    status: MineruTaskStatus.PENDING,
    taskRawData: {},
    result: null,
    errorMsg: null,
    retryCount: 0,
    isEncrypted: false,
    retrySourceId: null,
    supersededById: null,
    completedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
}

describe('MinerU 任务 DAO 层', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ==================== createMineruTaskDao ====================
    describe('createMineruTaskDao', () => {
        it('应使用默认值创建任务', async () => {
            mockPrisma.mineruTasks.create.mockResolvedValue(baseMockTask)

            const result = await createMineruTaskDao({ ossFileId: 100, userId: 1 })

            expect(mockPrisma.mineruTasks.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    ossFileId: 100,
                    userId: 1,
                    status: MineruTaskStatus.PENDING,
                    taskRawData: {},
                    isEncrypted: false,
                }),
            })
            expect(result).toEqual(baseMockTask)
        })

        it('应使用自定义值创建任务', async () => {
            const input = {
                taskId: 'custom-task',
                ossFileId: 200,
                userId: 2,
                status: MineruTaskStatus.PROCESSING,
                taskRawData: { key: 'val' },
                isEncrypted: true,
            }
            mockPrisma.mineruTasks.create.mockResolvedValue({ ...baseMockTask, ...input })

            const result = await createMineruTaskDao(input)

            expect(mockPrisma.mineruTasks.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    taskId: 'custom-task',
                    status: MineruTaskStatus.PROCESSING,
                    isEncrypted: true,
                }),
            })
            expect(result.taskId).toBe('custom-task')
        })

        it('应使用事务客户端', async () => {
            const mockTx = { mineruTasks: { create: vi.fn().mockResolvedValue(baseMockTask) } }

            await createMineruTaskDao({ ossFileId: 100, userId: 1 }, mockTx as any)

            expect(mockTx.mineruTasks.create).toHaveBeenCalled()
            expect(mockPrisma.mineruTasks.create).not.toHaveBeenCalled()
        })

        it('创建失败时应抛出错误', async () => {
            mockPrisma.mineruTasks.create.mockRejectedValue(new Error('DB error'))
            await expect(createMineruTaskDao({ ossFileId: 100, userId: 1 })).rejects.toThrow('DB error')
        })
    })

    // ==================== findMineruTaskByIdDao ====================
    describe('findMineruTaskByIdDao', () => {
        it('应通过 ID 查询任务', async () => {
            mockPrisma.mineruTasks.findFirst.mockResolvedValue(baseMockTask)

            const result = await findMineruTaskByIdDao(1)

            expect(mockPrisma.mineruTasks.findFirst).toHaveBeenCalledWith({
                where: { id: 1, deletedAt: null },
            })
            expect(result).toEqual(baseMockTask)
        })

        it('任务不存在时应返回 null', async () => {
            mockPrisma.mineruTasks.findFirst.mockResolvedValue(null)
            expect(await findMineruTaskByIdDao(999)).toBeNull()
        })
    })

    // ==================== findMineruTaskByTaskIdDao ====================
    describe('findMineruTaskByTaskIdDao', () => {
        it('应通过 taskId 查询任务', async () => {
            mockPrisma.mineruTasks.findFirst.mockResolvedValue(baseMockTask)

            const result = await findMineruTaskByTaskIdDao('mineru-task-123')

            expect(mockPrisma.mineruTasks.findFirst).toHaveBeenCalledWith({
                where: { taskId: 'mineru-task-123', deletedAt: null },
            })
            expect(result).toEqual(baseMockTask)
        })

        it('任务不存在时应返回 null', async () => {
            mockPrisma.mineruTasks.findFirst.mockResolvedValue(null)
            expect(await findMineruTaskByTaskIdDao('nonexistent')).toBeNull()
        })
    })

    // ==================== findMineruTaskByOssFileIdDao ====================
    describe('findMineruTaskByOssFileIdDao', () => {
        it('应通过 ossFileId 查询最新任务', async () => {
            mockPrisma.mineruTasks.findFirst.mockResolvedValue(baseMockTask)

            const result = await findMineruTaskByOssFileIdDao(100)

            expect(mockPrisma.mineruTasks.findFirst).toHaveBeenCalledWith({
                where: { ossFileId: 100, deletedAt: null },
                orderBy: { createdAt: 'desc' },
            })
            expect(result).toEqual(baseMockTask)
        })

        it('任务不存在时应返回 null', async () => {
            mockPrisma.mineruTasks.findFirst.mockResolvedValue(null)
            expect(await findMineruTaskByOssFileIdDao(999)).toBeNull()
        })
    })

    // ==================== findManyMineruTasksDao ====================
    describe('findManyMineruTasksDao', () => {
        it('应使用默认参数查询列表', async () => {
            mockPrisma.mineruTasks.findMany.mockResolvedValue([baseMockTask])
            mockPrisma.mineruTasks.count.mockResolvedValue(1)

            const result = await findManyMineruTasksDao()

            expect(result).toEqual({ list: [baseMockTask], total: 1 })
            expect(mockPrisma.mineruTasks.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ skip: 0, take: 20, orderBy: { createdAt: 'desc' } }),
            )
        })

        it('应支持状态筛选', async () => {
            mockPrisma.mineruTasks.findMany.mockResolvedValue([])
            mockPrisma.mineruTasks.count.mockResolvedValue(0)

            await findManyMineruTasksDao({ status: MineruTaskStatus.SUCCESS })

            expect(mockPrisma.mineruTasks.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ status: MineruTaskStatus.SUCCESS }),
                }),
            )
        })

        it('应支持关键词搜索', async () => {
            mockPrisma.mineruTasks.findMany.mockResolvedValue([])
            mockPrisma.mineruTasks.count.mockResolvedValue(0)

            await findManyMineruTasksDao({ keyword: 'abc' })

            expect(mockPrisma.mineruTasks.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        taskId: { contains: 'abc', mode: 'insensitive' },
                    }),
                }),
            )
        })

        it('应支持时间范围筛选', async () => {
            const startDate = new Date('2026-01-01')
            const endDate = new Date('2026-01-31')
            mockPrisma.mineruTasks.findMany.mockResolvedValue([])
            mockPrisma.mineruTasks.count.mockResolvedValue(0)

            await findManyMineruTasksDao({ startDate, endDate })

            expect(mockPrisma.mineruTasks.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        createdAt: { gte: startDate, lte: endDate },
                    }),
                }),
            )
        })

        it('应支持分页参数', async () => {
            mockPrisma.mineruTasks.findMany.mockResolvedValue([])
            mockPrisma.mineruTasks.count.mockResolvedValue(0)

            await findManyMineruTasksDao({ page: 2, pageSize: 5 })

            expect(mockPrisma.mineruTasks.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ skip: 5, take: 5 }),
            )
        })
    })

    // ==================== findMineruTasksByIdsDao ====================
    describe('findMineruTasksByIdsDao', () => {
        it('应通过 ID 列表查询任务', async () => {
            mockPrisma.mineruTasks.findMany.mockResolvedValue([baseMockTask])

            const result = await findMineruTasksByIdsDao([1, 2])

            expect(mockPrisma.mineruTasks.findMany).toHaveBeenCalledWith({
                where: { id: { in: [1, 2] }, deletedAt: null },
            })
            expect(result).toEqual([baseMockTask])
        })

        it('空数组应返回空列表', async () => {
            mockPrisma.mineruTasks.findMany.mockResolvedValue([])
            expect(await findMineruTasksByIdsDao([])).toEqual([])
        })
    })

    // ==================== updateMineruTaskDao ====================
    describe('updateMineruTaskDao', () => {
        it('应更新任务', async () => {
            const updated = { ...baseMockTask, status: MineruTaskStatus.SUCCESS }
            mockPrisma.mineruTasks.update.mockResolvedValue(updated)

            const result = await updateMineruTaskDao(1, { status: MineruTaskStatus.SUCCESS })

            expect(mockPrisma.mineruTasks.update).toHaveBeenCalledWith({
                where: { id: 1 },
                data: expect.objectContaining({ status: MineruTaskStatus.SUCCESS }),
            })
            expect(result.status).toBe(MineruTaskStatus.SUCCESS)
        })

        it('更新失败时应抛出错误', async () => {
            mockPrisma.mineruTasks.update.mockRejectedValue(new Error('Not found'))
            await expect(updateMineruTaskDao(999, { status: 2 })).rejects.toThrow('Not found')
        })
    })

    // ==================== updateMineruTaskByTaskIdDao ====================
    describe('updateMineruTaskByTaskIdDao', () => {
        it('应通过 taskId 更新任务', async () => {
            mockPrisma.mineruTasks.findFirst.mockResolvedValue(baseMockTask)
            const updated = { ...baseMockTask, status: MineruTaskStatus.SUCCESS }
            mockPrisma.mineruTasks.update.mockResolvedValue(updated)

            const result = await updateMineruTaskByTaskIdDao('mineru-task-123', { status: MineruTaskStatus.SUCCESS })
            expect(result).toEqual(updated)
        })

        it('任务不存在时应返回 null', async () => {
            mockPrisma.mineruTasks.findFirst.mockResolvedValue(null)
            expect(await updateMineruTaskByTaskIdDao('nonexistent', { status: 2 })).toBeNull()
        })
    })

    // ==================== findPendingMineruTasksDao ====================
    describe('findPendingMineruTasksDao', () => {
        it('应查询待处理任务', async () => {
            mockPrisma.mineruTasks.findMany.mockResolvedValue([baseMockTask])

            const result = await findPendingMineruTasksDao()

            expect(mockPrisma.mineruTasks.findMany).toHaveBeenCalledWith({
                where: {
                    deletedAt: null,
                    status: { in: [MineruTaskStatus.PENDING, MineruTaskStatus.PROCESSING] },
                    taskId: { not: null, notIn: ['existing'] },
                },
                orderBy: { createdAt: 'asc' },
                take: 100,
            })
            expect(result).toEqual([baseMockTask])
        })

        it('应支持自定义 limit', async () => {
            mockPrisma.mineruTasks.findMany.mockResolvedValue([])

            await findPendingMineruTasksDao(25)

            expect(mockPrisma.mineruTasks.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ take: 25 }),
            )
        })
    })
})
