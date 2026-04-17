/**
 * GET /api/v1/assistant/sessions/:id
 *
 * 获取指定 assistant 会话的元信息，并尝试读取 LangGraph checkpointer 中的消息
 * 历史。若 checkpointer 读取失败（例如尚未产生任何 checkpoint），记录 warn 并
 * 返回空 messages 数组，不影响元信息返回。
 *
 * 跨用户或已软删的会话返回 404。
 *
 * 参见 spec §5.6.2。
 */

import { getAssistantSessionService } from '~~/server/services/assistant/assistantSession.service'
import { getAssistantThreadState } from '~~/server/services/workflow/agents'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const sessionId = getRouterParam(event, 'id')
    if (!sessionId) return resError(event, 400, '会话 ID 不能为空')

    const session = await getAssistantSessionService(sessionId, user.id)
    if (!session) return resError(event, 404, '会话不存在或无权访问')

    // 读取 checkpointer 中的消息历史；失败只 warn 不抛出
    let messages: unknown[] = []
    try {
        const state = await getAssistantThreadState(sessionId) as any
        const raw = state?.values?.messages
        if (Array.isArray(raw)) {
            messages = raw
        }
    } catch (err) {
        logger.warn('读取 assistant thread state 失败', {
            sessionId,
            userId: user.id,
            error: err instanceof Error ? err.message : String(err),
        })
        messages = []
    }

    return resSuccess(event, '获取会话详情成功', {
        sessionId: session.sessionId,
        title: session.title,
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messages,
    })
})
