/**
 * MinerU 提交 API 测试 (Unit)
 *
 * 测试 POST /api/v1/recognition/mineru/submit
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { MineruTaskStatus } from '../../../shared/types/recognition'

// 使用 vi.hoisted 创建所有需要用于 mock 的对象
const mocks = vi.hoisted(() => {
    return {
        createMineruTaskService: vi.fn(),
        hasActiveTokenService: vi.fn(),
        pickTokenForNewTaskService: vi.fn(),
        prisma: {
            ossFiles: {
                findFirst: vi.fn(),
            },
            mineruTasks: {
                findFirst: vi.fn(),
            }
        },
        readBody: vi.fn(),
        fetch: vi.fn(),
        getRouterParams: vi.fn(),
        // Logger mocks
        loggerInfo: vi.fn(),
        loggerError: vi.fn(),
    }
})

// Mock dependencies
const mockUser = {
    id: 1,
    username: 'testuser',
}

// Setup global mocks
vi.stubGlobal('defineEventHandler', (handler: any) => handler)
vi.stubGlobal('readBody', mocks.readBody)
vi.stubGlobal('resError', (event: any, code: number, msg: string) => ({ code, msg, message: msg, success: false }))
vi.stubGlobal('resSuccess', (event: any, msg: string, data: any) => ({ code: 0, msg, message: msg, data, success: true }))
vi.stubGlobal('$fetch', mocks.fetch)
vi.stubGlobal('useRuntimeConfig', () => ({
    public: { baseUrl: 'http://localhost:3000' }
}))
vi.stubGlobal('logger', {
    info: mocks.loggerInfo,
    error: mocks.loggerError,
})
// Stub global prisma because the handler uses auto-imported prisma
vi.stubGlobal('prisma', mocks.prisma)

// Mock services using BOTH alias and relative paths to ensure resolution works
vi.mock('~~/server/services/material/mineruTask.service', () => ({
    createMineruTaskService: mocks.createMineruTaskService,
}))
vi.mock('../../../server/services/material/mineruTask.service', () => ({
    createMineruTaskService: mocks.createMineruTaskService,
}))

vi.mock('~~/server/services/material/mineruToken.service', () => ({
    hasActiveTokenService: mocks.hasActiveTokenService,
    pickTokenForNewTaskService: mocks.pickTokenForNewTaskService,
}))
vi.mock('../../../server/services/material/mineruToken.service', () => ({
    hasActiveTokenService: mocks.hasActiveTokenService,
    pickTokenForNewTaskService: mocks.pickTokenForNewTaskService,
}))

// Mock Prisma
vi.mock('../../../server/utils/db', () => ({
    prisma: mocks.prisma,
}))

describe('MinerU 提交 API (Unit)', () => {
    let submitHandler: any
    let event: any

    beforeAll(async () => {
        // Import the handler - FIXED path (3 levels up)
        const handlerModule = await import('../../../server/api/v1/recognition/mineru/submit.post')
        submitHandler = handlerModule.default
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

    it('应该成功提交 MinerU 识别任务', async () => {
        // Arrange
        const mockBody = {
            ossFileId: 123,
            fileName: 'test.pdf',
            encrypted: false,
        }
        mocks.readBody.mockResolvedValue(mockBody)

        // Mock Prisma findFirst for ossFile
        mocks.prisma.ossFiles.findFirst.mockResolvedValue({
            id: 123,
            userId: 1,
            fileName: 'test.pdf',
        })

        // Mock Token service
        mocks.hasActiveTokenService.mockResolvedValue(true)
        mocks.pickTokenForNewTaskService.mockResolvedValue({ id: 1, token: 'mock-token' })

        // Mock $fetch for Mineru API
        mocks.fetch.mockResolvedValue({
            code: 0,
            msg: 'success',
            data: {
                batch_id: 'batch-123',
                file_urls: ['http://upload.url'],
            }
        })

        // Mock create task
        mocks.createMineruTaskService.mockResolvedValue({
            id: 100,
            status: MineruTaskStatus.PROCESSING,
        })

        // Act
        const result = await submitHandler(event)

        // Assert
        expect(result.success).toBe(true)
        expect(result.data.taskId).toBe('100')
        expect(result.data.taskStatus).toBe(MineruTaskStatus.PROCESSING)
        expect(result.data.uploadUrl).toBe('http://upload.url')
        expect(result.data.batchId).toBe('batch-123')
    })

    it('应该在文件不存在时返回 404', async () => {
        // Arrange
        const mockBody = { ossFileId: 999, fileName: 'missing.pdf' }
        mocks.readBody.mockResolvedValue(mockBody)
        mocks.prisma.ossFiles.findFirst.mockResolvedValue(null)

        // Act
        const result = await submitHandler(event)
        console.log('Result for 404 test:', JSON.stringify(result, null, 2))

        // Assert
        expect(result.code).toBe(404)
        expect(result.msg).toContain('文件不存在')
    })

    it('应该在未登录时返回 401', async () => {
        // Arrange
        event.context.auth = undefined

        // Act
        const result = await submitHandler(event)
        console.log('Result for 401 test:', JSON.stringify(result, null, 2))

        // Assert
        expect(result.code).toBe(401)
    })

    it('应该在参数缺失时返回 400', async () => {
        // Arrange
        const mockBody = { fileName: 'test.pdf' } // Missing ossFileId
        mocks.readBody.mockResolvedValue(mockBody)

        // Act
        const result = await submitHandler(event)
        console.log('Result for 400 test:', JSON.stringify(result, null, 2))

        // Assert
        expect(result.code).toBe(400)
    })

    it('应该在没有可用 Token 时返回 500', async () => {
        // Arrange
        const mockBody = { ossFileId: 123, fileName: 'test.pdf' }
        mocks.readBody.mockResolvedValue(mockBody)
        mocks.prisma.ossFiles.findFirst.mockResolvedValue({ id: 123 })
        mocks.hasActiveTokenService.mockResolvedValue(false)

        // Act
        const result = await submitHandler(event)
        console.log('Result for 500 test:', JSON.stringify(result, null, 2))

        // Assert
        expect(result.code).toBe(500)
        expect(result.msg).toContain('没有可用的 MinerU Token')
    })
})
