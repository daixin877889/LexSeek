/**
 * 定时任务调度器 Nitro Plugin
 *
 * 统一注册所有定时任务，配合 Redis 分布式锁确保多实例部署下不重复执行。
 * 同时负责 Redis 和 Agent DB 连接的优雅关闭（确保在所有定时任务停止后才关闭）。
 */

import { closeAgentDbPool, closeRedisConnections } from '~~/server/lib/redis'
import { cleanExpiredWorkspacesService } from '~~/server/services/workflow/tools/workspace'
import { cleanupStaleContractReviewsService } from '~~/server/services/assistant/contract/contractReviewCleanup.service'

export default defineNitroPlugin((nitroApp) => {
  const { redis: redisConfig } = useRuntimeConfig()

  if (!redisConfig.url) {
    logger.warn('Redis URL 未配置，定时任务调度器不启动')
    return
  }

  const scheduler = new CronScheduler()

  // ASR 保底轮询（每 5 分钟，批量检查 pending 状态的 ASR 任务）
  scheduler.register({
    name: 'asr-polling',
    intervalMs: 5 * 60 * 1000,
    lockTtlSeconds: 120,
    fn: pollPendingAsrTasksService,
  })

  // MinerU 保底轮询（每 5 分钟，批量检查 pending 状态的 MinerU 任务）
  scheduler.register({
    name: 'mineru-polling',
    intervalMs: 5 * 60 * 1000,
    lockTtlSeconds: 120,
    fn: pollPendingTasksService,
  })

  // 支付过期清理（每 10 分钟，扫描超时未支付的事务）
  scheduler.register({
    name: 'payment-cleanup',
    intervalMs: 10 * 60 * 1000,
    lockTtlSeconds: 60,
    fn: handleExpiredPaymentTransactionsService,
  })

  // 分析记录超时清理（每 15 分钟，清理僵死的 IN_PROGRESS 记录）
  scheduler.register({
    name: 'analysis-cleanup',
    intervalMs: 15 * 60 * 1000,
    lockTtlSeconds: 60,
    fn: cleanupStaleAnalysesService,
  })

  // Agent runs 历史清理（每 24 小时，清理 90 天前的已终结记录）
  scheduler.register({
    name: 'agent-runs-cleanup',
    intervalMs: 24 * 60 * 60 * 1000,
    lockTtlSeconds: 300,
    fn: () => deleteOldRunsDAO(90),
    runImmediately: true,
  })

  // Skills workspace 过期清理（每小时，清理 24h 无活动的 session workspace）
  scheduler.register({
    name: 'skills-workspace-cleanup',
    intervalMs: 60 * 60 * 1000,
    lockTtlSeconds: 60,
    fn: cleanExpiredWorkspacesService,
  })

  // 合同审查僵死清理（每小时，清理 24h 停在 reviewing 的记录；bug #14）
  scheduler.register({
    name: 'contract-reviewing-cleanup',
    intervalMs: 60 * 60 * 1000,
    lockTtlSeconds: 120,
    fn: cleanupStaleContractReviewsService,
  })

  scheduler.start()

  // 优雅关闭（顺序：停调度 → 关 DB 池 → 关 Redis）
  nitroApp.hooks.hook('close', async () => {
    scheduler.shutdown()
    await closeAgentDbPool()
    await closeRedisConnections()
  })
})
