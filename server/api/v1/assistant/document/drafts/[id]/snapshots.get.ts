/**
 * GET /api/v1/assistant/document/drafts/[id]/snapshots
 *
 * 查询指定文书草稿的快照列表。
 * owner-only 访问，按创建时间降序返回（最新在前）。
 */

import { listSnapshotsForUserService } from '~~/server/services/assistant/document/documentDraftSnapshot.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isInteger(id) || id <= 0) {
        return resError(event, 400, '草稿 ID 无效')
    }

    const r = await listSnapshotsForUserService(user.id, id)
    if ('error' in r) return resError(event, r.code, r.error)
    return resSuccess(event, '查询成功', { snapshots: r.snapshots })
})
