/**
 * 查询小索对话 Session 列表
 * GET /api/v1/case/analysis/xiaosuo-sessions?caseId=xxx
 */
export default defineEventHandler(async (event) => {
  const user = event.context.auth?.user
  if (!user) return resError(event, 401, '请先登录')

  const query = getQuery(event)
  const caseId = Number(query.caseId)
  if (!caseId) return resError(event, 400, '缺少 caseId')

  // 权限校验
  const caseRecord = await prisma.cases.findFirst({
    where: { id: caseId, userId: user.id, deletedAt: null },
  })
  if (!caseRecord) return resError(event, 404, '案件不存在')

  const sessions = await prisma.caseSessions.findMany({
    where: {
      caseId,
      type: 1,
      deletedAt: null,
      metadata: { path: ['source'], equals: 'xiaosuo' },
    },
    orderBy: { updatedAt: 'desc' },
  })

  const result = await Promise.all(
    sessions.map(async (s) => {
      const activeRun = await getActiveRunService(s.sessionId)
      return {
        sessionId: s.sessionId,
        title: (s.metadata as any)?.title ?? '新对话',
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        hasActiveRun: !!activeRun,
      }
    }),
  )

  return resSuccess(event, '查询成功', result)
})
