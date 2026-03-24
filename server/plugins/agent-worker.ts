/**
 * Agent Worker Nitro Plugin
 *
 * 管理 Agent Worker 的生命周期：启动、清理定时任务、优雅关闭
 * 仅在 REDIS_URL 配置时启动
 */

import { AgentWorker } from '~~/server/services/agent/agentWorker'
import { deleteOldRunsDAO } from '~~/server/services/agent/agentRun.dao'
import { closeAgentDbPool, closeRedisConnections } from '~~/server/lib/redis'

let worker: AgentWorker | null = null

export default defineNitroPlugin((nitroApp) => {
  if (!process.env.REDIS_URL) {
    logger.warn('REDIS_URL 未配置，Agent Worker 不启动')
    return
  }

  worker = new AgentWorker()
  worker.start().catch((err) => {
    logger.error('Agent Worker 启动失败:', err)
  })

  // 每 24 小时清理 90 天前的已终结 run
  const cleanupTimer = setInterval(async () => {
    try {
      const deleted = await deleteOldRunsDAO(90)
      if (deleted > 0) {
        logger.info(`Agent runs 清理完成，删除 ${deleted} 条`)
      }
    }
    catch (err) {
      logger.error('Agent runs 清理失败:', err)
    }
  }, 24 * 60 * 60 * 1000)

  // Graceful shutdown
  nitroApp.hooks.hook('close', async () => {
    clearInterval(cleanupTimer)
    if (worker) {
      await worker.shutdown()
      worker = null
    }
    await closeAgentDbPool()
    await closeRedisConnections()
  })
})
