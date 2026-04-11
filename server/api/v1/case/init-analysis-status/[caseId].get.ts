/**
 * 初始化分析状态查询端点
 *
 * GET /api/v1/case/init-analysis-status/:caseId
 *
 * 返回案件的初始化分析状态和各模块结果
 */

import { getInitAnalysisStatusService } from '~~/server/services/case/initAnalysis.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    const caseId = Number(getRouterParam(event, 'caseId'))
    if (!caseId || isNaN(caseId)) {
        return resError(event, 400, '无效的案件ID')
    }

    const query = getQuery(event)
    const sessionId = query.sessionId as string | undefined

    try {
        const status = await getInitAnalysisStatusService(caseId, user.id, sessionId)
        return resSuccess(event, '获取成功', status)
    } catch (err: any) {
        return resError(event, 400, err.message)
    }
})
