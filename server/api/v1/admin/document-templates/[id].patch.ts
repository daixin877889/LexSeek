/**
 * PATCH /api/v1/admin/document-templates/:id
 *
 * 后台管理端更新文书模板元数据。权限由 03.permission 中间件拦截
 * （非 super_admin 访问 /api/v1/admin/** 直接 403）。
 * - 可修改任意 scope 的模板（global/user）
 *
 * 与 /api/v1/assistant/document/templates/:id（用户端 owner-only）分离。
 */

import { z } from 'zod'
import {
    getDocumentTemplateDAO,
    updateDocumentTemplateDAO,
} from '~~/server/services/assistant/document/documentTemplate.dao'

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
        if (template.scope !== 'global') {
            return resError(event, 403, '后台仅管理系统模板，用户私人模板不可修改')
        }

        const updated = await updateDocumentTemplateDAO(id, parsed.data)
        return resSuccess(event, '更新成功', updated)
    } catch (error: any) {
        logger.error('[admin] 更新文书模板失败', { id, userId: user.id, error: error?.message })
        return resError(event, 500, error?.message || '更新模板失败')
    }
})
