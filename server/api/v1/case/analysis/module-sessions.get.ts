/**
 * 查询活跃模块 Session 列表
 *
 * GET /api/v1/case/analysis/module-sessions?caseId=xxx
 *
 * 返回指定案件所有 type=3 的模块对话 session
 * 包含是否有 activeRun 的状态，用于页面刷新后恢复
 */

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const query = getQuery(event)
    const caseId = Number(query.caseId)
    if (!caseId) return resError(event, 400, '缺少 caseId')

    // 验证案件权限
    const caseRecord = await prisma.cases.findFirst({
        where: { id: caseId, userId: user.id, deletedAt: null },
    })
    if (!caseRecord) return resError(event, 404, '案件不存在')

    // 查询所有 type=3 session
    const sessions = await prisma.caseSessions.findMany({
        where: { caseId, type: 3, deletedAt: null },
        select: { sessionId: true, metadata: true, status: true },
    })

    // 检查每个 session 是否有 activeRun
    const result = await Promise.all(
        sessions.map(async (s) => {
            const activeRun = await getActiveRunService(s.sessionId)
            const metadata = s.metadata as { moduleName: string; nodeId: number }
            return {
                sessionId: s.sessionId,
                moduleName: metadata.moduleName,
                nodeId: metadata.nodeId,
                hasActiveRun: !!activeRun,
            }
        }),
    )

    return resSuccess(event, '查询成功', result)
})
