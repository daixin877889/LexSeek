/**
 * ASR 任务服务层测试
 *
 * **Feature: asr-task-service**
 * **Validates: Requirements 3.2.1.1-3.2.1.12**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AsrTaskStatus } from '#shared/types/recognition'

// Mock logger
vi.stubGlobal('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
vi.stubGlobal('AsrTaskStatus', AsrTaskStatus)

// Mock prisma
const mockPrisma = {
    asrRecords: {
        findMany: vi.fn(),
        groupBy: vi.fn(),
        updateMany: vi.fn(),
    },
    ossFiles: {
        findMany: vi.fn(),
    },
}
vi.stubGlobal('prisma', mockPrisma)

// Mock DAO 层
vi.mock('~~/server/services/material/asrTask.dao', () => ({
    createAsrTaskDao: vi.fn(),
    findAsrTaskByIdDao: vi.fn(),
    findAsrTaskByTaskIdDao: vi.fn(),
    findManyAsrTasksDao: vi.fn(),
    findAsrTasksByIdsDao: vi.fn(),
    updateAsrTaskDao: vi.fn(),
    updateAsrTaskByTaskIdDao: vi.fn(),
    findPendingAsrTasksDao: vi.fn(),
}))

// Mock node 服务
vi.mock('~~/server/services/node/node.service', () => ({
    getValidNodeConfig: vi.fn(),
    getNodeConfigService: vi.fn(),
}))

// Mock ofetch
vi.mock('ofetch', () => ({
    $fetch: vi.fn(),
}))

import {
    createAsrTaskService,
    getAsrTaskByIdService,
    getAsrTaskByTaskIdService,
    getAsrTasksService,
    queryAsrTaskStatusService,
    queryAsrTaskStatusBatchService,
    retryAsrTaskService,
    updateAsrTaskStatusService,
    updateAsrTaskService,
    getPendingAsrTasksService,
    isAsrTaskProcessedService,
} from '~~/server/services/material/asrTask.service'

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

import { getValidNodeConfig } from '~~/server/services/node/node.service'
import { $fetch } from 'ofetch'

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

describe('ASR 任务服务层', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ==================== createAsrTaskService ====================
    describe('createAsrTaskService', () => {
        it('应委托 DAO 创建任务', async () => {
            vi.mocked(createAsrTaskDao).mockResolvedValue(baseMockTask as any)

            const result = await createAsrTaskService({ taskId: 'task-abc-123' })

            expect(createAsrTaskDao).toHaveBeenCalledWith({ taskId: 'task-abc-123' }, undefined)
            expect(result).toEqual(baseMockTask)
        })

        it('应传递事务客户端', async () => {
            vi.mocked(createAsrTaskDao).mockResolvedValue(baseMockTask as any)
            const mockTx = {} as any

            await createAsrTaskService({ taskId: 'task-tx' }, mockTx)

            expect(createAsrTaskDao).toHaveBeenCalledWith({ taskId: 'task-tx' }, mockTx)
        })
    })

    // ==================== getAsrTaskByIdService ====================
    describe('getAsrTaskByIdService', () => {
        it('任务不存在时应返回 null', async () => {
            vi.mocked(findAsrTaskByIdDao).mockResolvedValue(null)

            const result = await getAsrTaskByIdService(999)
            expect(result).toBeNull()
        })

        it('应返回任务及关联记录信息', async () => {
            vi.mocked(findAsrTaskByIdDao).mockResolvedValue(baseMockTask as any)
            mockPrisma.asrRecords.findMany.mockResolvedValue([
                { id: 10, ossFileId: 100 },
                { id: 11, ossFileId: 101 },
            ])
            mockPrisma.ossFiles.findMany.mockResolvedValue([
                { fileName: 'audio1.mp3' },
                { fileName: 'audio2.mp3' },
            ])

            const result = await getAsrTaskByIdService(1)

            expect(result).toMatchObject({
                id: 1,
                recordCount: 2,
                fileNames: ['audio1.mp3', 'audio2.mp3'],
            })
        })

        it('无关联记录时 fileNames 应为空数组', async () => {
            vi.mocked(findAsrTaskByIdDao).mockResolvedValue(baseMockTask as any)
            mockPrisma.asrRecords.findMany.mockResolvedValue([])

            const result = await getAsrTaskByIdService(1)

            expect(result!.recordCount).toBe(0)
            expect(result!.fileNames).toEqual([])
        })
    })

    // ==================== getAsrTaskByTaskIdService ====================
    describe('getAsrTaskByTaskIdService', () => {
        it('应委托 DAO 查询', async () => {
            vi.mocked(findAsrTaskByTaskIdDao).mockResolvedValue(baseMockTask as any)

            const result = await getAsrTaskByTaskIdService('task-abc-123')
            expect(result).toEqual(baseMockTask)
        })

        it('任务不存在时应返回 null', async () => {
            vi.mocked(findAsrTaskByTaskIdDao).mockResolvedValue(null)

            const result = await getAsrTaskByTaskIdService('nonexistent')
            expect(result).toBeNull()
        })
    })

    // ==================== getAsrTasksService ====================
    describe('getAsrTasksService', () => {
        it('应返回带关联记录数量的任务列表', async () => {
            vi.mocked(findManyAsrTasksDao).mockResolvedValue({
                list: [baseMockTask as any],
                total: 1,
            })
            mockPrisma.asrRecords.groupBy.mockResolvedValue([
                { asrTasksId: 1, _count: { id: 3 } },
            ])

            const result = await getAsrTasksService()

            expect(result.total).toBe(1)
            expect(result.list[0]!.recordCount).toBe(3)
        })

        it('无关联记录时 recordCount 应为 0', async () => {
            vi.mocked(findManyAsrTasksDao).mockResolvedValue({
                list: [baseMockTask as any],
                total: 1,
            })
            mockPrisma.asrRecords.groupBy.mockResolvedValue([])

            const result = await getAsrTasksService()
            expect(result.list[0]!.recordCount).toBe(0)
        })
    })

    // ==================== queryAsrTaskStatusService ====================
    describe('queryAsrTaskStatusService', () => {
        it('任务不存在时应抛出错误', async () => {
            vi.mocked(findAsrTaskByIdDao).mockResolvedValue(null)

            await expect(queryAsrTaskStatusService(999)).rejects.toThrow('任务不存在')
        })

        it('任务已完成时应直接返回', async () => {
            const successTask = { ...baseMockTask, status: AsrTaskStatus.SUCCESS }
            vi.mocked(findAsrTaskByIdDao).mockResolvedValue(successTask as any)
            mockPrisma.asrRecords.findMany.mockResolvedValue([])

            const result = await queryAsrTaskStatusService(1)

            expect(result.status).toBe(AsrTaskStatus.SUCCESS)
            expect($fetch).not.toHaveBeenCalled()
        })

        it('任务已失败时应直接返回', async () => {
            const failedTask = { ...baseMockTask, status: AsrTaskStatus.FAILED }
            vi.mocked(findAsrTaskByIdDao).mockResolvedValue(failedTask as any)
            mockPrisma.asrRecords.findMany.mockResolvedValue([])

            const result = await queryAsrTaskStatusService(1)
            expect(result.status).toBe(AsrTaskStatus.FAILED)
        })

        it('没有 taskId 时应抛出错误', async () => {
            const noTaskIdTask = { ...baseMockTask, taskId: null, status: AsrTaskStatus.PROCESSING }
            vi.mocked(findAsrTaskByIdDao).mockResolvedValue(noTaskIdTask as any)

            await expect(queryAsrTaskStatusService(1)).rejects.toThrow('任务尚未提交到 ASR 服务')
        })

        it('API 返回 SUCCEEDED 时应更新为成功', async () => {
            const processingTask = { ...baseMockTask, status: AsrTaskStatus.PROCESSING }
            // 第一次调用返回处理中的任务，第二次返回更新后的任务
            vi.mocked(findAsrTaskByIdDao)
                .mockResolvedValueOnce(processingTask as any)
                .mockResolvedValueOnce({ ...processingTask, status: AsrTaskStatus.SUCCESS } as any)
            vi.mocked(getValidNodeConfig).mockResolvedValue({
                modelApiKeys: [{ apiKey: 'test-key' }],
                modelProviderBaseUrl: 'https://api.example.com',
                modelName: 'asr-model',
            } as any)
            vi.mocked($fetch).mockResolvedValue({
                output: { task_id: 'task-abc-123', task_status: 'SUCCEEDED', results: [] },
            })
            vi.mocked(updateAsrTaskDao).mockResolvedValue({} as any)
            mockPrisma.asrRecords.findMany.mockResolvedValue([])

            const result = await queryAsrTaskStatusService(1)

            expect(updateAsrTaskDao).toHaveBeenCalledWith(1, expect.objectContaining({
                status: AsrTaskStatus.SUCCESS,
            }))
        })

        it('API 返回错误码时应抛出', async () => {
            const processingTask = { ...baseMockTask, status: AsrTaskStatus.PROCESSING }
            vi.mocked(findAsrTaskByIdDao).mockResolvedValue(processingTask as any)
            vi.mocked(getValidNodeConfig).mockResolvedValue({
                modelApiKeys: [{ apiKey: 'test-key' }],
                modelProviderBaseUrl: 'https://api.example.com',
            } as any)
            vi.mocked($fetch).mockResolvedValue({ code: 'InvalidParam', message: '参数错误' })

            await expect(queryAsrTaskStatusService(1)).rejects.toThrow('参数错误')
        })
    })

    // ==================== queryAsrTaskStatusBatchService ====================
    describe('queryAsrTaskStatusBatchService', () => {
        it('应批量查询任务状态', async () => {
            vi.mocked(findAsrTasksByIdsDao).mockResolvedValue([baseMockTask as any])
            // 模拟 queryAsrTaskStatusService 的调用链
            vi.mocked(findAsrTaskByIdDao).mockResolvedValue({ ...baseMockTask, status: AsrTaskStatus.SUCCESS } as any)
            mockPrisma.asrRecords.findMany.mockResolvedValue([])

            const result = await queryAsrTaskStatusBatchService([1])

            expect(result.total).toBe(1)
            expect(result.success).toBe(1)
        })

        it('任务不存在时应记录失败', async () => {
            vi.mocked(findAsrTasksByIdsDao).mockResolvedValue([])

            const result = await queryAsrTaskStatusBatchService([999])

            expect(result.total).toBe(1)
            expect(result.failed).toBe(1)
            expect(result.results[0]!.error).toBe('任务不存在')
        })

        it('空 ids 数组应返回空结果', async () => {
            vi.mocked(findAsrTasksByIdsDao).mockResolvedValue([])

            const result = await queryAsrTaskStatusBatchService([])
            expect(result.total).toBe(0)
            expect(result.results).toEqual([])
        })
    })

    // ==================== retryAsrTaskService ====================
    describe('retryAsrTaskService', () => {
        it('任务不存在时应抛出错误', async () => {
            vi.mocked(findAsrTaskByIdDao).mockResolvedValue(null)

            await expect(retryAsrTaskService(999)).rejects.toThrow('任务不存在')
        })

        it('非失败任务应抛出错误', async () => {
            vi.mocked(findAsrTaskByIdDao).mockResolvedValue({
                ...baseMockTask,
                status: AsrTaskStatus.PROCESSING,
            } as any)

            await expect(retryAsrTaskService(1)).rejects.toThrow('只有失败或已被替代的任务才能重试')
        })

        it('加密文件应抛出错误', async () => {
            vi.mocked(findAsrTaskByIdDao).mockResolvedValue({
                ...baseMockTask,
                status: AsrTaskStatus.FAILED,
                isEncrypted: true,
            } as any)

            await expect(retryAsrTaskService(1)).rejects.toThrow('加密文件无法在后台重试')
        })

        it('没有关联记录应抛出错误', async () => {
            vi.mocked(findAsrTaskByIdDao).mockResolvedValue({
                ...baseMockTask,
                status: AsrTaskStatus.FAILED,
                isEncrypted: false,
            } as any)
            vi.mocked(getValidNodeConfig).mockResolvedValue({
                modelApiKeys: [{ apiKey: 'test-key' }],
                modelProviderBaseUrl: 'https://api.example.com',
                modelName: 'asr-model',
            } as any)
            mockPrisma.asrRecords.findMany.mockResolvedValue([])

            await expect(retryAsrTaskService(1)).rejects.toThrow('没有关联的音频记录')
        })

        it('没有有效音频 URL 时应抛出错误', async () => {
            vi.mocked(findAsrTaskByIdDao).mockResolvedValue({
                ...baseMockTask,
                status: AsrTaskStatus.FAILED,
                isEncrypted: false,
            } as any)
            vi.mocked(getValidNodeConfig).mockResolvedValue({
                modelApiKeys: [{ apiKey: 'test-key' }],
                modelProviderBaseUrl: 'https://api.example.com',
                modelName: 'asr-model',
            } as any)
            mockPrisma.asrRecords.findMany.mockResolvedValue([
                { id: 10, ossFileId: 100, audioUrl: null },
            ])

            await expect(retryAsrTaskService(1)).rejects.toThrow('没有有效的音频 URL')
        })
    })

    // ==================== updateAsrTaskStatusService ====================
    describe('updateAsrTaskStatusService', () => {
        it('应通过 taskId 更新状态', async () => {
            const updated = { ...baseMockTask, status: AsrTaskStatus.SUCCESS }
            vi.mocked(updateAsrTaskByTaskIdDao).mockResolvedValue(updated as any)

            const result = await updateAsrTaskStatusService('task-abc-123', AsrTaskStatus.SUCCESS)

            expect(updateAsrTaskByTaskIdDao).toHaveBeenCalledWith('task-abc-123', { status: AsrTaskStatus.SUCCESS })
            expect(result!.status).toBe(AsrTaskStatus.SUCCESS)
        })

        it('应同时更新 result', async () => {
            vi.mocked(updateAsrTaskByTaskIdDao).mockResolvedValue(baseMockTask as any)
            const resultData = { text: 'hello' }

            await updateAsrTaskStatusService('task-abc-123', AsrTaskStatus.SUCCESS, resultData)

            expect(updateAsrTaskByTaskIdDao).toHaveBeenCalledWith('task-abc-123', {
                status: AsrTaskStatus.SUCCESS,
                result: resultData,
            })
        })

        it('任务不存在时应返回 null', async () => {
            vi.mocked(updateAsrTaskByTaskIdDao).mockResolvedValue(null)

            const result = await updateAsrTaskStatusService('nonexistent', 2)
            expect(result).toBeNull()
        })
    })

    // ==================== updateAsrTaskService ====================
    describe('updateAsrTaskService', () => {
        it('应更新任务', async () => {
            vi.mocked(findAsrTaskByIdDao).mockResolvedValue(baseMockTask as any)
            const updated = { ...baseMockTask, status: AsrTaskStatus.SUCCESS }
            vi.mocked(updateAsrTaskDao).mockResolvedValue(updated as any)

            const result = await updateAsrTaskService(1, { status: AsrTaskStatus.SUCCESS })
            expect(result.status).toBe(AsrTaskStatus.SUCCESS)
        })

        it('任务不存在时应抛出错误', async () => {
            vi.mocked(findAsrTaskByIdDao).mockResolvedValue(null)

            await expect(updateAsrTaskService(999, { status: 2 })).rejects.toThrow('任务不存在')
        })
    })

    // ==================== getPendingAsrTasksService ====================
    describe('getPendingAsrTasksService', () => {
        it('应委托 DAO 查询待处理任务', async () => {
            vi.mocked(findPendingAsrTasksDao).mockResolvedValue([baseMockTask as any])

            const result = await getPendingAsrTasksService()

            expect(findPendingAsrTasksDao).toHaveBeenCalledWith(100)
            expect(result).toEqual([baseMockTask])
        })

        it('应支持自定义 limit', async () => {
            vi.mocked(findPendingAsrTasksDao).mockResolvedValue([])

            await getPendingAsrTasksService(50)
            expect(findPendingAsrTasksDao).toHaveBeenCalledWith(50)
        })
    })

    // ==================== isAsrTaskProcessedService ====================
    describe('isAsrTaskProcessedService', () => {
        it('任务成功时应返回 true', async () => {
            vi.mocked(findAsrTaskByTaskIdDao).mockResolvedValue({
                ...baseMockTask,
                status: AsrTaskStatus.SUCCESS,
            } as any)

            expect(await isAsrTaskProcessedService('task-abc')).toBe(true)
        })

        it('任务失败时应返回 true', async () => {
            vi.mocked(findAsrTaskByTaskIdDao).mockResolvedValue({
                ...baseMockTask,
                status: AsrTaskStatus.FAILED,
            } as any)

            expect(await isAsrTaskProcessedService('task-abc')).toBe(true)
        })

        it('任务处理中时应返回 false', async () => {
            vi.mocked(findAsrTaskByTaskIdDao).mockResolvedValue({
                ...baseMockTask,
                status: AsrTaskStatus.PROCESSING,
            } as any)

            expect(await isAsrTaskProcessedService('task-abc')).toBe(false)
        })

        it('任务不存在时应返回 false', async () => {
            vi.mocked(findAsrTaskByTaskIdDao).mockResolvedValue(null)

            expect(await isAsrTaskProcessedService('nonexistent')).toBe(false)
        })
    })
})
