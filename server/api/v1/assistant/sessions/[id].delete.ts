/**
 * DELETE /api/v1/assistant/sessions/:id
 *
 * 软删除当前用户的 assistant 会话（deletedAt 填当前时间）。跨用户或不存在返回 404。
 *
 * 参见 spec §5.6.3。
 */

import { softDeleteAssistantSessionService } from '~~/server/services/assistant/assistantSession.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const sessionId = getRouterParam(event, 'id')
    if (!sessionId) return resError(event, 400, '会话 ID 不能为空')

    const result = await softDeleteAssistantSessionService(sessionId, user.id)
    if (!result.success) {
        return resError(event, 404, result.error || '会话不存在或无权访问')
    }

    return resSuccess(event, '删除成功', { sessionId })
})
