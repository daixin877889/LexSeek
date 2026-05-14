/**
 * PATCH /api/v1/assistant/document/drafts/:id
 *
 * 更新文书草稿。支持两种独立场景，body 必须二选一（或同时提供）：
 *
 * 1. 更新 values（占位符填值，原有功能）
 *    - 草稿处于 drafting/filling 状态时拒绝（409）
 *    - 不在 template.placeholders 中的 key 会被忽略
 * 2. 关联 / 解绑案件（阶段 5 新增 - 通用问答关联案件 Dialog）
 *    - caseId: number  → 关联到指定案件（必须归属当前用户 + 未软删 + 非已归档）
 *    - caseId: null    → 解除关联
 *
 * Body：
 * - values?: Record<string, string | null>
 * - caseId?: number | null
 *
 * 错误码：
 * - 400：参数校验失败
 * - 403：无权修改 / 案件无权访问
 * - 404：草稿不存在
 * - 409：草稿正在生成中 / 案件已归档
 *
 * 参见 spec §3.11 + 阶段 5 plan Task 6
 */

import { z } from 'zod'
import {
    patchDraftService,
    linkDraftToCaseService,
} from '~~/server/services/assistant/document/documentDraft.service'

const BodySchema = z.object({
    values: z.record(z.string(), z.string().nullable()).optional(),
    caseId: z.number().int().positive().nullable().optional(),
}).refine(b => b.values !== undefined || b.caseId !== undefined, {
    message: '必须提供 values 或 caseId',
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const idStr = getRouterParam(event, 'id')
    const id = Number(idStr)
    if (!idStr || !Number.isInteger(id) || id <= 0) {
        return resError(event, 400, '草稿 ID 无效')
    }

    const body = await readBody(event).catch(() => ({}))
    const parsed = BodySchema.safeParse(body)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    // 关联 / 解绑案件：caseId 字段存在（包含 null）
    if (parsed.data.caseId !== undefined) {
        const linkResult = await linkDraftToCaseService(user.id, id, parsed.data.caseId)
        if ('error' in linkResult) {
            return resError(event, linkResult.code, linkResult.error)
        }
        // 仅传 caseId 时直接返回；同时传 values 时继续走 patch 流程
        if (parsed.data.values === undefined) {
            return resSuccess(event, '关联成功', linkResult)
        }
    }

    // 更新 values
    if (parsed.data.values !== undefined) {
        const result = await patchDraftService(user.id, id, { values: parsed.data.values })
        if ('error' in result) {
            return resError(event, result.code, result.error)
        }
        return resSuccess(event, '更新成功', result)
    }

    // 不应到达：refine 已经拦截
    return resError(event, 400, '参数错误')
})
