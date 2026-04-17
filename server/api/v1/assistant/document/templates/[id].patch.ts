/**
 * PATCH /api/v1/assistant/document/templates/:id
 *
 * 更新文书模板元数据（部分更新）。
 * - 普通用户只能修改自己的模板；越权返回 403
 * - admin（super_admin 角色）可修改任何模板
 * - global 模板只有 admin 可修改
 *
 * Body（均可选）：
 * - name: string
 * - category: string
 * - description: string
 * - status: number
 *
 * 参见 spec §2.3
 */

import { z } from 'zod'
import {
    getDocumentTemplateDAO,
    updateDocumentTemplateDAO,
} from '~~/server/services/assistant/document/documentTemplate.dao'
import { checkIsSuperAdmin } from '~~/server/services/rbac/permission.service'

const PatchSchema = z.object({
    name: z.string().min(1).optional(),
    category: z.string().optional(),
    description: z.string().optional(),
    status: z.number().int().optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const idStr = getRouterParam(event, 'id')
    const id = Number(idStr)
    if (!idStr || !Number.isInteger(id) || id <= 0) {
        return resError(event, 400, '模板 ID 无效')
    }

    const raw = await readBody(event).catch(() => ({}))
    const parsed = PatchSchema.safeParse(raw ?? {})
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    try {
        const template = await getDocumentTemplateDAO(id)
        if (!template) return resError(event, 404, '模板不存在')

        const isAdmin = await checkIsSuperAdmin(user.id)
        const isOwner = template.scope === 'user' && template.userId === user.id

        if (!isAdmin && !isOwner) {
            return resError(event, 403, '无权修改该模板')
        }

        const updated = await updateDocumentTemplateDAO(id, parsed.data)
        return resSuccess(event, '更新成功', updated)
    } catch (error: any) {
        logger.error('更新文书模板失败', { id, userId: user.id, error: error?.message })
        return resError(event, 500, error?.message || '更新模板失败')
    }
})
