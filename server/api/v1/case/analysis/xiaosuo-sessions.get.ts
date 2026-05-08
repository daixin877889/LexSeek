/**
 * 查询小索对话 Session 列表
 * GET /api/v1/case/analysis/xiaosuo-sessions?caseId=xxx
 */
import { listSessionsWithActiveRunDAO } from '~~/server/services/case/session.dao'

export default defineEventHandler(async (event) => {
  const user = event.context.auth?.user
  if (!user) return resError(event, 401, '请先登录')

  const query = getQuery(event)
  const caseId = Number(query.caseId)
  if (!caseId) return resError(event, 400, '缺少 caseId')

  const sessions = await listSessionsWithActiveRunDAO({
    caseId,
    userId: user.id,
    type: 1,
    metadataFilter: { path: ['source'], equals: 'xiaosuo' },
  })
  if (!sessions) return resError(event, 404, '案件不存在')

  const result = sessions.map(s => ({
    sessionId: s.sessionId,
    title: s.metadata?.title ?? '新对话',
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    hasActiveRun: s.hasActiveRun,
  }))

  return resSuccess(event, '查询成功', result)
})
