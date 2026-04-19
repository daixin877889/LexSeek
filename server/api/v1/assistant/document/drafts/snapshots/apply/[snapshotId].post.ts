/**
 * POST /api/v1/assistant/document/drafts/snapshots/apply/[snapshotId]
 *
 * 用快照的 values 覆盖指定草稿的工作区。
 * 支持全量恢复（不传 fieldNames）和字段级恢复（传 fieldNames）。
 * 恢复前自动创建 workspace-backup 快照。
 */

import { z } from 'zod'
import { applySnapshotFieldsService } from '~~/server/services/assistant/document/documentDraftSnapshot.service'
import { getSnapshotByIdDAO } from '~~/server/services/assistant/document/documentDraftSnapshot.dao'

const bodySchema = z.object({
    fieldNames: z.array(z.string().min(1)).optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const snapshotId = Number(getRouterParam(event, 'snapshotId'))
    if (!Number.isInteger(snapshotId) || snapshotId <= 0) {
        return resError(event, 400, '快照 ID 无效')
    }

    const body = await readBody(event)
    const parsed = bodySchema.safeParse(body ?? {})
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    const snapshot = await getSnapshotByIdDAO(snapshotId)
    if (!snapshot) return resError(event, 404, '快照不存在')

    const r = await applySnapshotFieldsService(user.id, snapshot.draftId, snapshotId, parsed.data.fieldNames)
    if ('error' in r) return resError(event, r.code, r.error)
    return resSuccess(event, '恢复成功', { draft: r.draft })
})
