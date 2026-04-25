/**
 * GET /api/v1/admin/contract-playbooks
 *
 * 管理端列出审查清单要点。权限由 03.permission 中间件拦截
 * （非 super_admin 访问 /api/v1/admin/** 直接 403）。
 *
 * Query：
 * - contractType: 合同类型精确过滤
 * - enabled: 启用状态过滤（true/false）
 * - q: 标题模糊搜索
 */
import { z } from 'zod'
import { listPlaybooksDAO } from '~~/server/services/assistant/contract/contractPlaybook.dao'

// z.coerce.boolean() 把 'false' 字符串当作真值（任意非空字符串都为 true），
// 必须显式枚举 'true'/'false' 字面量再 transform。
const QuerySchema = z.object({
    contractType: z.string().optional(),
    enabled: z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true')),
    q: z.string().optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const parsed = QuerySchema.safeParse(getQuery(event))
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    try {
        const list = await listPlaybooksDAO(parsed.data)
        return resSuccess(event, '获取清单要点列表成功', { list, total: list.length })
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : '未知错误'
        logger.error('[admin] 获取合同审查清单失败', { userId: user.id, error: msg })
        return resError(event, 500, msg || '获取清单失败')
    }
})
