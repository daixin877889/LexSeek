/**
 * GET /api/v1/assistant/document/drafts/versions/export/[versionId]
 *
 * 导出文书版本为 Word 文档
 */
import { exportVersionByIdService } from '~~/server/services/assistant/document/documentExport.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const versionId = Number(getRouterParam(event, 'versionId'))
    if (!Number.isInteger(versionId) || versionId <= 0) return resError(event, 400, '版本 ID 无效')

    const r = await exportVersionByIdService(user.id, versionId)
    if ('error' in r) return resError(event, r.code, r.error)
    return resSuccess(event, '导出成功', r)
})
