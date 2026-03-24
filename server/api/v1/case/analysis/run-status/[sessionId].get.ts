/**
 * 查询线程活跃 Run 状态
 *
 * GET /api/v1/case/analysis/run-status/:sessionId
 *
 * 返回该线程是否有正在执行的 run，
 * 用于前端页面进入时决定是否 joinStream。
 */

import { findCaseBySessionIdService } from '~~/server/services/case/caseSession.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    const sessionId = getRouterParam(event, 'sessionId')
    if (!sessionId) {
        return resError(event, 400, '会话 ID 不能为空')
    }

    const caseInfo = await findCaseBySessionIdService(sessionId)
    if (!caseInfo) {
        return resError(event, 404, '案件不存在')
    }
    if (user.id !== caseInfo.userId) {
        return resError(event, 403, '您没有权限访问该案件')
    }

    const session = await prisma.caseSessions.findUnique({
        where: { sessionId },
        select: { activeRunId: true },
    })

    const runId = session?.activeRunId ?? null

    return resSuccess(event, '查询成功', {
        isRunning: runId !== null,
        runId: runId ?? undefined,
    })
})
