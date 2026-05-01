/**
 * 重命名 Session（通用，适用于所有 session 类型）
 * PATCH /api/v1/cases/analysis/session/rename/:sessionId
 */
import { z } from 'zod'
import { renameSessionDAO } from '~~/server/services/case/session.dao'

const bodySchema = z.object({
    title: z.string().min(1).max(100),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const sessionId = getRouterParam(event, 'sessionId')
    if (!sessionId) return resError(event, 400, '缺少 sessionId')

    const body = await readBody(event)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    const result = await renameSessionDAO({
        sessionId,
        userId: user.id,
        newTitle: parsed.data.title,
    })

    if (!result.success) {
        const code = result.error?.includes('不存在') ? 404 : 403
        return resError(event, code, result.error!)
    }

    return resSuccess(event, '重命名成功', null)
})
