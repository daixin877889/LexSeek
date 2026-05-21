/**
 * 查询案件批量分析会话列表（type=2）
 *
 * GET /api/v1/cases/analysis/init-sessions?caseId=xxx
 *
 * owner-only：仅返回当前用户名下的案件会话。
 * 用户端接口，无需在 RBAC api_permissions 表登记。
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
        type: 2,
    })
    if (!sessions) return resError(event, 404, '案件不存在')

    // 注意：listSessionsWithActiveRunDAO 返回的 SessionListItem 不含顶层 title 列，
    // 标题统一存放在 metadata.title（参考 session.dao.ts renameSessionDAO 用 jsonb_set 写入）。
    // DAO 默认按 updatedAt desc 排序；`#N` 序号按最新→#N、最早→#1 倒推，与下拉视觉一致。
    const total = sessions.length
    const result = sessions.map((s, idx) => ({
        sessionId: s.sessionId,
        title: s.metadata?.title ?? `批量分析 #${total - idx}`,
        hasActiveRun: s.hasActiveRun,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
    }))

    return resSuccess(event, '查询成功', result)
})
