/**
 * 通用取消 AI 任务（vertical 无关）
 *
 * POST /api/v1/agent/runs/cancel/:runId
 *
 * 归属校验：只看 run.userId === auth.user.id,**不做 scope 校验**。
 * 与 server/api/v1/assistant/runs/cancel/[runId].post.ts 的区别:
 * 后者额外要求 session.scope='assistant',本接口对任意 vertical 通用。
 *
 * spec: docs/superpowers/specs/2026-05-14-ai-stop-and-queue-design.md §6.1
 */

import { prisma } from '~~/server/utils/db'
import { cancelRunService } from '~~/server/services/agent/agentRun.service'

export default defineEventHandler(async (event) => {
  const user = event.context.auth?.user
  if (!user) {
    return resError(event, 401, '请先登录')
  }

  const runId = getRouterParam(event, 'runId')
  if (!runId) {
    return resError(event, 400, 'runId 不能为空')
  }

  const run = await prisma.agentRuns.findUnique({ where: { id: runId } })
  if (!run) {
    return resError(event, 404, 'Run 不存在')
  }
  if (run.userId !== user.id) {
    return resError(event, 403, '无权操作')
  }

  const result = await cancelRunService(runId)
  if (!result.success) {
    return resError(event, 400, result.error ?? '取消失败')
  }

  return resSuccess(event, '取消成功', { cancelled: true })
})
