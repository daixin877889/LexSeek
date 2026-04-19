/**
 * GET /api/v1/admin/document-templates/download-url/:id
 *
 * 后台管理端为任意文书模板文件生成签名下载 URL（1 小时有效）。
 * 权限由 03.permission 中间件拦截。不做归属校验。
 */

import { getDocumentTemplateDAO } from '~~/server/services/assistant/document/documentTemplate.dao'
import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { generateSignedUrlService } from '~~/server/services/storage/storage.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const idStr = getRouterParam(event, 'id')
    const id = Number(idStr)
    if (!idStr || !Number.isInteger(id) || id <= 0) {
        return resError(event, 400, '模板 ID 无效')
    }

    try {
        const template = await getDocumentTemplateDAO(id)
        if (!template) return resError(event, 404, '模板不存在')
        if (template.scope !== 'global') {
            return resError(event, 403, '后台仅管理系统模板，用户私人模板不可下载')
        }

        const ossFile = await findOssFileByIdDao(template.ossFileId)
        if (!ossFile) return resError(event, 404, '模板文件不存在')
        if (!ossFile.filePath) return resError(event, 500, '模板文件路径缺失')

        const downloadUrl = await generateSignedUrlService(ossFile.filePath, {
            expires: 3600,
        })

        return resSuccess(event, '获取模板下载链接成功', { downloadUrl })
    } catch (error: any) {
        logger.error('[admin] 获取模板下载链接失败', { id, userId: user.id, error: error?.message })
        return resError(event, 500, error?.message || '获取模板下载链接失败')
    }
})
