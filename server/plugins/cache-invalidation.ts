/**
 * 缓存失效总线 Nitro 插件
 *
 * 进程启动时订阅 cache:invalidate 频道。订阅连接（getCacheBusSubscriber）的关闭
 * 由 cron-scheduler 的 closeRedisConnections() 统一负责，本插件不管 Redis 生命周期
 * （与 agent-worker.ts 一致）。
 */
import { startCacheInvalidationSubscriber } from '~~/server/utils/cacheInvalidationBus'

export default defineNitroPlugin(() => {
  const { redis } = useRuntimeConfig()
  if (!redis.url) {
    logger.warn('Redis URL 未配置，缓存失效总线不启动（降级为纯 TTL）')
    return
  }
  startCacheInvalidationSubscriber()
  logger.info('缓存失效总线已启动')
})
