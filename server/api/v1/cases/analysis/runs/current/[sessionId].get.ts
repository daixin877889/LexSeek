/**
 * 查询 session 当前活跃 run API
 *
 * GET /api/v1/cases/analysis/runs/current/:sessionId
 */

import { findCaseBySessionIdService } from '~~/server/services/case/caseSession.service'
import { getActiveRunService } from '~~/server/services/agent/agentRun.service'

export default defineEventHandler(async (event) => {
  const user = event.context.auth?.user
  if (!user) {
    return resError(event, 401, '请先登录')
  }

  const sessionId = getRouterParam(event, 'sessionId')
  if (!sessionId) {
    return resError(event, 400, 'sessionId 不能为空')
  }

  const caseInfo = await findCaseBySessionIdService(sessionId)
  if (!caseInfo) {
    return resError(event, 404, '案件不存在')
  }
  if (user.id !== caseInfo.userId) {
    return resError(event, 403, '无权访问')
  }

  const run = await getActiveRunService(sessionId)
  return resSuccess(event, '获取成功', { run })
})
