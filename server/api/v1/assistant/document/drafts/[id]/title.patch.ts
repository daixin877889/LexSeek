import { z } from 'zod'
import { updateDraftTitleService } from '~~/server/services/assistant/document/documentDraft.service'

const bodySchema = z.object({
    title: z.string().min(1).max(200),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isInteger(id) || id <= 0) return resError(event, 400, '草稿 ID 无效')

    const body = await readBody(event)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')

    const result = await updateDraftTitleService(user.id, id, parsed.data.title.trim())
    if ('error' in result) return resError(event, result.code, result.error)

    return resSuccess(event, '更新成功', { draft: result.draft })
})
