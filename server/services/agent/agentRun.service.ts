/**
 * AgentRun 服务层
 *
 * 提供入队、取消、查询等业务逻辑
 */

import type { agentRuns } from '~~/generated/prisma/client'
import type { AgentRunInput } from '#shared/types/agentRun'
import { AGENT_RUN_STATUS } from '#shared/types/agentRun'
import {
  createAgentRunDAO,
  findActiveRunBySessionIdDAO,
  findLatestRunBySessionIdDAO,
  updateRunStatusDAO,
  countActiveRunsByUserIdDAO,
  findRunsBySessionIdDAO,
} from './agentRun.dao'
import { getRedisClient } from '~~/server/lib/redis'

interface EnqueueRunParams {
  sessionId: string
  threadId: string
  userId: number
  caseId: number
  input: AgentRunInput
}

interface EnqueueRunOptions {
  /** 覆盖用户最大并发数（用于测试） */
  maxUserConcurrent?: number
}

/**
 * 入队新 run 或返回已存在的活跃 run
 *
 * 逻辑：
 * 1. 检查 session 是否已有活跃 run → 返回已有的 runId
 * 2. 检查用户并发限制 → 超限返回错误
 * 3. 创建新 run 并通知 Worker
 */
export async function enqueueRunService(
  params: EnqueueRunParams,
  options?: EnqueueRunOptions,
): Promise<{ runId: string; isNew: boolean } | { error: string }> {
  // 1. 检查是否已有活跃 run
  const existingRun = await findActiveRunBySessionIdDAO(params.sessionId)
  if (existingRun) {
    return { runId: existingRun.id, isNew: false }
  }

  // 2. 检查用户并发限制
  const maxUserConcurrent = options?.maxUserConcurrent
    ?? useRuntimeConfig().agent.maxUserConcurrent
  const activeCount = await countActiveRunsByUserIdDAO(params.userId)
  if (activeCount >= maxUserConcurrent) {
    return { error: `已达到最大并发分析数（${maxUserConcurrent}），请等待当前分析完成` }
  }

  // 3. 创建新 run
  try {
    const run = await createAgentRunDAO(params)

    // 通知 Worker 有新任务（非阻塞）
    notifyNewTask(run.id)

    return { runId: run.id, isNew: true }
  }
  catch (err: any) {
    // partial unique index 冲突 → 竞态条件下另一个请求先创建了
    if (err?.code === 'P2002') {
      const existingRun = await findActiveRunBySessionIdDAO(params.sessionId)
      if (existingRun) {
        return { runId: existingRun.id, isNew: false }
      }
    }
    throw err
  }
}

/**
 * 查找 session 的当前活跃 run
 */
export async function getActiveRunService(
  sessionId: string
): Promise<agentRuns | null> {
  return findActiveRunBySessionIdDAO(sessionId)
}

/**
 * 查找 session 的最新 run（不限状态，用于历史重放）
 */
export async function getLatestRunService(
  sessionId: string
): Promise<agentRuns | null> {
  return findLatestRunBySessionIdDAO(sessionId)
}

/**
 * 取消 run
 *
 * 语义：**幂等**。对任何状态的 run，cancel 的期望结果都是"run 不再运行"。
 * - PENDING / RUNNING：真正发起取消并更新状态（RUNNING 同时发 Redis 信号让 Worker abort）
 * - COMPLETED / CANCELLED / FAILED / INTERRUPTED：已 terminal，直接返回成功（符合幂等）
 * - Run 不存在：返回失败
 *
 * 幂等是前端 UX 的前提：用户点停止时 run 可能刚好 completed，返回 error 会
 * 让 UI 卡在 isStopping 等 timeout。前端调用方应只关心"是否成功停止"，不需
 * 要区分"停止成功" vs "早已停止"。
 */
export async function cancelRunService(
  runId: string
): Promise<{ success: boolean; error?: string }> {
  const run = await prisma.agentRuns.findUnique({ where: { id: runId } })
  if (!run) {
    return { success: false, error: 'Run 不存在' }
  }

  if (run.status === AGENT_RUN_STATUS.PENDING) {
    await updateRunStatusDAO(runId, AGENT_RUN_STATUS.CANCELLED, {
      completedAt: new Date(),
    })
    return { success: true }
  }

  if (run.status === AGENT_RUN_STATUS.RUNNING) {
    await updateRunStatusDAO(runId, AGENT_RUN_STATUS.CANCELLED, {
      completedAt: new Date(),
    })
    // 通知 Worker 取消执行
    try {
      const redis = getRedisClient()
      await redis.publish(`run_cancel:${runId}`, runId)
    }
    catch {
      logger.warn(`发布取消信号失败: run=${runId}`)
    }
    return { success: true }
  }

  // 已是 terminal 状态（COMPLETED / CANCELLED / FAILED / INTERRUPTED）：
  // 幂等成功，调用方无需区分"真的取消了" vs "早已完成"
  return { success: true }
}

/**
 * 查询 session 的 run 列表
 */
export async function getRunListService(
  sessionId: string
): Promise<agentRuns[]> {
  return findRunsBySessionIdDAO(sessionId)
}

/**
 * 通知 Worker 有新任务（通过 Redis PUBLISH）
 */
function notifyNewTask(runId: string): void {
  try {
    const redis = getRedisClient()
    redis.publish('agent_tasks', JSON.stringify({ runId })).catch((err) => {
      logger.warn('通知 Worker 新任务失败:', err)
    })
  }
  catch {
    logger.warn('Redis 未就绪，跳过通知 Worker')
  }
}
