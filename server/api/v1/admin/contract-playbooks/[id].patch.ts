/**
 * PATCH /api/v1/admin/contract-playbooks/:id
 *
 * 管理端编辑清单要点（含切换 enabled）。
 * contractType 与 code 不允许修改（影响历史快照引用稳定性）；如需改，先停用再新建。
 */
import { z } from 'zod'
import {
    getPlaybookByIdDAO,
    updatePlaybookDAO,
} from '~~/server/services/assistant/contract/contractPlaybook.dao'

const BodySchema = z.object({
    title: z.string().min(1).max(30).optional(),
    defaultLevel: z.enum(['high', 'medium', 'low']).optional(),
    stancePreference: z.enum(['strict', 'balanced', 'lenient']).optional(),
    checkContent: z.string().min(1).max(500).optional(),
    legalBasis: z.string().max(300).nullable().optional(),
    suggestion: z.string().max(500).nullable().optional(),
    enabled: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isInteger(id) || id <= 0) return resError(event, 400, 'id 非法')

    const existing = await getPlaybookByIdDAO(id)
    if (!existing) return resError(event, 404, '要点不存在')

    const body = await readBody(event)
    const parsed = BodySchema.safeParse(body)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    try {
        const row = await updatePlaybookDAO(id, parsed.data)
        return resSuccess(event, '更新要点成功', row)
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : '未知错误'
        logger.error('[admin] 更新清单要点失败', { userId: user.id, id, error: msg })
        return resError(event, 500, msg || '更新失败')
    }
})
