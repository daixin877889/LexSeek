/**
 * POST /api/v1/assistant/document/templates
 *
 * 上传文书模板（multipart/form-data）。
 * 普通用户创建 scope='user'（受配额 20 限制）；admin 创建 scope='global'。
 *
 * Form 字段：
 * - file: .docx 文件（必填，≤ 20MB）
 * - name: 模板名称（必填，非空）
 * - category: 分类 key（必填）
 * - description: 简介（可选）
 *
 * 错误码：
 * - 400：格式非 .docx / 无占位符 / 缺少必填字段
 * - 403：配额已满（普通用户上限 20 个）
 * - 413：文件大小 > 20MB
 *
 * Admin 判断：checkIsSuperAdmin(user.id) 查 DB（与 routers.get.ts 保持一致）。
 *
 * 参见 spec §2.3
 */

import { createDocumentTemplateService } from '~~/server/services/assistant/document/documentTemplate.service'
import { checkIsSuperAdmin } from '~~/server/services/rbac/permission.service'
import type { DocumentCategoryKey } from '#shared/types/document'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const isAdmin = await checkIsSuperAdmin(user.id)

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
        userId: user.id,
        isAdmin,
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
