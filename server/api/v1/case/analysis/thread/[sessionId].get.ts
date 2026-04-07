/**
 * 获取线程历史状态 API
 *
 * GET /api/v1/case/analysis/thread/:sessionId
 *
 * 从 checkpointer 读取指定线程的最新状态，
 * 返回给前端用于渲染历史消息和作为 useStream 的 initialValues。
 */

import { getThreadValuesService } from '~~/server/services/workflow/agents'
import { findCaseBySessionIdService } from '~~/server/services/case/caseSession.service'

export default defineEventHandler(async (event) => {
    // 1. 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 2. 获取路由参数
    const sessionId = getRouterParam(event, 'sessionId')
    if (!sessionId) {
        return resError(event, 400, '会话 ID 不能为空')
    }

    // 3. 验证案件权限
    const caseInfo = await findCaseBySessionIdService(sessionId)
    if (!caseInfo) {
        return resError(event, 404, '案件不存在')
    }
    if (user.id !== caseInfo.userId) {
        return resError(event, 403, '您没有权限访问该案件')
    }

    // 4. 读取线程状态（降级：失败返回空值，不阻塞页面）
    try {
        const values = await getThreadValuesService(sessionId)
        return resSuccess(event, '获取成功', {
            values: values ?? { messages: [] },
            threadId: sessionId,
        })
    } catch (error) {
        logger.warn('读取线程状态失败，返回空值', {
            sessionId,
            error: error instanceof Error ? error.message : '未知错误',
        })
        return resSuccess(event, '获取成功', {
            values: { messages: [] },
            threadId: sessionId,
        })
    }
})
