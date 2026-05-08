/**
 * AgentRun 数据访问层
 *
 * 提供 AgentRun 的 CRUD 操作，包含 FOR UPDATE SKIP LOCKED 原子取任务
 */

import type { agentRuns, Prisma } from '~~/generated/prisma/client'
import { AGENT_RUN_STATUS, type AgentRunInput, type AgentRunStatus } from '#shared/types/agentRun'

/** 创建 AgentRun 入队参数 */
export interface CreateAgentRunParams {
  sessionId: string
  threadId: string
  userId: number
  /** 关联案件 ID；scope=assistant 时传 null */
  caseId: number | null
  input: AgentRunInput
}

/**
 * 创建 AgentRun 记录（入队）
 *
 * 若同 session 已存在活跃 run（pending/running），因 partial unique index 会抛出唯一约束错误
 */
export async function createAgentRunDAO(
  data: CreateAgentRunParams,
  tx?: Prisma.TransactionClient
): Promise<agentRuns> {
  const client = tx || prisma
  return client.agentRuns.create({
    data: {
      sessionId: data.sessionId,
      threadId: data.threadId,
      userId: data.userId,
      caseId: data.caseId,
      input: data.input as any,
      status: AGENT_RUN_STATUS.PENDING,
    },
  })
}

/**
 * 查找 session 的当前活跃 run（pending 或 running）
 */
export async function findActiveRunBySessionIdDAO(
  sessionId: string
): Promise<agentRuns | null> {
  return prisma.agentRuns.findFirst({
    where: {
      sessionId,
      status: { in: [AGENT_RUN_STATUS.PENDING, AGENT_RUN_STATUS.RUNNING, AGENT_RUN_STATUS.INTERRUPTED] },
    },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * 批量查询：哪些 sessionIds 当前有活跃 run（pending/running/interrupted）。
 * 单次 SQL 替代列表场景下的 N 次 findFirst。
 */
export async function findSessionIdsWithActiveRunDAO(
  sessionIds: string[]
): Promise<Set<string>> {
  if (sessionIds.length === 0) return new Set()
  const runs = await prisma.agentRuns.findMany({
    where: {
      sessionId: { in: sessionIds },
      status: { in: [AGENT_RUN_STATUS.PENDING, AGENT_RUN_STATUS.RUNNING, AGENT_RUN_STATUS.INTERRUPTED] },
    },
    select: { sessionId: true },
  })
  return new Set(runs.map(r => r.sessionId))
}

/**
 * 查找 session 的最新 run（不限状态，用于历史重放）
 */
export async function findLatestRunBySessionIdDAO(
  sessionId: string
): Promise<agentRuns | null> {
  return prisma.agentRuns.findFirst({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * 原子取任务：FOR UPDATE SKIP LOCKED
 *
 * 使用 $queryRaw 实现，Prisma 不直接支持此语法。
 * 在事务中先锁定一条 pending 记录，然后更新为 running 状态。
 */
export async function claimPendingRunDAO(
  workerId: string
): Promise<agentRuns | null> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<agentRuns[]>`
      SELECT * FROM agent_runs
      WHERE status = ${AGENT_RUN_STATUS.PENDING}
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `

    if (rows.length === 0) return null

    const run = rows[0]
    if (!run) return null
    const now = new Date()

    return tx.agentRuns.update({
      where: { id: run.id },
      data: {
        status: AGENT_RUN_STATUS.RUNNING,
        workerId,
        startedAt: now,
        heartbeatAt: now,
      },
    })
  })
}

/**
 * 更新 run 状态及附加字段
 */
export async function updateRunStatusDAO(
  id: string,
  status: AgentRunStatus,
  extra?: { error?: string; completedAt?: Date; metadata?: any }
): Promise<agentRuns> {
  return prisma.agentRuns.update({
    where: { id },
    data: {
      status,
      ...(extra?.error !== undefined && { error: extra.error }),
      ...(extra?.completedAt && { completedAt: extra.completedAt }),
      ...(extra?.metadata !== undefined && { metadata: extra.metadata }),
    },
  })
}

/**
 * 批量心跳更新：更新指定 worker 所有 running 状态的 run
 * 返回受影响的行数
 */
export async function updateHeartbeatDAO(workerId: string): Promise<number> {
  const result = await prisma.agentRuns.updateMany({
    where: {
      workerId,
      status: AGENT_RUN_STATUS.RUNNING,
    },
    data: {
      heartbeatAt: new Date(),
    },
  })
  return result.count
}

/**
 * 查找心跳超时的 running 任务（stale runs）
 */
export async function findStaleRunsDAO(thresholdMs: number): Promise<agentRuns[]> {
  const threshold = new Date(Date.now() - thresholdMs)
  return prisma.agentRuns.findMany({
    where: {
      status: AGENT_RUN_STATUS.RUNNING,
      heartbeatAt: { lt: threshold },
    },
  })
}

/**
 * 重置超时任务为 pending（含 workerId 条件防竞态）
 * 返回是否成功重置
 */
export async function resetStaleRunDAO(
  id: string,
  oldWorkerId: string
): Promise<boolean> {
  const result = await prisma.agentRuns.updateMany({
    where: {
      id,
      workerId: oldWorkerId,
      status: AGENT_RUN_STATUS.RUNNING,
    },
    data: {
      status: AGENT_RUN_STATUS.PENDING,
      workerId: null,
      heartbeatAt: null,
      startedAt: null,
    },
  })
  return result.count > 0
}

/**
 * 统计用户活跃 run 数量（pending + running）
 */
export async function countActiveRunsByUserIdDAO(userId: number): Promise<number> {
  return prisma.agentRuns.count({
    where: {
      userId,
      status: { in: [AGENT_RUN_STATUS.PENDING, AGENT_RUN_STATUS.RUNNING] },
    },
  })
}

/**
 * 按 session 查询 run 列表（按创建时间降序）
 */
export async function findRunsBySessionIdDAO(sessionId: string): Promise<agentRuns[]> {
  return prisma.agentRuns.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * 清理过期数据（删除 N 天前的已终结 run）
 */
export async function deleteOldRunsDAO(days: number): Promise<number> {
  const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const result = await prisma.agentRuns.deleteMany({
    where: {
      createdAt: { lt: threshold },
      status: {
        in: [AGENT_RUN_STATUS.COMPLETED, AGENT_RUN_STATUS.FAILED, AGENT_RUN_STATUS.CANCELLED],
      },
    },
  })
  return result.count
}
