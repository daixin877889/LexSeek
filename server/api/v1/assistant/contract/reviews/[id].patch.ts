/**
 * PATCH /api/v1/assistant/contract/reviews/:id
 *
 * 关联 / 解绑合同审查到案件（阶段 5 法律助手「+ 关联案件」入口）。
 *
 * Body：
 * - caseId: number | null  关联指定案件 ID；传 null 表示解绑
 *
 * 校验：
 * - 审查记录归属当前用户（owner-only）
 * - caseId 非 null 时，案件必须归属当前用户 + 未软删 + 非已归档
 *
 * 错误码：
 * - 400：参数错误
 * - 401：未登录
 * - 403：无权修改 / 案件无权访问
 * - 404：审查记录不存在
 * - 409：案件已归档
 *
 * 参见 阶段 5 plan Task 7
 */

import { z } from 'zod'
import { linkReviewToCaseService } from '~~/server/services/assistant/contract/contractReview.service'

const BodySchema = z.object({
    caseId: z.number().int().positive().nullable(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const idStr = getRouterParam(event, 'id')
    const id = Number(idStr)
    if (!idStr || !Number.isInteger(id) || id <= 0) {
        return resError(event, 400, '合同审查 ID 无效')
    }

    const body = await readBody(event).catch(() => ({}))
    const parsed = BodySchema.safeParse(body)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    const result = await linkReviewToCaseService(user.id, id, parsed.data.caseId)
    if ('error' in result) {
        return resError(event, result.code, result.error)
    }

    return resSuccess(event, '关联成功', { review: result.review })
})
