/**
 * GET /api/v1/assistant/document/drafts/:id
 *
 * 获取文书草稿详情。只有草稿归属用户可访问。
 *
 * 错误码：
 * - 400：ID 无效
 * - 403：无权访问（非归属用户）
 * - 404：草稿不存在
 *
 * 参见 spec §3.11
 */

import { getDraftService } from '~~/server/services/assistant/document/documentDraft.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const idStr = getRouterParam(event, 'id')
    const id = Number(idStr)
    if (!idStr || !Number.isInteger(id) || id <= 0) {
        return resError(event, 400, '草稿 ID 无效')
    }

    const result = await getDraftService(user.id, id)
    if ('error' in result) {
        return resError(event, result.code, result.error)
    }

    return resSuccess(event, '获取草稿详情成功', result)
})
