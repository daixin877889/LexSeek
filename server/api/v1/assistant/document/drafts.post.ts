/**
 * POST /api/v1/assistant/document/drafts
 *
 * 创建文书草稿。传入模板 ID 和可选的素材信息，返回草稿 ID 和会话 ID。
 *
 * Body：
 * - templateId: 模板 ID（必填，正整数）
 * - sourceText: 参考文本（可选）
 * - sourceFileIds: 参考文件 ID 列表（可选，正整数数组）
 * - caseId: 关联案件 ID（可选，正整数）
 *
 * 错误码：
 * - 400：参数校验失败
 * - 403：无权使用该模板（scope=user 且非模板所有者）
 * - 404：模板不存在
 *
 * 参见 spec §3.11
 */

import { z } from 'zod'
import { createDraftService } from '~~/server/services/assistant/document/documentDraft.service'

const BodySchema = z.object({
    templateId: z.number().int().positive(),
    sourceText: z.string().optional(),
    sourceFileIds: z.array(z.number().int().positive()).optional(),
    caseId: z.number().int().positive().optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const body = await readBody(event)
    const parsed = BodySchema.safeParse(body)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    const result = await createDraftService({ userId: user.id, ...parsed.data })
    if ('error' in result) {
        return resError(event, result.code, result.error)
    }

    return resSuccess(event, '创建成功', result)
})
