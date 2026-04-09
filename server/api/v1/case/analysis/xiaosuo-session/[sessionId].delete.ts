/**
 * 删除小索对话 Session
 * DELETE /api/v1/case/analysis/xiaosuo-session/:sessionId
 */
export default defineEventHandler(async (event) => {
  const user = event.context.auth?.user
  if (!user) return resError(event, 401, '请先登录')

  const sessionId = getRouterParam(event, 'sessionId')
  if (!sessionId) return resError(event, 400, '缺少 sessionId')

  // 查找 session 并验证权限
  const session = await prisma.caseSessions.findFirst({
    where: { sessionId, deletedAt: null },
    include: { case: { select: { userId: true } } },
  })

  if (!session) return resError(event, 404, 'Session 不存在')
  if (session.case.userId !== user.id) return resError(event, 403, '无权操作')

  // 验证是小索 session
  const metadata = session.metadata as any
  if (metadata?.source !== 'xiaosuo') {
    return resError(event, 400, '不能删除非小索的 session')
  }

  // 如有活跃 run，先取消
  const activeRun = await getActiveRunService(sessionId)
  if (activeRun) {
    await cancelRunService(activeRun.id)
  }

  // 软删除
  await prisma.caseSessions.update({
    where: { sessionId },
    data: { deletedAt: new Date() },
  })

  return resSuccess(event, '删除成功', null)
})
