/**
 * MinerU 任务状态查询 API 测试 (Unit)
 *
 * 测试 GET /api/v1/recognition/mineru/task/:taskId
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { MineruTaskStatus, DocRecognitionStatus } from '../../../shared/types/recognition'

// 使用 vi.hoisted 创建 mock 对象
const mocks = vi.hoisted(() => {
    return {
        getMineruTaskByTaskIdService: vi.fn(),
        getMineruTaskByIdService: vi.fn(),
        findDocRecognitionByOssFileIdDao: vi.fn(),
        getRouterParams: vi.fn(),
    }
})

// Mock dependencies
const mockUser = {
    id: 1,
    username: 'testuser',
}

// Setup global mocks
vi.stubGlobal('defineEventHandler', (handler: any) => handler)
vi.stubGlobal('getRouterParams', mocks.getRouterParams)
vi.stubGlobal('resError', (event: any, code: number, msg: string) => ({ code, msg, message: msg, success: false }))
vi.stubGlobal('resSuccess', (event: any, msg: string, data: any) => ({ code: 0, msg, message: msg, data, success: true }))
vi.stubGlobal('logger', {
    info: vi.fn(),
    error: vi.fn(),
})

// Mock services using BOTH alias and relative paths
vi.mock('~~/server/services/material/mineruTask.service', () => ({
    getMineruTaskByTaskIdService: mocks.getMineruTaskByTaskIdService,
    getMineruTaskByIdService: mocks.getMineruTaskByIdService,
}))
vi.mock('../../../../server/services/material/mineruTask.service', () => ({
    getMineruTaskByTaskIdService: mocks.getMineruTaskByTaskIdService,
    getMineruTaskByIdService: mocks.getMineruTaskByIdService,
}))

vi.mock('~~/server/services/material/mineru.dao', () => ({
    findDocRecognitionByOssFileIdDao: mocks.findDocRecognitionByOssFileIdDao,
}))
vi.mock('../../../../server/services/material/mineru.dao', () => ({
    findDocRecognitionByOssFileIdDao: mocks.findDocRecognitionByOssFileIdDao,
}))

describe('MinerU 任务状态查询 API (Unit)', () => {
    let taskStatusHandler: any
    let event: any

    beforeAll(async () => {
        // Import the handler
        const handlerModule = await import('../../../../server/api/v1/recognition/mineru/task/[taskId].get')
        taskStatusHandler = handlerModule.default
    })

    beforeEach(() => {
        vi.clearAllMocks()
        event = {
            context: {
                auth: {
                    user: mockUser
                }
            }
        }
    })

    it('应该返回处理中的任务状态 (通过 taskId 字符串查询)', async () => {
        // Arrange
        const taskId = 'task-123'
        mocks.getRouterParams.mockReturnValue({ taskId })

        mocks.getMineruTaskByTaskIdService.mockResolvedValue({
            id: 1,
            taskId: taskId,
            status: MineruTaskStatus.PROCESSING,
            errorMsg: null,
            ossFileId: 100,
        })

        // Act
        const result = await taskStatusHandler(event)

        // Assert
        expect(result.success).toBe(true)
        expect(result.data.taskId).toBe('1')
        expect(result.data.status).toBe(MineruTaskStatus.PROCESSING)
        expect(result.data.recordId).toBeNull()
    })

    it('应该返回处理中的任务状态 (通过 id 数字查询)', async () => {
        // Arrange
        const taskId = '1'
        mocks.getRouterParams.mockReturnValue({ taskId })

        mocks.getMineruTaskByIdService.mockResolvedValue({
            id: 1,
            taskId: 'task-abc',
            status: MineruTaskStatus.PROCESSING,
            errorMsg: null,
            ossFileId: 100,
        })

        // Act
        const result = await taskStatusHandler(event)

        // Assert
        expect(result.success).toBe(true)
        expect(result.data.taskId).toBe('1')
        expect(result.data.status).toBe(MineruTaskStatus.PROCESSING)
    })

    it('应该返回成功的任务状态和识别记录 ID', async () => {
        // Arrange
        const taskId = 'task-success'
        mocks.getRouterParams.mockReturnValue({ taskId })

        mocks.getMineruTaskByTaskIdService.mockResolvedValue({
            id: 2,
            taskId: taskId,
            status: MineruTaskStatus.SUCCESS,
            errorMsg: null,
            ossFileId: 100,
        })

        mocks.findDocRecognitionByOssFileIdDao.mockResolvedValue({
            id: 50,
            status: DocRecognitionStatus.SUCCESS,
        })

        // Act
        const result = await taskStatusHandler(event)

        // Assert
        expect(result.success).toBe(true)
        expect(result.data.taskId).toBe('2')
        expect(result.data.status).toBe(MineruTaskStatus.SUCCESS)
        expect(result.data.recordId).toBe(50)
    })

    it('应该返回失败的任务状态', async () => {
        // Arrange
        const taskId = 'task-failed'
        mocks.getRouterParams.mockReturnValue({ taskId })

        mocks.getMineruTaskByTaskIdService.mockResolvedValue({
            id: 3,
            taskId: taskId,
            status: MineruTaskStatus.FAILED,
            errorMsg: '识别失败',
            ossFileId: 100,
        })

        // Act
        const result = await taskStatusHandler(event)

        // Assert
        expect(result.success).toBe(true)
        expect(result.data.taskId).toBe('3')
        expect(result.data.status).toBe(MineruTaskStatus.FAILED)
        expect(result.data.errorMsg).toBe('识别失败')
    })

    it('应该在任务不存在时返回 404', async () => {
        // Arrange
        const taskId = 'non-existent'
        mocks.getRouterParams.mockReturnValue({ taskId })
        mocks.getMineruTaskByTaskIdService.mockResolvedValue(null)

        // Act
        const result = await taskStatusHandler(event)

        // Assert
        expect(result.code).toBe(404)
        expect(result.msg).toBe('任务不存在')
    })

    it('应该在未登录时返回 401', async () => {
        // Arrange
        event.context.auth = undefined

        // Act
        const result = await taskStatusHandler(event)

        // Assert
        expect(result.code).toBe(401)
    })
})
