/**
 * 跨进程缓存失效总线
 *
 * 通过 Redis pub/sub 频道 cache:invalidate 广播缓存失效通知，解决多实例部署下
 * 进程级内存缓存「失效只清一台」的一致性问题。缓存数据本身不进 Redis，本总线
 * 只承载失效通知；各缓存另带兜底 TTL，广播丢失也能自愈。
 *
 * @see docs/superpowers/specs/2026-05-19-cache-invalidation-design.md
 */
import { getRedisClient, getCacheBusSubscriber } from '~~/server/lib/redis'

/** pub/sub 频道名 */
export const CACHE_INVALIDATION_CHANNEL = 'cache:invalidate'

/** 已接入总线的缓存标识 */
export const CACHE_NAMES = {
  NODE_CONFIG: 'nodeConfig',
  FILESYSTEM_BACKEND: 'filesystemBackend',
  RBAC_USER_PERMISSION: 'rbacUserPermission',
  RBAC_PUBLIC_API: 'rbacPublicApi',
} as const

export type CacheName = (typeof CACHE_NAMES)[keyof typeof CACHE_NAMES]

/** 失效消息体 */
export interface CacheInvalidationMessage {
  cacheName: string
  /** 有 = 清这些 key；无/空 = 全清 */
  keys?: string[]
}

/** 本地失效回调：keys 为 undefined/空 → 全清，为数组 → 逐个删除 */
export type InvalidationHandler = (keys?: string[]) => void

const handlers = new Map<string, InvalidationHandler>()

/** 注册某缓存的本地失效回调。各 cache 模块在被 import 时调用一次。 */
export function registerInvalidationHandler(cacheName: CacheName, handler: InvalidationHandler): void {
  handlers.set(cacheName, handler)
}

/**
 * 发布失效通知。fire-and-forget——调用方不应 await。
 * 整体 try/catch：既兜住 publish 的异步 reject，也兜住 getRedisClient() 在
 * NUXT_REDIS_URL 未配置时的同步抛错（getRedisClient → getRedisUrl 会同步 throw）。
 * Redis 不可用仅记日志，绝不阻塞或拖垮写库 API。
 */
export function publishInvalidation(cacheName: CacheName, keys?: string[]): void {
  try {
    const message: CacheInvalidationMessage =
      keys && keys.length > 0 ? { cacheName, keys } : { cacheName }
    getRedisClient()
      .publish(CACHE_INVALIDATION_CHANNEL, JSON.stringify(message))
      .catch((err) => logger.warn('cacheInvalidationBus: 发布失效消息失败', err))
  } catch (err) {
    logger.warn('cacheInvalidationBus: 发布失效消息失败（同步异常）', err)
  }
}

/** 解析并分发收到的失效消息。导出供测试。 */
export function dispatchInvalidationMessage(raw: string): void {
  let message: CacheInvalidationMessage
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      logger.warn('cacheInvalidationBus: 收到畸形失效消息，已忽略', { raw })
      return
    }
    message = parsed
  } catch {
    logger.warn('cacheInvalidationBus: 收到畸形失效消息，已忽略', { raw })
    return
  }
  const handler = handlers.get(message.cacheName)
  if (!handler) return // 本实例未注册该缓存，无害
  try {
    handler(message.keys)
  } catch (err) {
    logger.error('cacheInvalidationBus: 失效 handler 执行异常', {
      cacheName: message.cacheName,
      err,
    })
  }
}

let started = false

/**
 * 启动订阅。由 Nitro 插件在进程启动时调用一次。
 * - 启动时显式 subscribe 一次：点火 lazyConnect 连接并完成首次订阅
 * - on('ready') 负责其后每次（重）连接的（重）订阅，覆盖「冷启动初次订阅失败」场景
 *   （ioredis 的 autoResubscribe 只重订曾成功订阅过的频道，覆盖不到冷启动失败）
 */
export function startCacheInvalidationSubscriber(): void {
  if (started) return
  started = true
  const sub = getCacheBusSubscriber()

  sub.on('message', (channel: string, message: string) => {
    if (channel === CACHE_INVALIDATION_CHANNEL) dispatchInvalidationMessage(message)
  })

  sub.on('ready', () => {
    sub.subscribe(CACHE_INVALIDATION_CHANNEL)
      .catch((err) => logger.warn('cacheInvalidationBus: ready 重订阅失败', err))
  })

  sub.subscribe(CACHE_INVALIDATION_CHANNEL)
    .catch((err) => logger.warn('cacheInvalidationBus: 初次订阅失败，将由 on(ready) 重试', err))
}

/** 仅测试用：清空 handler 注册表并重置订阅启动标志。 */
export function _resetBusForTests(): void {
  handlers.clear()
  started = false
}
