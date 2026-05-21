/**
 * POST /api/v1/assistant/document/templates
 *
 * 用户端上传文书模板（multipart/form-data）。
 * - 无论是否超管，经此接口上传的模板一律为 scope='user'（受配额 20 限制，归属当前用户）
 * - 上传全局系统模板请走 /api/v1/admin/document-templates（仅超管可访问）
 *
 * Form 字段：
 * - file: .docx 文件（必填，≤ 100MB）
 * - name: 模板名称（必填，非空）
 * - category: 分类 key（必填）
 * - description: 简介（可选）
 *
 * 错误码：
 * - 400：格式非 .docx / 无占位符 / 缺少必填字段
 * - 403：配额已满（普通用户上限 20 个）
 * - 413：文件大小 > 100MB
 *
 * 参见 spec §2.3
 */

import { createDocumentTemplateService } from '~~/server/services/assistant/document/documentTemplate.service'
import type { DocumentCategoryKey } from '#shared/types/document'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    // 解析 multipart/form-data
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
        scope: 'user',
        ownerUserId: user.id, // 用户端：模板归属当前用户，受配额限制
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
