/**
 * PATCH /api/v1/assistant/sessions/:id
 *
 * 重命名当前用户的 assistant 会话。跨用户或不存在会话返回 404。
 * Body: { title: string (1-200 字) }
 *
 * 参见 spec §5.6.3。
 */

import { z } from 'zod'
import { renameAssistantSessionService } from '~~/server/services/assistant/assistantSession.service'

const BodySchema = z.object({
    title: z.string().min(1, 'title 不能为空').max(200, 'title 最长 200 字'),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const sessionId = getRouterParam(event, 'id')
    if (!sessionId) return resError(event, 400, '会话 ID 不能为空')

    const raw = await readBody(event).catch(() => ({}))
    const parsed = BodySchema.safeParse(raw ?? {})
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    const result = await renameAssistantSessionService({
        sessionId,
        userId: user.id,
        title: parsed.data.title,
    })
    if (!result.success) {
        // DAO updateMany count=0 → 会话不存在或无权操作
        return resError(event, 404, result.error || '会话不存在或无权访问')
    }

    return resSuccess(event, '重命名成功', {
        sessionId,
        title: parsed.data.title,
    })
})
