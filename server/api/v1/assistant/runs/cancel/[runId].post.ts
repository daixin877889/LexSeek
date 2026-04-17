/**
 * 取消 assistant run API
 *
 * POST /api/v1/assistant/runs/cancel/:runId
 *
 * 与 case 域取消接口（/api/v1/case/analysis/runs/cancel/:runId）的区别：
 * - 额外校验关联 session 的 scope 必须为 'assistant'
 * - scope='case' 的 run 返回 403，避免跨域误操作
 *
 * 参见 spec §5.6.5
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

  // 鉴权：run 必须属于当前用户
  const run = await prisma.agentRuns.findUnique({ where: { id: runId } })
  if (!run) {
    return resError(event, 404, 'Run 不存在')
  }
  if (run.userId !== user.id) {
    return resError(event, 403, '无权操作')
  }

  // scope 校验：session 必须是 assistant
  const session = await prisma.caseSessions.findUnique({
    where: { sessionId: run.sessionId },
    select: { scope: true },
  })
  if (session?.scope !== 'assistant') {
    return resError(event, 403, '非 assistant 会话，请走案件取消接口')
  }

  const result = await cancelRunService(runId)
  if (!result.success) {
    return resError(event, 400, result.error ?? '取消失败')
  }

  return resSuccess(event, '取消成功', { cancelled: true })
})
