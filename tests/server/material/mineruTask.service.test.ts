/**
 * MinerU 任务服务层测试
 *
 * **Feature: mineru-task-service**
 * **Validates: Requirements 3.1.2.1-3.1.2.12**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MineruTaskStatus } from '#shared/types/recognition'

// Mock globals
vi.stubGlobal('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
vi.stubGlobal('MineruTaskStatus', MineruTaskStatus)

const mockPrisma = {
    ossFiles: { findFirst: vi.fn(), findMany: vi.fn() },
}
vi.stubGlobal('prisma', mockPrisma)

// Mock DAO 层
vi.mock('~~/server/services/material/mineruTask.dao', () => ({
    createMineruTaskDao: vi.fn(),
    findMineruTaskByIdDao: vi.fn(),
    findMineruTaskByTaskIdDao: vi.fn(),
    findMineruTaskByOssFileIdDao: vi.fn(),
    findManyMineruTasksDao: vi.fn(),
    findMineruTasksByIdsDao: vi.fn(),
    updateMineruTaskDao: vi.fn(),
    updateMineruTaskByTaskIdDao: vi.fn(),
    findPendingMineruTasksDao: vi.fn(),
}))

// Mock token 服务
vi.mock('~~/server/services/material/mineruToken.service', () => ({
    getTokenForExistingTaskService: vi.fn(),
}))

// Mock ofetch
vi.mock('ofetch', () => ({
    $fetch: vi.fn(),
}))

import {
    createMineruTaskService,
    getMineruTaskByIdService,
    getMineruTaskByTaskIdService,
    getMineruTaskByOssFileIdService,
    getMineruTasksService,
    queryMineruTaskStatusService,
    queryMineruTaskStatusBatchService,
    retryMineruTaskService,
    updateMineruTaskStatusService,
    updateMineruTaskService,
    getPendingMineruTasksService,
    isMineruTaskProcessedService,
} from '~~/server/services/material/mineruTask.service'

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

import { getTokenForExistingTaskService } from '~~/server/services/material/mineruToken.service'
import { $fetch } from 'ofetch'

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

describe('MinerU 任务服务层', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ==================== createMineruTaskService ====================
    describe('createMineruTaskService', () => {
        it('应委托 DAO 创建任务', async () => {
            vi.mocked(createMineruTaskDao).mockResolvedValue(baseMockTask as any)

            const result = await createMineruTaskService({ ossFileId: 100, userId: 1 })

            expect(createMineruTaskDao).toHaveBeenCalledWith({ ossFileId: 100, userId: 1 }, undefined)
            expect(result).toEqual(baseMockTask)
        })
    })

    // ==================== getMineruTaskByIdService ====================
    describe('getMineruTaskByIdService', () => {
        it('任务不存在时应返回 null', async () => {
            vi.mocked(findMineruTaskByIdDao).mockResolvedValue(null)
            expect(await getMineruTaskByIdService(999)).toBeNull()
        })

        it('应返回任务及文件信息', async () => {
            vi.mocked(findMineruTaskByIdDao).mockResolvedValue(baseMockTask as any)
            mockPrisma.ossFiles.findFirst.mockResolvedValue({
                fileName: 'test.pdf',
                fileSize: BigInt(1024),
            })

            const result = await getMineruTaskByIdService(1)

            expect(result).toMatchObject({
                id: 1,
                fileName: 'test.pdf',
                fileSize: 1024,
            })
        })

        it('文件不存在时 fileName/fileSize 应为 undefined', async () => {
            vi.mocked(findMineruTaskByIdDao).mockResolvedValue(baseMockTask as any)
            mockPrisma.ossFiles.findFirst.mockResolvedValue(null)

            const result = await getMineruTaskByIdService(1)

            expect(result!.fileName).toBeUndefined()
            expect(result!.fileSize).toBeUndefined()
        })
    })

    // ==================== getMineruTaskByTaskIdService ====================
    describe('getMineruTaskByTaskIdService', () => {
        it('应委托 DAO 查询', async () => {
            vi.mocked(findMineruTaskByTaskIdDao).mockResolvedValue(baseMockTask as any)
            const result = await getMineruTaskByTaskIdService('mineru-task-123')
            expect(result).toEqual(baseMockTask)
        })

        it('任务不存在时应返回 null', async () => {
            vi.mocked(findMineruTaskByTaskIdDao).mockResolvedValue(null)
            expect(await getMineruTaskByTaskIdService('nonexistent')).toBeNull()
        })
    })

    // ==================== getMineruTaskByOssFileIdService ====================
    describe('getMineruTaskByOssFileIdService', () => {
        it('应委托 DAO 查询', async () => {
            vi.mocked(findMineruTaskByOssFileIdDao).mockResolvedValue(baseMockTask as any)
            const result = await getMineruTaskByOssFileIdService(100)
            expect(result).toEqual(baseMockTask)
        })

        it('任务不存在时应返回 null', async () => {
            vi.mocked(findMineruTaskByOssFileIdDao).mockResolvedValue(null)
            expect(await getMineruTaskByOssFileIdService(999)).toBeNull()
        })
    })

    // ==================== getMineruTasksService ====================
    describe('getMineruTasksService', () => {
        it('应返回带文件信息的任务列表', async () => {
            vi.mocked(findManyMineruTasksDao).mockResolvedValue({
                list: [baseMockTask as any],
                total: 1,
            })
            mockPrisma.ossFiles.findMany.mockResolvedValue([
                { id: 100, fileName: 'test.pdf', fileSize: BigInt(2048) },
            ])

            const result = await getMineruTasksService()

            expect(result.total).toBe(1)
            expect(result.list[0]!.fileName).toBe('test.pdf')
            expect(result.list[0]!.fileSize).toBe(2048)
        })

        it('文件不存在时字段应为 undefined', async () => {
            vi.mocked(findManyMineruTasksDao).mockResolvedValue({
                list: [baseMockTask as any],
                total: 1,
            })
            mockPrisma.ossFiles.findMany.mockResolvedValue([])

            const result = await getMineruTasksService()

            expect(result.list[0]!.fileName).toBeUndefined()
        })
    })

    // ==================== queryMineruTaskStatusService ====================
    describe('queryMineruTaskStatusService', () => {
        it('任务不存在时应抛出错误', async () => {
            vi.mocked(findMineruTaskByIdDao).mockResolvedValue(null)
            await expect(queryMineruTaskStatusService(999)).rejects.toThrow('任务不存在')
        })

        it('任务已完成时应直接返回', async () => {
            const successTask = { ...baseMockTask, status: MineruTaskStatus.SUCCESS }
            vi.mocked(findMineruTaskByIdDao).mockResolvedValue(successTask as any)
            mockPrisma.ossFiles.findFirst.mockResolvedValue({ fileName: 'test.pdf', fileSize: null })

            const result = await queryMineruTaskStatusService(1)

            expect(result.status).toBe(MineruTaskStatus.SUCCESS)
            expect($fetch).not.toHaveBeenCalled()
        })

        it('没有 taskId 时应抛出错误', async () => {
            const noTaskId = { ...baseMockTask, taskId: null, status: MineruTaskStatus.PROCESSING }
            vi.mocked(findMineruTaskByIdDao).mockResolvedValue(noTaskId as any)
            await expect(queryMineruTaskStatusService(1)).rejects.toThrow('任务尚未提交到 MinerU 服务')
        })

        it('没有可用 Token 时应抛出错误', async () => {
            const processing = { ...baseMockTask, status: MineruTaskStatus.PROCESSING }
            vi.mocked(findMineruTaskByIdDao).mockResolvedValue(processing as any)
            vi.mocked(getTokenForExistingTaskService).mockResolvedValue(null)

            await expect(queryMineruTaskStatusService(1)).rejects.toThrow('没有可用的 MinerU Token')
        })

        it('API 返回 done 时应更新为成功', async () => {
            const processing = { ...baseMockTask, status: MineruTaskStatus.PROCESSING }
            vi.mocked(findMineruTaskByIdDao)
                .mockResolvedValueOnce(processing as any)
                .mockResolvedValueOnce({ ...processing, status: MineruTaskStatus.SUCCESS } as any)
            vi.mocked(getTokenForExistingTaskService).mockResolvedValue('test-token')
            vi.mocked($fetch).mockResolvedValue({
                code: 0,
                msg: 'ok',
                data: { state: 'done', result: { url: 'https://example.com/result.zip' } },
            })
            vi.mocked(updateMineruTaskDao).mockResolvedValue({} as any)
            mockPrisma.ossFiles.findFirst.mockResolvedValue({ fileName: 'test.pdf', fileSize: null })

            await queryMineruTaskStatusService(1)

            expect(updateMineruTaskDao).toHaveBeenCalledWith(1, expect.objectContaining({
                status: MineruTaskStatus.SUCCESS,
            }))
        })

        it('API 返回 failed 时应更新为失败', async () => {
            const processing = { ...baseMockTask, status: MineruTaskStatus.PROCESSING }
            vi.mocked(findMineruTaskByIdDao)
                .mockResolvedValueOnce(processing as any)
                .mockResolvedValueOnce({ ...processing, status: MineruTaskStatus.FAILED } as any)
            vi.mocked(getTokenForExistingTaskService).mockResolvedValue('test-token')
            vi.mocked($fetch).mockResolvedValue({
                code: 0,
                msg: 'ok',
                data: { state: 'failed', err_msg: '转换失败' },
            })
            vi.mocked(updateMineruTaskDao).mockResolvedValue({} as any)
            mockPrisma.ossFiles.findFirst.mockResolvedValue(null)

            await queryMineruTaskStatusService(1)

            expect(updateMineruTaskDao).toHaveBeenCalledWith(1, expect.objectContaining({
                status: MineruTaskStatus.FAILED,
                errorMsg: '转换失败',
            }))
        })

        it('API 返回非零 code 时应抛出错误', async () => {
            const processing = { ...baseMockTask, status: MineruTaskStatus.PROCESSING }
            vi.mocked(findMineruTaskByIdDao).mockResolvedValue(processing as any)
            vi.mocked(getTokenForExistingTaskService).mockResolvedValue('test-token')
            vi.mocked($fetch).mockResolvedValue({ code: 1001, msg: '参数错误' })

            await expect(queryMineruTaskStatusService(1)).rejects.toThrow('参数错误')
        })

        it('应通过 getTokenForExistingTaskService(task) 取 token 并发送 API 请求', async () => {
            const boundTask = {
                ...baseMockTask,
                mineruTokenId: 42,
                status: MineruTaskStatus.PROCESSING,
            }
            vi.mocked(findMineruTaskByIdDao)
                .mockResolvedValueOnce(boundTask as any)
                .mockResolvedValueOnce(boundTask as any)
            vi.mocked(getTokenForExistingTaskService).mockResolvedValue('token-of-id-42')
            vi.mocked($fetch).mockResolvedValue({
                code: 0,
                msg: 'ok',
                data: { state: 'running' },
            })
            vi.mocked(updateMineruTaskDao).mockResolvedValue({} as any)
            mockPrisma.ossFiles.findFirst.mockResolvedValue(null)

            await queryMineruTaskStatusService(1)

            expect(getTokenForExistingTaskService).toHaveBeenCalledWith(boundTask)
            const fetchCall = vi.mocked($fetch).mock.calls[0]
            expect((fetchCall![1] as any).headers.Authorization).toBe('Bearer token-of-id-42')
        })
    })

    // ==================== queryMineruTaskStatusBatchService ====================
    describe('queryMineruTaskStatusBatchService', () => {
        it('任务不存在时应记录失败', async () => {
            vi.mocked(findMineruTasksByIdsDao).mockResolvedValue([])

            const result = await queryMineruTaskStatusBatchService([999])

            expect(result.failed).toBe(1)
            expect(result.results[0]!.error).toBe('任务不存在')
        })

        it('空 ids 数组应返回空结果', async () => {
            vi.mocked(findMineruTasksByIdsDao).mockResolvedValue([])

            const result = await queryMineruTaskStatusBatchService([])
            expect(result.total).toBe(0)
        })
    })

    // ==================== retryMineruTaskService ====================
    describe('retryMineruTaskService', () => {
        it('应抛出不支持后台重试的错误', async () => {
            await expect(retryMineruTaskService(1)).rejects.toThrow('MinerU 任务无法在后台重试')
        })
    })

    // ==================== updateMineruTaskStatusService ====================
    describe('updateMineruTaskStatusService', () => {
        it('应通过 taskId 更新状态', async () => {
            const updated = { ...baseMockTask, status: MineruTaskStatus.SUCCESS }
            vi.mocked(updateMineruTaskByTaskIdDao).mockResolvedValue(updated as any)

            const result = await updateMineruTaskStatusService('mineru-task-123', MineruTaskStatus.SUCCESS)

            expect(updateMineruTaskByTaskIdDao).toHaveBeenCalledWith('mineru-task-123', expect.objectContaining({
                status: MineruTaskStatus.SUCCESS,
            }))
            expect(result!.status).toBe(MineruTaskStatus.SUCCESS)
        })

        it('成功状态应设置 completedAt', async () => {
            vi.mocked(updateMineruTaskByTaskIdDao).mockResolvedValue(baseMockTask as any)

            await updateMineruTaskStatusService('task', MineruTaskStatus.SUCCESS)

            expect(updateMineruTaskByTaskIdDao).toHaveBeenCalledWith('task', expect.objectContaining({
                completedAt: expect.any(Date),
            }))
        })

        it('失败状态应设置 completedAt', async () => {
            vi.mocked(updateMineruTaskByTaskIdDao).mockResolvedValue(baseMockTask as any)

            await updateMineruTaskStatusService('task', MineruTaskStatus.FAILED, undefined, '错误信息')

            expect(updateMineruTaskByTaskIdDao).toHaveBeenCalledWith('task', expect.objectContaining({
                completedAt: expect.any(Date),
                errorMsg: '错误信息',
            }))
        })

        it('处理中状态不应设置 completedAt', async () => {
            vi.mocked(updateMineruTaskByTaskIdDao).mockResolvedValue(baseMockTask as any)

            await updateMineruTaskStatusService('task', MineruTaskStatus.PROCESSING)

            const callArg = vi.mocked(updateMineruTaskByTaskIdDao).mock.calls[0]![1]
            expect(callArg.completedAt).toBeUndefined()
        })

        it('任务不存在时应返回 null', async () => {
            vi.mocked(updateMineruTaskByTaskIdDao).mockResolvedValue(null)
            expect(await updateMineruTaskStatusService('nonexistent', 2)).toBeNull()
        })
    })

    // ==================== updateMineruTaskService ====================
    describe('updateMineruTaskService', () => {
        it('应更新任务', async () => {
            vi.mocked(findMineruTaskByIdDao).mockResolvedValue(baseMockTask as any)
            const updated = { ...baseMockTask, status: MineruTaskStatus.SUCCESS }
            vi.mocked(updateMineruTaskDao).mockResolvedValue(updated as any)

            const result = await updateMineruTaskService(1, { status: MineruTaskStatus.SUCCESS })
            expect(result.status).toBe(MineruTaskStatus.SUCCESS)
        })

        it('任务不存在时应抛出错误', async () => {
            vi.mocked(findMineruTaskByIdDao).mockResolvedValue(null)
            await expect(updateMineruTaskService(999, { status: 2 })).rejects.toThrow('任务不存在')
        })
    })

    // ==================== getPendingMineruTasksService ====================
    describe('getPendingMineruTasksService', () => {
        it('应委托 DAO 查询', async () => {
            vi.mocked(findPendingMineruTasksDao).mockResolvedValue([baseMockTask as any])

            const result = await getPendingMineruTasksService()

            expect(findPendingMineruTasksDao).toHaveBeenCalledWith(100)
            expect(result).toEqual([baseMockTask])
        })

        it('应支持自定义 limit', async () => {
            vi.mocked(findPendingMineruTasksDao).mockResolvedValue([])
            await getPendingMineruTasksService(25)
            expect(findPendingMineruTasksDao).toHaveBeenCalledWith(25)
        })
    })

    // ==================== isMineruTaskProcessedService ====================
    describe('isMineruTaskProcessedService', () => {
        it('任务成功时应返回 true', async () => {
            vi.mocked(findMineruTaskByTaskIdDao).mockResolvedValue({
                ...baseMockTask,
                status: MineruTaskStatus.SUCCESS,
            } as any)
            expect(await isMineruTaskProcessedService('task')).toBe(true)
        })

        it('任务失败时应返回 true', async () => {
            vi.mocked(findMineruTaskByTaskIdDao).mockResolvedValue({
                ...baseMockTask,
                status: MineruTaskStatus.FAILED,
            } as any)
            expect(await isMineruTaskProcessedService('task')).toBe(true)
        })

        it('任务处理中时应返回 false', async () => {
            vi.mocked(findMineruTaskByTaskIdDao).mockResolvedValue({
                ...baseMockTask,
                status: MineruTaskStatus.PROCESSING,
            } as any)
            expect(await isMineruTaskProcessedService('task')).toBe(false)
        })

        it('任务不存在时应返回 false', async () => {
            vi.mocked(findMineruTaskByTaskIdDao).mockResolvedValue(null)
            expect(await isMineruTaskProcessedService('nonexistent')).toBe(false)
        })
    })
})
