/**
 * DELETE /api/v1/assistant/document/templates/:id
 *
 * 软删除文书模板（设置 deletedAt）。
 * - 普通用户只能删除自己的模板；越权返回 403
 * - admin（super_admin 角色）可删除任何模板
 * - 已软删模板再次删除幂等（不报错）
 *
 * 参见 spec §2.3
 */

import {
    getDocumentTemplateDAO,
    softDeleteDocumentTemplateDAO,
} from '~~/server/services/assistant/document/documentTemplate.dao'
import { checkIsSuperAdmin } from '~~/server/services/rbac/permission.service'

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

        // 权限判断
        const isAdmin = await checkIsSuperAdmin(user.id)
        const isOwner = template.scope === 'user' && template.userId === user.id

        if (!isAdmin && !isOwner) {
            return resError(event, 403, '无权删除该模板')
        }

        await softDeleteDocumentTemplateDAO(id)
        return resSuccess(event, '删除成功', { id })
    } catch (error: any) {
        logger.error('删除文书模板失败', { id, userId: user.id, error: error?.message })
        return resError(event, 500, error?.message || '删除模板失败')
    }
})
