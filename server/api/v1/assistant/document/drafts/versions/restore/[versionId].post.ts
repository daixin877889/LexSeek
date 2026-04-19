/**
 * POST /api/v1/assistant/document/drafts/versions/restore/[versionId]
 *
 * 恢复文书草稿到指定版本
 */
import { restoreVersionService } from '~~/server/services/assistant/document/documentDraftVersion.service'
import { getVersionByIdDAO } from '~~/server/services/assistant/document/documentDraftVersion.dao'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const versionId = Number(getRouterParam(event, 'versionId'))
    if (!Number.isInteger(versionId) || versionId <= 0) return resError(event, 400, '版本 ID 无效')

    const version = await getVersionByIdDAO(versionId)
    if (!version) return resError(event, 404, '版本不存在')

    const r = await restoreVersionService(user.id, version.draftId, versionId)
    if ('error' in r) return resError(event, r.code, r.error)
    return resSuccess(event, '恢复成功', { draft: r.draft })
})
