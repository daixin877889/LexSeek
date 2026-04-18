/**
 * GET /api/v1/assistant/document/templates/download-url/:id
 *
 * 为文书模板文件生成签名下载 URL（1 小时有效）。
 * - global 模板：所有登录用户可获取下载 URL（模板本身可读）
 * - user 模板：只有模板归属用户可获取
 *
 * 用于前端 docx-preview 实时预览：拿到签名 URL 后 fetch buffer。
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

        // user 模板：只有归属用户可访问
        if (template.scope === 'user' && template.userId !== user.id) {
            return resError(event, 404, '模板不存在')
        }

        const ossFile = await findOssFileByIdDao(template.ossFileId)
        if (!ossFile) return resError(event, 404, '模板文件不存在')
        if (!ossFile.filePath) return resError(event, 500, '模板文件路径缺失')

        // 使用系统默认存储配置生成签名 URL（不绑定当前用户配置）
        const downloadUrl = await generateSignedUrlService(ossFile.filePath, {
            expires: 3600,
        })

        return resSuccess(event, '获取模板下载链接成功', { downloadUrl })
    } catch (error: any) {
        logger.error('获取模板下载链接失败', { id, userId: user.id, error: error?.message })
        return resError(event, 500, error?.message || '获取模板下载链接失败')
    }
})
