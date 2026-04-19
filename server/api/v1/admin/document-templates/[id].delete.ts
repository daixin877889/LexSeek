/**
 * DELETE /api/v1/admin/document-templates/:id
 *
 * 后台管理端软删除文书模板。权限由 03.permission 中间件统一拦截
 * （非 super_admin 访问 /api/v1/admin/** 会被直接 403）。
 * 作用域约束：仅允许删除 scope='global' 的系统模板，拒绝用户私人模板。
 * 已软删幂等。
 *
 * 与 /api/v1/assistant/document/templates/:id（用户端 owner-only）分离。
 */

import {
    getDocumentTemplateDAO,
    softDeleteDocumentTemplateDAO,
} from '~~/server/services/assistant/document/documentTemplate.dao'

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
            return resError(event, 403, '后台仅管理系统模板，用户私人模板不可删除')
        }

        await softDeleteDocumentTemplateDAO(id)
        return resSuccess(event, '删除成功', { id })
    } catch (error: any) {
        logger.error('[admin] 删除文书模板失败', { id, userId: user.id, error: error?.message })
        return resError(event, 500, error?.message || '删除模板失败')
    }
})
