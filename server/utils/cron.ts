/**
 * 定时任务工具
 *
 * 提供分布式锁和 Cron 调度器，用于多实例部署下的定时任务管理
 */

import { randomUUID } from 'node:crypto'
import { getRedisClient } from '~~/server/lib/redis'

/** 释放锁的 Lua 脚本：校验 value 后删除，防止误删其他实例的锁 */
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`

/**
 * 使用 Redis 分布式锁执行函数
 *
 * 通过 SET NX EX 原子抢锁，确保多实例环境下同一时刻只有一个实例执行。
 * 锁的 value 为随机 UUID，释放时通过 Lua 脚本校验防止误删。
 *
 * @param lockKey Redis 锁的 key
 * @param ttlSeconds 锁的过期时间（秒）
 * @param fn 需要在锁保护下执行的函数
 * @returns fn 的返回值；未获取到锁或 Redis 异常时返回 null
 */
export async function withDistributedLock<T>(
    lockKey: string,
    ttlSeconds: number,
    fn: () => Promise<T>,
): Promise<T | null> {
    const lockValue = randomUUID()
    let acquired = false

    try {
        const redis = getRedisClient()
        const result = await redis.set(lockKey, lockValue, 'EX', ttlSeconds, 'NX')
        acquired = result === 'OK'
    } catch (error) {
        logger.error(`[${lockKey}] Redis 连接异常，跳过本次执行：`, error)
        return null
    }

    if (!acquired) {
        logger.debug(`[${lockKey}] 锁已被其他实例持有，跳过本次执行`)
        return null
    }

    try {
        return await fn()
    } finally {
        try {
            const redis = getRedisClient()
            await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, lockValue)
        } catch (error) {
            logger.error(`[${lockKey}] 释放锁异常：`, error)
        }
    }
}

/** 定时任务配置 */
export interface CronTask {
    /** 任务名称，同时作为锁 key 前缀（必须唯一） */
    name: string
    /** 执行间隔（毫秒） */
    intervalMs: number
    /** 分布式锁过期时间（秒） */
    lockTtlSeconds: number
    /** 任务执行函数 */
    fn: () => Promise<unknown>
    /** 启动时立即执行一次（默认 false） */
    runImmediately?: boolean
}

/**
 * 定时任务调度器
 *
 * 统一管理所有定时任务，每次执行自动包裹分布式锁。
 * 任务异常只记日志，不影响后续调度。
 */
export class CronScheduler {
    private tasks: CronTask[] = []
    private timers: ReturnType<typeof setInterval>[] = []

    /** 注册定时任务（任务名必须唯一） */
    register(task: CronTask): void {
        if (this.tasks.some((t) => t.name === task.name)) {
            throw new Error(`定时任务名称重复：${task.name}`)
        }
        this.tasks.push(task)
    }

    /** 启动所有已注册的定时任务 */
    start(): void {
        for (const task of this.tasks) {
            const execute = async () => {
                try {
                    const lockKey = `cron:lock:${task.name}`
                    await withDistributedLock(lockKey, task.lockTtlSeconds, task.fn)
                } catch (error) {
                    logger.error(`[${task.name}] 执行异常：`, error)
                }
            }

            if (task.runImmediately) {
                execute()
            }

            const timer = setInterval(execute, task.intervalMs)
            this.timers.push(timer)
        }

        logger.info(`定时任务调度器已启动，注册 ${this.tasks.length} 个任务`)
    }

    /** 停止所有定时任务 */
    shutdown(): void {
        for (const timer of this.timers) {
            clearInterval(timer)
        }
        this.timers = []
        logger.info('定时任务调度器已停止')
    }
}
