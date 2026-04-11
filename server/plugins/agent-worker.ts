/**
 * Agent Worker Nitro Plugin
 *
 * 管理 Agent Worker 的生命周期：启动和优雅关闭。
 * 定时清理逻辑已迁移至 cron-scheduler.ts 统一管理。
 * 资源关闭（Redis/DB）由 cron-scheduler.ts 的 close hook 负责，
 * 确保 Redis 连接在所有定时任务停止后才关闭。
 */

import { AgentWorker } from '~~/server/services/agent/agentWorker'

let worker: AgentWorker | null = null

export default defineNitroPlugin((nitroApp) => {
  const { redis: redisConfig } = useRuntimeConfig()

  if (!redisConfig.url) {
    logger.warn('Redis URL 未配置，Agent Worker 不启动')
    return
  }

  worker = new AgentWorker()
  worker.start().catch((err) => {
    logger.error('Agent Worker 启动失败:', err)
  })

  // Graceful shutdown（仅停止 Worker，资源关闭由 cron-scheduler 负责）
  nitroApp.hooks.hook('close', async () => {
    if (worker) {
      await worker.shutdown()
      worker = null
    }
  })
})
