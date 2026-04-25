/**
 * Eval runtime guards（独立工具脚本，非 server runtime production code）。
 *
 * 关键设计（附录 A2.2）：使用独立的 ioredis 实例（db=15）而非复用
 * `~~/server/utils/redis` 里的 `getRedisClient()` 单例，避免在 process 内
 * 把进程级共享单例切换到 db=15、污染同进程下的生产代码路径。
 */
import Redis from 'ioredis'

let evalRedis: Redis | null = null

export const EVAL_REDIS_DB = 15

export function getEvalRedisClient(): Redis {
    if (!evalRedis) {
        evalRedis = new Redis({
            host: process.env.REDIS_HOST ?? 'localhost',
            port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
            password: process.env.REDIS_PASSWORD,
            db: EVAL_REDIS_DB,
            lazyConnect: false,
        })
    }
    return evalRedis
}

export async function assertEvalRuntime(): Promise<void> {
    const url = process.env.DATABASE_URL ?? ''
    if (!url.includes('ls_eval')) {
        throw new Error(`[eval] DATABASE_URL 必须包含 'ls_eval'，当前疑似指向生产/测试库`)
    }

    if (!process.env.EVAL_DEEPSEEK_KEY) {
        throw new Error('[eval] 必须设环境变量 EVAL_DEEPSEEK_KEY（DeepSeek API key）')
    }

    // 独立 Redis 实例（db=15，与生产 db=0 物理隔离），ping + 清空
    const redis = getEvalRedisClient()
    try {
        await Promise.race([
            redis.ping(),
            new Promise((_, rej) =>
                setTimeout(() => rej(new Error('redis ping timeout 3s')), 3000),
            ),
        ])
    } catch (e) {
        throw new Error(`[eval] Redis 不可达：${e instanceof Error ? e.message : e}`)
    }
    await redis.flushdb()

    // Prisma client 可连
    const { prisma } = await import('~~/server/utils/db')
    await prisma.$queryRaw`SELECT 1`
}

export async function teardownEvalRuntime(): Promise<void> {
    if (evalRedis) {
        await evalRedis.quit()
        evalRedis = null
    }
}
