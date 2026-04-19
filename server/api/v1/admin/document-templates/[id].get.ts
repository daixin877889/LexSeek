/**
 * GET /api/v1/admin/document-templates/:id
 *
 * 后台管理端获取单个文书模板详情。权限由 03.permission 中间件拦截。
 * 作用域约束：仅允许查看 scope='global' 的系统模板，拒绝用户私人模板（隐私保护）。
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
        if (template.scope !== 'global') {
            return resError(event, 403, '后台仅管理系统模板，用户私人模板不可访问')
        }
        return resSuccess(event, '获取模板详情成功', template)
    } catch (error: any) {
        logger.error('[admin] 获取文书模板详情失败', { id, userId: user.id, error: error?.message })
        return resError(event, 500, error?.message || '获取模板详情失败')
    }
})
