/**
 * 删除模块对话 Session
 * DELETE /api/v1/case/analysis/module-session/:sessionId
 */
import { softDeleteSessionDAO } from '~/server/services/case/session.dao'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const sessionId = getRouterParam(event, 'sessionId')
    if (!sessionId) return resError(event, 400, '缺少 sessionId')

    const result = await softDeleteSessionDAO({
        sessionId,
        userId: user.id,
        allowedTypes: [3], // 只允许删除模块对话 session
    })

    if (!result.success) {
        const code = result.error?.includes('不存在') ? 404 : 403
        return resError(event, code, result.error!)
    }

    return resSuccess(event, '删除成功', null)
})
