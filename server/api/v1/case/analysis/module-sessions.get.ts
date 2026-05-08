/**
 * 查询活跃模块 Session 列表
 *
 * GET /api/v1/case/analysis/module-sessions?caseId=xxx&moduleName=summary
 *
 * 返回指定案件所有 type=3 的模块对话 session
 * 包含是否有 activeRun 的状态，用于页面刷新后恢复
 * 支持可选 moduleName 参数过滤
 */
import { listSessionsWithActiveRunDAO } from '~~/server/services/case/session.dao'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const query = getQuery(event)
    const caseId = Number(query.caseId)
    if (!caseId) return resError(event, 400, '缺少 caseId')

    const moduleName = query.moduleName as string | undefined

    const sessions = await listSessionsWithActiveRunDAO({
        caseId,
        userId: user.id,
        type: 3,
        metadataFilter: moduleName
            ? { path: ['moduleName'], equals: moduleName }
            : undefined,
    })
    if (!sessions) return resError(event, 404, '案件不存在')

    const result = sessions.map(s => ({
        sessionId: s.sessionId,
        moduleName: s.metadata?.moduleName,
        nodeId: s.metadata?.nodeId,
        title: s.metadata?.title ?? s.metadata?.moduleName,
        hasActiveRun: s.hasActiveRun,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
    }))

    return resSuccess(event, '查询成功', result)
})
