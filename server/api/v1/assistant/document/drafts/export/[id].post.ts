/**
 * POST /api/v1/assistant/document/drafts/export/:id
 *
 * 导出文书草稿为 .docx 文件，上传至 OSS 并返回签名下载链接。
 *
 * 响应数据：{ ossFileId: number, downloadUrl: string }
 *
 * 错误码：
 * - 400：draftId 非法 / 草稿未就绪
 * - 401：未登录
 * - 403：无权导出（非归属用户）
 * - 404：草稿不存在 / 模板已删除 / 模板文件丢失
 *
 * 参见 spec §11 - 文书导出
 */

import { exportDraftService } from '~~/server/services/assistant/document/documentExport.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const idStr = getRouterParam(event, 'id')
    const id = Number(idStr)
    if (!idStr || !Number.isInteger(id) || id <= 0) {
        return resError(event, 400, 'draftId 无效')
    }

    const result = await exportDraftService(user.id, id)
    if ('error' in result) {
        return resError(event, result.code, result.error)
    }

    return resSuccess(event, '导出成功', result)
})
