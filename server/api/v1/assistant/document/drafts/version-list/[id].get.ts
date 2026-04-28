import { listVersionsForUserService } from '~~/server/services/assistant/document/documentDraftVersion.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isInteger(id) || id <= 0) return resError(event, 400, '草稿 ID 无效')

    const r = await listVersionsForUserService(user.id, id)
    if ('error' in r) return resError(event, r.code, r.error)

    return resSuccess(event, '查询成功', { versions: r.versions })
})
