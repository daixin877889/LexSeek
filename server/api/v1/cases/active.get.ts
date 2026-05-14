/**
 * GET /api/v1/cases/active
 *
 * 用户端「我的进行中案件」列表（用于通用问答关联案件 Dialog）。
 * - 严格 owner-only：仅返回当前用户名下的案件
 * - 排除已软删（deletedAt IS NULL）
 * - 排除已归档案件（status != ARCHIVED）
 * - 可选 q 模糊匹配 title
 *
 * Query 参数：
 * - q?: string  关键词（标题子串模糊匹配）
 * - limit?: number  返回上限，默认 100，最大 200
 *
 * 错误码：
 * - 401：未登录
 * - 400：参数校验失败
 *
 * 参见 阶段 5 plan Task 8
 */

import { z } from 'zod'
import { getActiveCasesService } from '~~/server/services/case/case.service'

const querySchema = z.object({
    q: z.string().trim().max(100).optional(),
    limit: z.coerce.number().int().positive().max(200).optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const parsed = querySchema.safeParse(getQuery(event))
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    const items = await getActiveCasesService(user.id, parsed.data)
    return resSuccess(event, '获取成功', { items })
})
