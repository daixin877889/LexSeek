/**
 * 通用查询当前活跃 run（vertical 无关）
 *
 * GET /api/v1/agent/runs/current/:sessionId
 *
 * 归属校验：只看 session.userId === auth.user.id，不读 cases 表。
 * 与 server/api/v1/cases/analysis/runs/current/[sessionId].get.ts 的区别：
 * 后者要求 session 必须挂在案件下（assistant / document / 独立 contract 都 404），
 * 本接口对所有 vertical 通用。
 *
 * spec: docs/superpowers/specs/2026-05-14-ai-stop-and-queue-design.md §6.1
 */

import { prisma } from '~~/server/utils/db'
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

  // 归属校验：通过 caseSessions.userId 验证（assistant / document / contract / case 都有 userId）
  const session = await prisma.caseSessions.findUnique({
    where: { sessionId },
    select: { userId: true },
  })
  if (!session) {
    return resError(event, 404, '会话不存在')
  }
  if (session.userId !== user.id) {
    return resError(event, 403, '无权访问')
  }

  const run = await getActiveRunService(sessionId)
  return resSuccess(event, '获取成功', { run })
})
