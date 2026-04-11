/**
 * 定时任务工具测试
 *
 * 测试分布式锁和调度器的核心逻辑
 *
 * **Feature: cron-scheduler**
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// mock logger 全局变量（Nitro 自动导入）
vi.stubGlobal('logger', {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
})

// mock Redis 客户端
const mockRedisClient = {
    set: vi.fn(),
    eval: vi.fn(),
}

vi.mock('~~/server/lib/redis', () => ({
    getRedisClient: () => mockRedisClient,
}))

// 导入被测模块（mock 生效后再导入）
const { withDistributedLock, CronScheduler } = await import('../../../server/utils/cron')

describe('withDistributedLock', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('抢锁成功时执行 fn 并返回结果', async () => {
        mockRedisClient.set.mockResolvedValue('OK')
        mockRedisClient.eval.mockResolvedValue(1)
        const fn = vi.fn().mockResolvedValue({ data: 42 })
        const result = await withDistributedLock('test-lock', 60, fn)
        expect(fn).toHaveBeenCalledOnce()
        expect(result).toEqual({ data: 42 })
        expect(mockRedisClient.set).toHaveBeenCalledWith('test-lock', expect.any(String), 'EX', 60, 'NX')
    })

    it('抢锁失败时返回 null 且不执行 fn', async () => {
        mockRedisClient.set.mockResolvedValue(null)
        const fn = vi.fn()
        const result = await withDistributedLock('test-lock', 60, fn)
        expect(fn).not.toHaveBeenCalled()
        expect(result).toBeNull()
    })

    it('fn 执行异常时释放锁后重新抛出', async () => {
        mockRedisClient.set.mockResolvedValue('OK')
        mockRedisClient.eval.mockResolvedValue(1)
        const fn = vi.fn().mockRejectedValue(new Error('任务失败'))
        await expect(withDistributedLock('test-lock', 60, fn)).rejects.toThrow('任务失败')
        expect(mockRedisClient.eval).toHaveBeenCalledOnce()
    })

    it('Redis 连接异常时返回 null 且不向上抛出', async () => {
        mockRedisClient.set.mockRejectedValue(new Error('Connection refused'))
        const fn = vi.fn()
        const result = await withDistributedLock('test-lock', 60, fn)
        expect(fn).not.toHaveBeenCalled()
        expect(result).toBeNull()
    })

    it('释放锁时校验 UUID 防止误删', async () => {
        mockRedisClient.set.mockResolvedValue('OK')
        mockRedisClient.eval.mockResolvedValue(1)
        const fn = vi.fn().mockResolvedValue('ok')
        await withDistributedLock('my-key', 30, fn)
        expect(mockRedisClient.eval).toHaveBeenCalledWith(expect.stringContaining('redis.call("get"'), 1, 'my-key', expect.any(String))
        const setUuid = mockRedisClient.set.mock.calls[0][1]
        const evalUuid = mockRedisClient.eval.mock.calls[0][3]
        expect(setUuid).toBe(evalUuid)
    })

    it('释放锁时 Redis 异常不影响 fn 返回值', async () => {
        mockRedisClient.set.mockResolvedValue('OK')
        mockRedisClient.eval.mockRejectedValue(new Error('Redis eval failed'))
        const fn = vi.fn().mockResolvedValue('success')
        const result = await withDistributedLock('test-lock', 60, fn)
        expect(result).toBe('success')
    })
})

describe('CronScheduler', () => {
    let scheduler: InstanceType<typeof CronScheduler>

    beforeEach(() => {
        vi.useFakeTimers()
        vi.clearAllMocks()
        scheduler = new CronScheduler()
        mockRedisClient.set.mockResolvedValue('OK')
        mockRedisClient.eval.mockResolvedValue(1)
    })

    afterEach(() => {
        scheduler.shutdown()
        vi.useRealTimers()
    })

    it('注册并启动任务后按间隔执行', async () => {
        const fn = vi.fn().mockResolvedValue(undefined)
        scheduler.register({ name: 'test-task', intervalMs: 1000, lockTtlSeconds: 10, fn })
        scheduler.start()
        expect(fn).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1000)
        expect(fn).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(1000)
        expect(fn).toHaveBeenCalledTimes(2)
    })

    it('注册重复名称抛出错误', () => {
        const task = { name: 'dup', intervalMs: 1000, lockTtlSeconds: 10, fn: vi.fn().mockResolvedValue(undefined) }
        scheduler.register(task)
        expect(() => scheduler.register(task)).toThrow()
    })

    it('runImmediately 为 true 时启动后立即执行一次', async () => {
        const fn = vi.fn().mockResolvedValue(undefined)
        scheduler.register({ name: 'immediate-task', intervalMs: 60000, lockTtlSeconds: 10, fn, runImmediately: true })
        scheduler.start()
        await vi.advanceTimersByTimeAsync(0)
        expect(fn).toHaveBeenCalledTimes(1)
    })

    it('shutdown 后不再执行任务', async () => {
        const fn = vi.fn().mockResolvedValue(undefined)
        scheduler.register({ name: 'shutdown-task', intervalMs: 1000, lockTtlSeconds: 10, fn })
        scheduler.start()
        await vi.advanceTimersByTimeAsync(1000)
        expect(fn).toHaveBeenCalledTimes(1)
        scheduler.shutdown()
        await vi.advanceTimersByTimeAsync(5000)
        expect(fn).toHaveBeenCalledTimes(1)
    })

    it('任务异常不影响后续调度', async () => {
        const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('ok')
        scheduler.register({ name: 'error-task', intervalMs: 1000, lockTtlSeconds: 10, fn })
        scheduler.start()
        await vi.advanceTimersByTimeAsync(1000)
        expect(fn).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(1000)
        expect(fn).toHaveBeenCalledTimes(2)
    })
})
