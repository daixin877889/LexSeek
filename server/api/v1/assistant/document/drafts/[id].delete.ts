/**
 * DELETE /api/v1/assistant/document/drafts/:id
 *
 * 软删除当前用户的文书草稿（归属校验）。
 *
 * 错误码：
 * - 400：ID 无效
 * - 403：非归属用户
 * - 404：草稿不存在
 *
 * 参见 spec §3.11
 */

import { deleteDraftService } from '~~/server/services/assistant/document/documentDraft.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const idStr = getRouterParam(event, 'id')
    const id = Number(idStr)
    if (!idStr || !Number.isInteger(id) || id <= 0) {
        return resError(event, 400, '草稿 ID 无效')
    }

    const result = await deleteDraftService(user.id, id)
    if ('error' in result) {
        return resError(event, result.code, result.error)
    }

    return resSuccess(event, '删除成功', result)
})
