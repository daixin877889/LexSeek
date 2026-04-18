/**
 * DELETE /api/v1/admin/document-templates/:id
 *
 * 后台管理端软删除文书模板。权限由 03.permission 中间件统一拦截
 * （非 super_admin 访问 /api/v1/admin/** 会被直接 403）。
 * - 可删除任意 scope 的模板（global/user）
 * - 已软删幂等
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

        await softDeleteDocumentTemplateDAO(id)
        return resSuccess(event, '删除成功', { id })
    } catch (error: any) {
        logger.error('[admin] 删除文书模板失败', { id, userId: user.id, error: error?.message })
        return resError(event, 500, error?.message || '删除模板失败')
    }
})
