import Redis from 'ioredis'
import pg from 'pg'

// ==================== Redis 连接管理 ====================

/** 从 runtimeConfig 获取 Redis URL */
function getRedisUrl(): string {
  const url = useRuntimeConfig().redis.url
  if (!url) throw new Error('Redis URL 未配置（请设置 NUXT_REDIS_URL 环境变量）')
  return url
}

let redisClient: Redis | null = null
let redisSubscriber: Redis | null = null

/** 获取 Redis 客户端（用于 PUBLISH、XADD 等命令） */
export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(getRedisUrl(), { maxRetriesPerRequest: 3, lazyConnect: true })
    redisClient.on('error', (err) => logger.error('Redis client error:', err))
  }
  return redisClient
}

/** 获取独立的 Redis 订阅客户端（SUBSCRIBE 会独占连接） */
export function getRedisSubscriber(): Redis {
  if (!redisSubscriber) {
    redisSubscriber = new Redis(getRedisUrl(), { maxRetriesPerRequest: 3, lazyConnect: true })
    redisSubscriber.on('error', (err) => logger.error('Redis subscriber error:', err))
  }
  return redisSubscriber
}

/** 创建新的独立订阅连接（用于 SSE 端点，每个客户端一个） */
export function createRedisSubscription(): Redis {
  const sub = new Redis(getRedisUrl(), { maxRetriesPerRequest: 3, lazyConnect: true })
  sub.on('error', (err) => logger.error('Redis subscription error:', err))
  return sub
}

/** 关闭所有 Redis 连接 */
export async function closeRedisConnections(): Promise<void> {
  await Promise.all([
    redisClient?.quit(),
    redisSubscriber?.quit(),
  ])
  redisClient = null
  redisSubscriber = null
}

// ==================== Agent 专用数据库连接池 ====================

let agentPool: pg.Pool | null = null

/** Agent 专用数据库连接池（独立于 Prisma，避免长事务占用业务连接） */
export function getAgentDbPool(): pg.Pool {
  if (!agentPool) {
    const config = useRuntimeConfig()
    const url = config.agent.databaseUrl || process.env.DATABASE_URL
    if (!url) throw new Error('Agent 数据库 URL 未配置（请设置 NUXT_AGENT_DATABASE_URL 或 DATABASE_URL）')
    agentPool = new pg.Pool({ connectionString: url, max: 5 })
    agentPool.on('error', (err) => logger.error('Agent DB pool error:', err))
  }
  return agentPool
}

/** 关闭 Agent 数据库连接池 */
export async function closeAgentDbPool(): Promise<void> {
  await agentPool?.end()
  agentPool = null
}
