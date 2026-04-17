/**
 * POST /api/v1/assistant/sessions
 *
 * 创建一个 scope=assistant 的新会话。可选 title（不传则 null，等首轮对话后
 * 异步生成）。返回 { sessionId, title }。
 *
 * 参见 spec §5.6.1。
 */

import { z } from 'zod'
import { createAssistantSessionService } from '~~/server/services/assistant/assistantSession.service'

const BodySchema = z.object({
    title: z.string().min(1).max(200).optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const raw = await readBody(event).catch(() => ({}))
    const parsed = BodySchema.safeParse(raw ?? {})
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    try {
        const session = await createAssistantSessionService(user.id, parsed.data.title)
        return resSuccess(event, '创建成功', {
            sessionId: session.sessionId,
            title: session.title,
        })
    } catch (error: any) {
        logger.error('创建 assistant 会话失败', {
            userId: user.id,
            error: error?.message,
        })
        return resError(event, 500, error?.message || '创建会话失败')
    }
})
