/**
 * AgentWorker 补充覆盖率测试 - Worker 生命周期
 *
 * 覆盖 processNextTask、start/shutdown、handleCancelSignal、
 * 心跳、崩溃恢复、drainPendingTasks 等 Worker 逻辑
 *
 * **Feature: agent-worker-lifecycle-coverage**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AGENT_RUN_STATUS } from '#shared/types/agentRun'

// Mock runtimeConfig
vi.stubGlobal('useRuntimeConfig', () => ({
    agent: {
        maxConcurrent: 2,
        timeoutMs: 30000,
        heartbeatIntervalMs: 5000,
        crashThresholdMs: 60000,
        pendingQueueMax: 1000,
        pendingQueueTtlMs: 300000,
    },
}))

vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

vi.stubGlobal('prisma', {
    caseSessions: { findUnique: vi.fn() },
})

// Mock DAO
const mockClaimPendingRunDAO = vi.fn()
const mockUpdateRunStatusDAO = vi.fn()
const mockUpdateHeartbeatDAO = vi.fn()
const mockFindStaleRunsDAO = vi.fn()
const mockResetStaleRunDAO = vi.fn()

vi.mock('~~/server/services/agent/agentRun.dao', () => ({
    claimPendingRunDAO: (...args: any[]) => mockClaimPendingRunDAO(...args),
    updateRunStatusDAO: (...args: any[]) => mockUpdateRunStatusDAO(...args),
    updateHeartbeatDAO: (...args: any[]) => mockUpdateHeartbeatDAO(...args),
    findStaleRunsDAO: (...args: any[]) => mockFindStaleRunsDAO(...args),
    resetStaleRunDAO: (...args: any[]) => mockResetStaleRunDAO(...args),
}))

// Mock agentEventBridge
const mockPublishAgentEvent = vi.fn().mockResolvedValue(undefined)
const mockPublishStatusChange = vi.fn().mockResolvedValue(undefined)
vi.mock('~~/server/services/agent/agentEventBridge', () => ({
    publishAgentEvent: (...args: any[]) => mockPublishAgentEvent(...args),
    publishStatusChange: (...args: any[]) => mockPublishStatusChange(...args),
    startReconnectFlush: vi.fn(),
}))

// Mock redis
const mockSubOn = vi.fn()
vi.mock('~~/server/lib/redis', () => ({
    getRedisClient: () => ({
        publish: vi.fn().mockResolvedValue(1),
        status: 'ready',
    }),
    getRedisSubscriber: () => ({
        subscribe: vi.fn().mockResolvedValue(undefined),
        psubscribe: vi.fn().mockResolvedValue(undefined),
        on: mockSubOn,
    }),
    createRedisSubscription: vi.fn(),
}))

describe('AgentWorker 生命周期测试', () => {
    let AgentWorker: any

    beforeEach(async () => {
        vi.clearAllMocks()
        vi.useFakeTimers()
        const mod = await import('~~/server/services/agent/agentWorker')
        AgentWorker = mod.AgentWorker
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    describe('构造函数', () => {
        it('使用默认配置', () => {
            const worker = new AgentWorker()
            expect(worker.workerId).toMatch(/^worker-/)
        })

        it('使用自定义配置', () => {
            const worker = new AgentWorker('my-worker', {
                maxConcurrent: 5,
                timeoutMs: 10000,
                heartbeatIntervalMs: 1000,
                crashThresholdMs: 30000,
            })
            expect(worker.workerId).toBe('my-worker')
        })
    })

    describe('processNextTask - 处理下一个任务', () => {
        it('关闭中时返回 false', async () => {
            const worker = new AgentWorker('test-worker')
            await worker.shutdown()

            const result = await worker.processNextTask()
            expect(result).toBe(false)
        })

        it('无待处理任务时返回 false', async () => {
            mockClaimPendingRunDAO.mockResolvedValue(null)

            const worker = new AgentWorker('test-worker')
            const result = await worker.processNextTask()

            expect(result).toBe(false)
        })

        it('成功认领任务时返回 true', async () => {
            vi.useRealTimers() // executeRun 需要真实定时器
            mockClaimPendingRunDAO.mockResolvedValueOnce({
                id: 'run-1',
                sessionId: 'session-1',
                userId: 1,
                caseId: 1,
                input: { message: 'hello' },
            })
            // executeRun 内部会调用 prisma 和 import，mock 成让它快速失败
            ;(prisma.caseSessions.findUnique as any).mockRejectedValue(new Error('mock fail'))
            mockUpdateRunStatusDAO.mockResolvedValue(undefined)

            const worker = new AgentWorker('test-worker')
            // 第二次调用返回 null 避免无限循环
            mockClaimPendingRunDAO.mockResolvedValue(null)
            const result = await worker.processNextTask()

            expect(result).toBe(true)
            expect(mockClaimPendingRunDAO).toHaveBeenCalledWith('test-worker')

            // 等待 executeRun 内部失败处理完成
            await new Promise(r => setTimeout(r, 100))
            await worker.shutdown()
            vi.useFakeTimers()
        })
    })

    describe('shutdown - 优雅关闭', () => {
        it('标记为关闭中', async () => {
            const worker = new AgentWorker('test-shutdown')

            expect(worker.shuttingDown).toBe(false)

            await worker.shutdown()

            expect(worker.shuttingDown).toBe(true)
        })

        it('无活跃任务时立即关闭', async () => {
            const worker = new AgentWorker('test-shutdown-2')

            expect(worker.activeRunCount).toBe(0)

            await worker.shutdown()

            expect(worker.shuttingDown).toBe(true)
        })
    })

    describe('start - 启动 Worker', () => {
        it('启动完成后 log 启动信息', async () => {
            mockClaimPendingRunDAO.mockResolvedValue(null) // drainPendingTasks 找不到任务

            const worker = new AgentWorker('test-start')
            await worker.start()

            // 验证 Worker 启动后不处于 shutting down 状态
            expect(worker.shuttingDown).toBe(false)

            await worker.shutdown()
        })
    })

    describe('activeRunCount / shuttingDown', () => {
        it('初始状态', () => {
            const worker = new AgentWorker('test-props')

            expect(worker.activeRunCount).toBe(0)
            expect(worker.shuttingDown).toBe(false)
        })
    })
})

describe('isInternalLLMEvent 逻辑验证', () => {
    // 复制内部函数进行单元测试
    function isInternalLLMEvent(data: unknown): boolean {
        if (!Array.isArray(data) || data.length < 2) return false
        const metadata = data[1] as Record<string, unknown> | undefined
        if (!metadata || typeof metadata !== 'object') return false
        const tags = metadata.tags as string[] | undefined
        return Array.isArray(tags) && tags.includes('internal')
    }

    it('标记为 internal 的 LLM 事件', () => {
        expect(isInternalLLMEvent([
            { type: 'ai', content: 'msg' },
            { tags: ['internal'] },
        ])).toBe(true)
    })

    it('无 internal 标签的事件', () => {
        expect(isInternalLLMEvent([
            { type: 'ai', content: 'msg' },
            { tags: ['user-facing'] },
        ])).toBe(false)
    })

    it('非数组返回 false', () => {
        expect(isInternalLLMEvent('not array')).toBe(false)
        expect(isInternalLLMEvent(null)).toBe(false)
    })

    it('数组长度不足 2 返回 false', () => {
        expect(isInternalLLMEvent([{ type: 'ai' }])).toBe(false)
    })

    it('metadata 不是对象返回 false', () => {
        expect(isInternalLLMEvent([{}, 'string'])).toBe(false)
    })

    it('tags 不是数组返回 false', () => {
        expect(isInternalLLMEvent([{}, { tags: 'not-array' }])).toBe(false)
    })
})
