/**
 * ASR 任务 DAO 层测试
 *
 * **Feature: asr-task-dao**
 * **Validates: Requirements 3.2.1.1-3.2.1.12**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AsrTaskStatus } from '#shared/types/recognition'

// Mock prisma
const mockPrisma = {
    asrTasks: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        update: vi.fn(),
    },
}
vi.stubGlobal('prisma', mockPrisma)
vi.stubGlobal('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
vi.stubGlobal('AsrTaskStatus', AsrTaskStatus)

import {
    createAsrTaskDao,
    findAsrTaskByIdDao,
    findAsrTaskByTaskIdDao,
    findManyAsrTasksDao,
    findAsrTasksByIdsDao,
    updateAsrTaskDao,
    updateAsrTaskByTaskIdDao,
    findPendingAsrTasksDao,
} from '~~/server/services/material/asrTask.dao'

const baseMockTask = {
    id: 1,
    taskId: 'task-abc-123',
    status: AsrTaskStatus.PENDING,
    taskRawData: {},
    result: {},
    isEncrypted: false,
    retrySourceId: null,
    supersededById: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
}

describe('ASR 任务 DAO 层', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ==================== createAsrTaskDao ====================
    describe('createAsrTaskDao', () => {
        it('应使用默认值创建任务', async () => {
            mockPrisma.asrTasks.create.mockResolvedValue(baseMockTask)

            const result = await createAsrTaskDao({ taskId: 'task-abc-123' })

            expect(mockPrisma.asrTasks.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    taskId: 'task-abc-123',
                    status: AsrTaskStatus.PENDING,
                    taskRawData: {},
                    result: {},
                    isEncrypted: false,
                }),
            })
            expect(result).toEqual(baseMockTask)
        })

        it('应使用自定义值创建任务', async () => {
            const input = {
                taskId: 'task-xyz',
                status: AsrTaskStatus.PROCESSING,
                taskRawData: { foo: 'bar' },
                result: { text: 'hello' },
                isEncrypted: true,
            }
            mockPrisma.asrTasks.create.mockResolvedValue({ ...baseMockTask, ...input })

            const result = await createAsrTaskDao(input)

            expect(mockPrisma.asrTasks.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    status: AsrTaskStatus.PROCESSING,
                    isEncrypted: true,
                }),
            })
            expect(result.status).toBe(AsrTaskStatus.PROCESSING)
        })

        it('应使用事务客户端创建任务', async () => {
            const mockTx = { asrTasks: { create: vi.fn().mockResolvedValue(baseMockTask) } }

            await createAsrTaskDao({ taskId: 'task-tx' }, mockTx as any)

            expect(mockTx.asrTasks.create).toHaveBeenCalled()
            expect(mockPrisma.asrTasks.create).not.toHaveBeenCalled()
        })

        it('创建失败时应抛出错误', async () => {
            mockPrisma.asrTasks.create.mockRejectedValue(new Error('DB error'))

            await expect(createAsrTaskDao({ taskId: 'fail' })).rejects.toThrow('DB error')
        })
    })

    // ==================== findAsrTaskByIdDao ====================
    describe('findAsrTaskByIdDao', () => {
        it('应通过 ID 查询任务', async () => {
            mockPrisma.asrTasks.findFirst.mockResolvedValue(baseMockTask)

            const result = await findAsrTaskByIdDao(1)

            expect(mockPrisma.asrTasks.findFirst).toHaveBeenCalledWith({
                where: { id: 1, deletedAt: null },
            })
            expect(result).toEqual(baseMockTask)
        })

        it('任务不存在时应返回 null', async () => {
            mockPrisma.asrTasks.findFirst.mockResolvedValue(null)

            const result = await findAsrTaskByIdDao(999)
            expect(result).toBeNull()
        })

        it('查询失败时应抛出错误', async () => {
            mockPrisma.asrTasks.findFirst.mockRejectedValue(new Error('DB error'))
            await expect(findAsrTaskByIdDao(1)).rejects.toThrow('DB error')
        })
    })

    // ==================== findAsrTaskByTaskIdDao ====================
    describe('findAsrTaskByTaskIdDao', () => {
        it('应通过 taskId 查询任务', async () => {
            mockPrisma.asrTasks.findFirst.mockResolvedValue(baseMockTask)

            const result = await findAsrTaskByTaskIdDao('task-abc-123')

            expect(mockPrisma.asrTasks.findFirst).toHaveBeenCalledWith({
                where: { taskId: 'task-abc-123', deletedAt: null },
            })
            expect(result).toEqual(baseMockTask)
        })

        it('任务不存在时应返回 null', async () => {
            mockPrisma.asrTasks.findFirst.mockResolvedValue(null)
            const result = await findAsrTaskByTaskIdDao('nonexistent')
            expect(result).toBeNull()
        })
    })

    // ==================== findManyAsrTasksDao ====================
    describe('findManyAsrTasksDao', () => {
        it('应使用默认参数查询列表', async () => {
            mockPrisma.asrTasks.findMany.mockResolvedValue([baseMockTask])
            mockPrisma.asrTasks.count.mockResolvedValue(1)

            const result = await findManyAsrTasksDao()

            expect(result).toEqual({ list: [baseMockTask], total: 1 })
            expect(mockPrisma.asrTasks.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    skip: 0,
                    take: 20,
                    orderBy: { createdAt: 'desc' },
                }),
            )
        })

        it('应支持状态筛选', async () => {
            mockPrisma.asrTasks.findMany.mockResolvedValue([])
            mockPrisma.asrTasks.count.mockResolvedValue(0)

            await findManyAsrTasksDao({ status: AsrTaskStatus.SUCCESS })

            expect(mockPrisma.asrTasks.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ status: AsrTaskStatus.SUCCESS }),
                }),
            )
        })

        it('应支持关键词搜索', async () => {
            mockPrisma.asrTasks.findMany.mockResolvedValue([])
            mockPrisma.asrTasks.count.mockResolvedValue(0)

            await findManyAsrTasksDao({ keyword: 'abc' })

            expect(mockPrisma.asrTasks.findMany).toHaveBeenCalledWith(
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
            mockPrisma.asrTasks.findMany.mockResolvedValue([])
            mockPrisma.asrTasks.count.mockResolvedValue(0)

            await findManyAsrTasksDao({ startDate, endDate })

            expect(mockPrisma.asrTasks.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        createdAt: { gte: startDate, lte: endDate },
                    }),
                }),
            )
        })

        it('应支持分页参数', async () => {
            mockPrisma.asrTasks.findMany.mockResolvedValue([])
            mockPrisma.asrTasks.count.mockResolvedValue(0)

            await findManyAsrTasksDao({ page: 3, pageSize: 10 })

            expect(mockPrisma.asrTasks.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ skip: 20, take: 10 }),
            )
        })
    })

    // ==================== findAsrTasksByIdsDao ====================
    describe('findAsrTasksByIdsDao', () => {
        it('应通过 ID 列表查询任务', async () => {
            mockPrisma.asrTasks.findMany.mockResolvedValue([baseMockTask])

            const result = await findAsrTasksByIdsDao([1, 2, 3])

            expect(mockPrisma.asrTasks.findMany).toHaveBeenCalledWith({
                where: { id: { in: [1, 2, 3] }, deletedAt: null },
            })
            expect(result).toEqual([baseMockTask])
        })

        it('空数组应返回空列表', async () => {
            mockPrisma.asrTasks.findMany.mockResolvedValue([])

            const result = await findAsrTasksByIdsDao([])
            expect(result).toEqual([])
        })
    })

    // ==================== updateAsrTaskDao ====================
    describe('updateAsrTaskDao', () => {
        it('应更新任务', async () => {
            const updated = { ...baseMockTask, status: AsrTaskStatus.SUCCESS }
            mockPrisma.asrTasks.update.mockResolvedValue(updated)

            const result = await updateAsrTaskDao(1, { status: AsrTaskStatus.SUCCESS })

            expect(mockPrisma.asrTasks.update).toHaveBeenCalledWith({
                where: { id: 1 },
                data: expect.objectContaining({ status: AsrTaskStatus.SUCCESS }),
            })
            expect(result.status).toBe(AsrTaskStatus.SUCCESS)
        })

        it('更新失败时应抛出错误', async () => {
            mockPrisma.asrTasks.update.mockRejectedValue(new Error('Not found'))
            await expect(updateAsrTaskDao(999, { status: 2 })).rejects.toThrow('Not found')
        })
    })

    // ==================== updateAsrTaskByTaskIdDao ====================
    describe('updateAsrTaskByTaskIdDao', () => {
        it('应通过 taskId 更新任务', async () => {
            mockPrisma.asrTasks.findFirst.mockResolvedValue(baseMockTask)
            const updated = { ...baseMockTask, status: AsrTaskStatus.SUCCESS }
            mockPrisma.asrTasks.update.mockResolvedValue(updated)

            const result = await updateAsrTaskByTaskIdDao('task-abc-123', { status: AsrTaskStatus.SUCCESS })

            expect(result).toEqual(updated)
        })

        it('任务不存在时应返回 null', async () => {
            mockPrisma.asrTasks.findFirst.mockResolvedValue(null)

            const result = await updateAsrTaskByTaskIdDao('nonexistent', { status: 2 })
            expect(result).toBeNull()
        })
    })

    // ==================== findPendingAsrTasksDao ====================
    describe('findPendingAsrTasksDao', () => {
        it('应查询待处理任务', async () => {
            mockPrisma.asrTasks.findMany.mockResolvedValue([baseMockTask])

            const result = await findPendingAsrTasksDao()

            expect(mockPrisma.asrTasks.findMany).toHaveBeenCalledWith({
                where: {
                    deletedAt: null,
                    status: { in: [AsrTaskStatus.PENDING, AsrTaskStatus.PROCESSING] },
                    taskId: { not: null },
                },
                orderBy: { createdAt: 'asc' },
                take: 100,
            })
            expect(result).toEqual([baseMockTask])
        })

        it('应支持自定义 limit', async () => {
            mockPrisma.asrTasks.findMany.mockResolvedValue([])

            await findPendingAsrTasksDao(10)

            expect(mockPrisma.asrTasks.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ take: 10 }),
            )
        })
    })
})
