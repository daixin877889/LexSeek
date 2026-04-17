/**
 * GET /api/v1/assistant/document/templates/:id
 *
 * 获取单个文书模板详情。
 * - global 模板：所有登录用户可访问
 * - user 模板：只有模板归属用户可访问；他人访问返回 404（隐藏存在性）
 *
 * 参见 spec §2.3
 */

import { getDocumentTemplateDAO } from '~~/server/services/assistant/document/documentTemplate.dao'

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

        return resSuccess(event, '获取模板详情成功', template)
    } catch (error: any) {
        logger.error('获取文书模板详情失败', { id, userId: user.id, error: error?.message })
        return resError(event, 500, error?.message || '获取模板详情失败')
    }
})
