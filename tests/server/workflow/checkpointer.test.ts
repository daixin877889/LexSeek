/**
 * LangGraph 检查点器测试
 *
 * 测试 checkpointer.ts 的功能，包括：
 * - getCheckpointer / getStore 单例模式
 * - resetCheckpointer / getCheckpointerStatus
 * - isCheckpointerInitialized
 *
 * **Feature: workflow-checkpointer**
 * **Validates: Requirements 2.1, 2.2, 11.3**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock logger
vi.mock('#shared/utils/logger', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}))

// Mock PostgresSaver 和 PostgresStore - 保持引用以便测试中访问
const mockCp = { setup: vi.fn().mockResolvedValue(undefined) }
const mockStoreObj = { setup: vi.fn().mockResolvedValue(undefined) }
const mockFromConnStringCp = vi.fn(() => mockCp)
const mockFromConnStringStore = vi.fn(() => mockStoreObj)
vi.mock('@langchain/langgraph-checkpoint-postgres', () => ({
    PostgresSaver: {
        fromConnString: mockFromConnStringCp,
    },
}))
vi.mock('@langchain/langgraph-checkpoint-postgres/store', () => ({
    PostgresStore: {
        fromConnString: mockFromConnStringStore,
    },
}))

const TEST_DB_URL = 'postgresql://test:test@localhost:5432/test'

describe('LangGraph 检查点器', () => {
    beforeEach(() => {
        process.env.DATABASE_URL = TEST_DB_URL
        vi.clearAllMocks()
        // 重置 fromConnString 的默认返回值
        mockFromConnStringCp.mockReturnValue(mockCp)
        mockFromConnStringStore.mockReturnValue(mockStoreObj)
    })

    describe('DATABASE_URL 验证', () => {
        it('DATABASE_URL 未设置时应抛出错误', async () => {
            delete process.env.DATABASE_URL
            vi.resetModules()

            const { getCheckpointer, resetCheckpointer } = await import('../../../server/services/workflow/checkpointer')
            resetCheckpointer()

            await expect(getCheckpointer()).rejects.toThrow('DATABASE_URL 环境变量未设置')
        })
    })

    describe('单例模式 - getCheckpointer', () => {
        it('首次调用应初始化检查点器', async () => {
            const { getCheckpointer, resetCheckpointer } = await import('../../../server/services/workflow/checkpointer')
            resetCheckpointer()

            const checkpointer = await getCheckpointer()
            expect(checkpointer).toBeDefined()
            expect(checkpointer).toHaveProperty('setup')
        })

        it('多次调用应返回同一实例', async () => {
            const { getCheckpointer, resetCheckpointer } = await import('../../../server/services/workflow/checkpointer')
            resetCheckpointer()

            const instance1 = await getCheckpointer()
            const instance2 = await getCheckpointer()
            expect(instance1).toBe(instance2)
        })

        it('重置后应创建新实例', async () => {
            const cp1 = { setup: vi.fn().mockResolvedValue(undefined) }
            const cp2 = { setup: vi.fn().mockResolvedValue(undefined) }
            mockFromConnStringCp.mockReturnValueOnce(cp1)
            mockFromConnStringCp.mockReturnValueOnce(cp2)

            const { getCheckpointer, resetCheckpointer } = await import('../../../server/services/workflow/checkpointer')
            resetCheckpointer()
            const instance1 = await getCheckpointer()
            resetCheckpointer()
            const instance2 = await getCheckpointer()

            expect(instance1).not.toBe(instance2)
        })
    })

    describe('单例模式 - getStore', () => {
        it('首次调用应初始化 store', async () => {
            const { getStore, resetCheckpointer } = await import('../../../server/services/workflow/checkpointer')
            resetCheckpointer()

            const store = await getStore()
            expect(store).toBeDefined()
            expect(store).toHaveProperty('setup')
            expect(mockFromConnStringStore).toHaveBeenCalled()
        })

        it('多次调用应返回同一实例', async () => {
            const { getStore, resetCheckpointer } = await import('../../../server/services/workflow/checkpointer')
            resetCheckpointer()

            const instance1 = await getStore()
            const instance2 = await getStore()
            expect(instance1).toBe(instance2)
        })
    })

    describe('状态查询', () => {
        it('getCheckpointerStatus 应返回正确状态', async () => {
            const { getCheckpointerStatus, getCheckpointer, resetCheckpointer } = await import('../../../server/services/workflow/checkpointer')
            resetCheckpointer()

            // 初始状态
            let status = getCheckpointerStatus()
            expect(status.initialized).toBe(false)
            expect(status.hasInstance).toBe(false)

            // 初始化后
            await getCheckpointer()
            status = getCheckpointerStatus()
            expect(status.initialized).toBe(true)
            expect(status.hasInstance).toBe(true)
        })

        it('isCheckpointerInitialized 应正确反映状态', async () => {
            const { isCheckpointerInitialized, getCheckpointer, resetCheckpointer } = await import('../../../server/services/workflow/checkpointer')
            resetCheckpointer()

            // 初始状态
            expect(isCheckpointerInitialized()).toBe(false)

            // 初始化后
            await getCheckpointer()
            expect(isCheckpointerInitialized()).toBe(true)

            // 重置后
            resetCheckpointer()
            expect(isCheckpointerInitialized()).toBe(false)
        })
    })

    describe('错误处理', () => {
        it('初始化失败时应抛出错误', async () => {
            mockFromConnStringCp.mockReturnValueOnce({
                setup: vi.fn().mockRejectedValue(new Error('Database connection failed')),
            })

            const { getCheckpointer, resetCheckpointer } = await import('../../../server/services/workflow/checkpointer')
            resetCheckpointer()

            await expect(getCheckpointer()).rejects.toThrow()
        })
    })
})
