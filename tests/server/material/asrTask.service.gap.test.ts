/**
 * ASR 任务服务层补充覆盖测试
 *
 * 补齐 server/services/material/asrTask.service.ts 未覆盖行：
 * - queryAsrTaskStatusService：PENDING/RUNNING、FAILED 分支，
 *   以及 API 调用成功后的二次查询与 fileNames 读取路径
 * - retryAsrTaskService：完整重试成功流程（包含 updateAsrRecords 和 fileNames）
 * - queryAsrTaskStatusBatchService：状态发生变化的 changed++ 统计
 * - queryAsrTaskStatusService：output 为空与未知状态码（default 分支）
 *
 * **Feature: asr-task-service-gap-coverage**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AsrTaskStatus } from '#shared/types/recognition'

// Mock logger
vi.stubGlobal('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
vi.stubGlobal('AsrTaskStatus', AsrTaskStatus)

// Mock prisma（只有 asrRecords / ossFiles 会被 service 直接调用）
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

// Mock DAO
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

// Mock node service
vi.mock('~~/server/services/node/node.service', () => ({
    getValidNodeConfig: vi.fn(),
    getNodeConfigService: vi.fn(),
}))

// Mock ofetch
vi.mock('ofetch', () => ({
    $fetch: vi.fn(),
}))

import {
    queryAsrTaskStatusService,
    queryAsrTaskStatusBatchService,
    retryAsrTaskService,
    getAsrTaskByIdService,
    getAsrTasksService,
} from '~~/server/services/material/asrTask.service'

import {
    createAsrTaskDao,
    findAsrTaskByIdDao,
    findAsrTasksByIdsDao,
    findManyAsrTasksDao,
    updateAsrTaskDao,
} from '~~/server/services/material/asrTask.dao'

import { getValidNodeConfig } from '~~/server/services/node/node.service'
import { $fetch } from 'ofetch'

const baseMockTask = {
    id: 1,
    taskId: 'task-gap-001',
    status: AsrTaskStatus.PROCESSING,
    taskRawData: {},
    result: {},
    isEncrypted: false,
    retrySourceId: null,
    supersededById: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
}

const baseNodeConfig = {
    modelApiKeys: [{ apiKey: 'test-api-key' }],
    modelProviderBaseUrl: 'https://api.example.com',
    modelName: 'paraformer-v2',
} as any

describe('ASR 任务服务层 - 补充覆盖', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('queryAsrTaskStatusService - 状态分支', () => {
        it('API 返回 PENDING 时应保持 PROCESSING 状态并回读任务', async () => {
            const processingTask = { ...baseMockTask, status: AsrTaskStatus.PROCESSING }
            // 第一次 findAsrTaskByIdDao 返回原任务，第二次返回更新后的任务
            vi.mocked(findAsrTaskByIdDao)
                .mockResolvedValueOnce(processingTask as any)
                .mockResolvedValueOnce(processingTask as any)
            vi.mocked(getValidNodeConfig).mockResolvedValue(baseNodeConfig)
            vi.mocked($fetch).mockResolvedValue({
                output: { task_id: 'task-gap-001', task_status: 'PENDING', results: [] },
            })
            vi.mocked(updateAsrTaskDao).mockResolvedValue({} as any)
            mockPrisma.asrRecords.findMany.mockResolvedValue([
                { id: 10, ossFileId: 200 },
            ])
            mockPrisma.ossFiles.findMany.mockResolvedValue([{ fileName: 'a.mp3' }])

            const result = await queryAsrTaskStatusService(1)
            expect(result.status).toBe(AsrTaskStatus.PROCESSING)
            expect(result.fileNames).toEqual(['a.mp3'])
            expect(result.recordCount).toBe(1)
        })

        it('API 返回 RUNNING 时应更新为 PROCESSING', async () => {
            const pendingTask = { ...baseMockTask, status: AsrTaskStatus.PENDING }
            vi.mocked(findAsrTaskByIdDao)
                .mockResolvedValueOnce(pendingTask as any)
                .mockResolvedValueOnce({ ...pendingTask, status: AsrTaskStatus.PROCESSING } as any)
            vi.mocked(getValidNodeConfig).mockResolvedValue(baseNodeConfig)
            vi.mocked($fetch).mockResolvedValue({
                output: { task_id: 'task-gap-001', task_status: 'RUNNING', results: [] },
            })
            vi.mocked(updateAsrTaskDao).mockResolvedValue({} as any)
            mockPrisma.asrRecords.findMany.mockResolvedValue([])

            await queryAsrTaskStatusService(1)
            expect(updateAsrTaskDao).toHaveBeenCalledWith(1, expect.objectContaining({
                status: AsrTaskStatus.PROCESSING,
            }))
        })

        it('API 返回 FAILED 时应更新为失败并带 result', async () => {
            const processingTask = { ...baseMockTask, status: AsrTaskStatus.PROCESSING }
            vi.mocked(findAsrTaskByIdDao)
                .mockResolvedValueOnce(processingTask as any)
                .mockResolvedValueOnce({ ...processingTask, status: AsrTaskStatus.FAILED } as any)
            vi.mocked(getValidNodeConfig).mockResolvedValue(baseNodeConfig)
            const failedOutput = { task_id: 'task-gap-001', task_status: 'FAILED', results: [] }
            vi.mocked($fetch).mockResolvedValue({ output: failedOutput })
            vi.mocked(updateAsrTaskDao).mockResolvedValue({} as any)
            mockPrisma.asrRecords.findMany.mockResolvedValue([])

            const result = await queryAsrTaskStatusService(1)
            expect(result.status).toBe(AsrTaskStatus.FAILED)
            expect(updateAsrTaskDao).toHaveBeenCalledWith(1, expect.objectContaining({
                status: AsrTaskStatus.FAILED,
                result: failedOutput,
            }))
        })

        it('API 返回 UNKNOWN 时应更新为失败', async () => {
            const processingTask = { ...baseMockTask, status: AsrTaskStatus.PROCESSING }
            vi.mocked(findAsrTaskByIdDao)
                .mockResolvedValueOnce(processingTask as any)
                .mockResolvedValueOnce({ ...processingTask, status: AsrTaskStatus.FAILED } as any)
            vi.mocked(getValidNodeConfig).mockResolvedValue(baseNodeConfig)
            vi.mocked($fetch).mockResolvedValue({
                output: { task_id: 'task-gap-001', task_status: 'UNKNOWN', results: [] },
            })
            vi.mocked(updateAsrTaskDao).mockResolvedValue({} as any)
            mockPrisma.asrRecords.findMany.mockResolvedValue([])

            const result = await queryAsrTaskStatusService(1)
            expect(result.status).toBe(AsrTaskStatus.FAILED)
        })

        it('output 为空时应抛错', async () => {
            const processingTask = { ...baseMockTask, status: AsrTaskStatus.PROCESSING }
            vi.mocked(findAsrTaskByIdDao).mockResolvedValue(processingTask as any)
            vi.mocked(getValidNodeConfig).mockResolvedValue(baseNodeConfig)
            vi.mocked($fetch).mockResolvedValue({ output: undefined })

            await expect(queryAsrTaskStatusService(1)).rejects.toThrow('查询结果为空')
        })

        it('未知 task_status 时不更新且不修改任务状态', async () => {
            // status 不在 PENDING/RUNNING/SUCCEEDED/FAILED/UNKNOWN 范围内
            const processingTask = { ...baseMockTask, status: AsrTaskStatus.PROCESSING }
            vi.mocked(findAsrTaskByIdDao)
                .mockResolvedValueOnce(processingTask as any)
                .mockResolvedValueOnce(processingTask as any)
            vi.mocked(getValidNodeConfig).mockResolvedValue(baseNodeConfig)
            vi.mocked($fetch).mockResolvedValue({
                output: { task_id: 'task-gap-001', task_status: 'QUEUED', results: [] },
            })
            mockPrisma.asrRecords.findMany.mockResolvedValue([])

            const result = await queryAsrTaskStatusService(1)
            // 没有调用 updateAsrTaskDao（状态未变化且 updateData 为空）
            expect(updateAsrTaskDao).not.toHaveBeenCalled()
            expect(result.status).toBe(AsrTaskStatus.PROCESSING)
        })

        it('已完成任务直接返回时应附带文件名', async () => {
            const successTask = { ...baseMockTask, status: AsrTaskStatus.SUCCESS }
            vi.mocked(findAsrTaskByIdDao).mockResolvedValue(successTask as any)
            mockPrisma.asrRecords.findMany.mockResolvedValue([
                { id: 10, ossFileId: 200 },
                { id: 11, ossFileId: 201 },
            ])
            mockPrisma.ossFiles.findMany.mockResolvedValue([
                { fileName: 'done1.mp3' },
                { fileName: 'done2.mp3' },
            ])

            const result = await queryAsrTaskStatusService(1)
            expect(result.status).toBe(AsrTaskStatus.SUCCESS)
            expect(result.fileNames).toEqual(['done1.mp3', 'done2.mp3'])
            expect(result.recordCount).toBe(2)
        })
    })

    describe('queryAsrTaskStatusBatchService - changed 统计', () => {
        it('状态发生变化时应计入 changed', async () => {
            const processingTask = { ...baseMockTask, status: AsrTaskStatus.PROCESSING }
            vi.mocked(findAsrTasksByIdsDao).mockResolvedValue([processingTask as any])
            // queryAsrTaskStatusService 内部：第一次读原状态 PROCESSING，之后读为 SUCCESS
            vi.mocked(findAsrTaskByIdDao)
                .mockResolvedValueOnce(processingTask as any)
                .mockResolvedValueOnce({ ...processingTask, status: AsrTaskStatus.SUCCESS } as any)
            vi.mocked(getValidNodeConfig).mockResolvedValue(baseNodeConfig)
            vi.mocked($fetch).mockResolvedValue({
                output: { task_id: 'task-gap-001', task_status: 'SUCCEEDED', results: [] },
            })
            vi.mocked(updateAsrTaskDao).mockResolvedValue({} as any)
            mockPrisma.asrRecords.findMany.mockResolvedValue([])

            const result = await queryAsrTaskStatusBatchService([1])
            expect(result.changed).toBe(1)
            expect(result.success).toBe(1)
            expect(result.results[0]!.changed).toBe(true)
        })

        it('查询抛错时应计入 failed 并记录错误信息', async () => {
            const processingTask = { ...baseMockTask, status: AsrTaskStatus.PROCESSING }
            vi.mocked(findAsrTasksByIdsDao).mockResolvedValue([processingTask as any])
            vi.mocked(findAsrTaskByIdDao).mockResolvedValue(processingTask as any)
            vi.mocked(getValidNodeConfig).mockResolvedValue(baseNodeConfig)
            vi.mocked($fetch).mockRejectedValue(new Error('网络错误'))

            const result = await queryAsrTaskStatusBatchService([1])
            expect(result.failed).toBe(1)
            expect(result.results[0]!.error).toBe('网络错误')
        })

        it('非 Error 对象抛出时应使用默认错误信息', async () => {
            const processingTask = { ...baseMockTask, status: AsrTaskStatus.PROCESSING }
            vi.mocked(findAsrTasksByIdsDao).mockResolvedValue([processingTask as any])
            vi.mocked(findAsrTaskByIdDao).mockResolvedValue(processingTask as any)
            vi.mocked(getValidNodeConfig).mockResolvedValue(baseNodeConfig)
            // 抛出一个字符串（非 Error）
            vi.mocked($fetch).mockRejectedValue('plain string error')

            const result = await queryAsrTaskStatusBatchService([1])
            expect(result.failed).toBe(1)
            expect(result.results[0]!.error).toBe('查询失败')
        })
    })

    describe('retryAsrTaskService - 完整成功路径', () => {
        it('应提交新任务、更新旧任务并同步 asrRecords / 返回文件名', async () => {
            const failedTask = {
                ...baseMockTask,
                status: AsrTaskStatus.FAILED,
                isEncrypted: false,
                taskRawData: { retryCount: 2, originalUrl: 'old' },
            }
            vi.mocked(findAsrTaskByIdDao).mockResolvedValue(failedTask as any)
            vi.mocked(getValidNodeConfig).mockResolvedValue(baseNodeConfig)
            mockPrisma.asrRecords.findMany.mockResolvedValue([
                { id: 10, ossFileId: 200, audioUrl: 'https://a.mp3' },
                { id: 11, ossFileId: 201, audioUrl: 'https://b.mp3' },
            ])
            vi.mocked($fetch).mockResolvedValue({
                request_id: 'req-001',
                output: { task_id: 'new-task-123', task_status: 'PENDING' },
            } as any)
            const newTask = { ...baseMockTask, id: 999, taskId: 'new-task-123', status: AsrTaskStatus.PROCESSING }
            vi.mocked(createAsrTaskDao).mockResolvedValue(newTask as any)
            vi.mocked(updateAsrTaskDao).mockResolvedValue({} as any)
            mockPrisma.asrRecords.updateMany.mockResolvedValue({ count: 2 })
            mockPrisma.ossFiles.findMany.mockResolvedValue([
                { fileName: 'a.mp3' },
                { fileName: 'b.mp3' },
            ])

            const result = await retryAsrTaskService(1)

            // 验证提交请求
            expect($fetch).toHaveBeenCalledWith(
                'https://api.example.com/services/audio/asr/transcription',
                expect.objectContaining({
                    method: 'POST',
                    body: expect.objectContaining({
                        input: { file_urls: ['https://a.mp3', 'https://b.mp3'] },
                    }),
                }),
            )
            // 验证创建新任务，retryCount 递增到 3
            expect(createAsrTaskDao).toHaveBeenCalledWith(
                expect.objectContaining({
                    taskId: 'new-task-123',
                    retrySourceId: 1,
                    taskRawData: expect.objectContaining({ retryCount: 3 }),
                    isEncrypted: false,
                }),
                undefined,
            )
            // 验证旧任务被标记 SUPERSEDED
            expect(updateAsrTaskDao).toHaveBeenCalledWith(1, {
                status: AsrTaskStatus.SUPERSEDED,
                supersededById: 999,
            })
            // 验证 asrRecords 批量更新到新任务
            expect(mockPrisma.asrRecords.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { asrTasksId: 1, deletedAt: null },
                data: expect.objectContaining({
                    status: AsrTaskStatus.PROCESSING,
                    asrTasksId: 999,
                }),
            }))
            expect(result.id).toBe(999)
            expect(result.fileNames).toEqual(['a.mp3', 'b.mp3'])
            expect(result.recordCount).toBe(2)
        })

        it('已被替代 SUPERSEDED 状态也可重试', async () => {
            const supersededTask = {
                ...baseMockTask,
                status: AsrTaskStatus.SUPERSEDED,
                isEncrypted: false,
                taskRawData: {},
            }
            vi.mocked(findAsrTaskByIdDao).mockResolvedValue(supersededTask as any)
            vi.mocked(getValidNodeConfig).mockResolvedValue(baseNodeConfig)
            mockPrisma.asrRecords.findMany.mockResolvedValue([
                { id: 10, ossFileId: 200, audioUrl: 'https://x.mp3' },
            ])
            vi.mocked($fetch).mockResolvedValue({
                output: { task_id: 'new-task-222', task_status: 'PENDING' },
            } as any)
            vi.mocked(createAsrTaskDao).mockResolvedValue({
                ...baseMockTask, id: 888, taskId: 'new-task-222',
            } as any)
            vi.mocked(updateAsrTaskDao).mockResolvedValue({} as any)
            mockPrisma.asrRecords.updateMany.mockResolvedValue({ count: 1 })
            mockPrisma.ossFiles.findMany.mockResolvedValue([{ fileName: 'x.mp3' }])

            const result = await retryAsrTaskService(1)
            expect(result.id).toBe(888)
        })

        it('ASR 接口返回错误码时应抛错', async () => {
            const failedTask = { ...baseMockTask, status: AsrTaskStatus.FAILED, isEncrypted: false }
            vi.mocked(findAsrTaskByIdDao).mockResolvedValue(failedTask as any)
            vi.mocked(getValidNodeConfig).mockResolvedValue(baseNodeConfig)
            mockPrisma.asrRecords.findMany.mockResolvedValue([
                { id: 10, ossFileId: 200, audioUrl: 'https://x.mp3' },
            ])
            vi.mocked($fetch).mockResolvedValue({
                code: 'InvalidApiKey',
                message: 'API key 无效',
            } as any)

            await expect(retryAsrTaskService(1)).rejects.toThrow('API key 无效')
        })

        it('ASR 接口错误码无 message 时使用默认提示', async () => {
            const failedTask = { ...baseMockTask, status: AsrTaskStatus.FAILED, isEncrypted: false }
            vi.mocked(findAsrTaskByIdDao).mockResolvedValue(failedTask as any)
            vi.mocked(getValidNodeConfig).mockResolvedValue(baseNodeConfig)
            mockPrisma.asrRecords.findMany.mockResolvedValue([
                { id: 10, ossFileId: 200, audioUrl: 'https://x.mp3' },
            ])
            vi.mocked($fetch).mockResolvedValue({ code: 'Err' } as any)

            await expect(retryAsrTaskService(1)).rejects.toThrow('重新提交任务失败')
        })

        it('未获取到 task_id 时应抛错', async () => {
            const failedTask = { ...baseMockTask, status: AsrTaskStatus.FAILED, isEncrypted: false }
            vi.mocked(findAsrTaskByIdDao).mockResolvedValue(failedTask as any)
            vi.mocked(getValidNodeConfig).mockResolvedValue(baseNodeConfig)
            mockPrisma.asrRecords.findMany.mockResolvedValue([
                { id: 10, ossFileId: 200, audioUrl: 'https://x.mp3' },
            ])
            // output 没有 task_id
            vi.mocked($fetch).mockResolvedValue({
                output: { task_status: 'PENDING' },
            } as any)

            await expect(retryAsrTaskService(1)).rejects.toThrow('未获取到新的任务ID')
        })
    })

    describe('getAsrTaskByIdService - fileNames', () => {
        it('应返回 fileNames 列表', async () => {
            vi.mocked(findAsrTaskByIdDao).mockResolvedValue(baseMockTask as any)
            mockPrisma.asrRecords.findMany.mockResolvedValue([
                { id: 10, ossFileId: 200 },
            ])
            mockPrisma.ossFiles.findMany.mockResolvedValue([{ fileName: 'a.mp3' }])

            const result = await getAsrTaskByIdService(1)
            expect(result?.fileNames).toEqual(['a.mp3'])
        })
    })

    describe('getAsrTasksService - 多条任务计数', () => {
        it('应根据 groupBy 结果填入各任务的 recordCount', async () => {
            const t1 = { ...baseMockTask, id: 10 }
            const t2 = { ...baseMockTask, id: 11 }
            vi.mocked(findManyAsrTasksDao).mockResolvedValue({
                list: [t1, t2] as any,
                total: 2,
            })
            mockPrisma.asrRecords.groupBy.mockResolvedValue([
                { asrTasksId: 10, _count: { id: 3 } },
                { asrTasksId: 11, _count: { id: 1 } },
            ])

            const result = await getAsrTasksService({ page: 1, pageSize: 10 })
            expect(result.list[0]!.recordCount).toBe(3)
            expect(result.list[1]!.recordCount).toBe(1)
        })
    })
})
