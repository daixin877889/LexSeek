/**
 * 取消 run API
 *
 * POST /api/v1/cases/analysis/runs/cancel/:runId
 */

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

  // 验证 run 归属
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

  return resSuccess(event, '取消成功', null)
})
