/**
 * POST /api/v1/admin/document-templates
 *
 * 后台管理端上传全局文书模板（multipart/form-data）。
 * 权限由 03.permission 中间件统一拦截（非 super_admin 访问 /api/v1/admin/** 直接 403）。
 * - 一律创建 scope='global'（不走配额）
 * - 与 /api/v1/assistant/document/templates（用户端）分离，避免超管意外把私人模板上传成全局模板
 *
 * Form 字段、错误码与 spec §2.3 一致。
 */

import { createDocumentTemplateService } from '~~/server/services/assistant/document/documentTemplate.service'
import type { DocumentCategoryKey } from '#shared/types/document'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const formData = await readMultipartFormData(event)
    if (!formData) return resError(event, 400, '缺少文件')

    const fileItem = formData.find(item => item.name === 'file')
    if (!fileItem?.data || fileItem.data.length === 0) {
        return resError(event, 400, '缺少文件')
    }

    const nameItem = formData.find(item => item.name === 'name')
    const name = nameItem?.data?.toString('utf-8')?.trim() ?? ''
    if (!name) {
        return resError(event, 400, 'name 不能为空')
    }

    const categoryItem = formData.find(item => item.name === 'category')
    const category = categoryItem?.data?.toString('utf-8')?.trim() ?? ''
    if (!category) {
        return resError(event, 400, 'category 不能为空')
    }

    const descriptionItem = formData.find(item => item.name === 'description')
    const description = descriptionItem?.data?.toString('utf-8')?.trim() || undefined

    const fileName = fileItem.filename ?? 'upload.docx'
    const fileSize = fileItem.data.length
    const mimeType = fileItem.type ?? 'application/octet-stream'

    const result = await createDocumentTemplateService({
        scope: 'global',
        ownerUserId: null, // 全局模板归属系统，不入任何用户云盘
        file: fileItem.data,
        fileName,
        fileSize,
        mimeType,
        name,
        category: category as DocumentCategoryKey,
        description,
    })

    if ('error' in result) {
        return resError(event, result.code, result.error)
    }

    return resSuccess(event, '上传成功', { templateId: result.templateId })
})
