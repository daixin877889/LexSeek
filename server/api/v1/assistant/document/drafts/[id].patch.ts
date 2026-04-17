/**
 * PATCH /api/v1/assistant/document/drafts/:id
 *
 * 更新文书草稿的 values 字段（部分更新）。
 * - 只有草稿归属用户可修改
 * - 草稿处于 drafting/filling 状态时拒绝修改（409）
 * - 不在 template.placeholders 中的 key 会被忽略
 *
 * Body：
 * - values: 要更新的字段键值对（必填，Record<string, string | null>）
 *
 * 错误码：
 * - 400：参数校验失败
 * - 403：无权修改（非归属用户）
 * - 404：草稿不存在
 * - 409：草稿正在生成中（status=drafting 或 filling）
 *
 * 参见 spec §3.11
 */

import { z } from 'zod'
import { patchDraftService } from '~~/server/services/assistant/document/documentDraft.service'

const BodySchema = z.object({
    values: z.record(z.string(), z.string().nullable()),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const idStr = getRouterParam(event, 'id')
    const id = Number(idStr)
    if (!idStr || !Number.isInteger(id) || id <= 0) {
        return resError(event, 400, '草稿 ID 无效')
    }

    const body = await readBody(event).catch(() => ({}))
    const parsed = BodySchema.safeParse(body)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    const result = await patchDraftService(user.id, id, parsed.data)
    if ('error' in result) {
        return resError(event, result.code, result.error)
    }

    return resSuccess(event, '更新成功', result)
})
