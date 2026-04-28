import { z } from 'zod'
import { createVersionService } from '~~/server/services/assistant/document/documentDraftVersion.service'

const bodySchema = z.object({
    name: z.string().min(1).max(100),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isInteger(id) || id <= 0) return resError(event, 400, '草稿 ID 无效')

    const body = await readBody(event)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    const r = await createVersionService(user.id, id, parsed.data.name.trim())
    if ('error' in r) return resError(event, r.code, r.error)

    return resSuccess(event, '保存成功', { version: r.version })
})
