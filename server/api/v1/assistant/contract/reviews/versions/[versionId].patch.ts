/**
 * PATCH /api/v1/assistant/contract/reviews/versions/:versionId
 *
 * 更新版本备注（lawyerNote）。
 *
 * 请求体：
 * - lawyerNote: string | null（最多 200 字）
 *
 * 错误码：
 * - 400：参数错误
 * - 401：未登录
 * - 403：审查不属于当前用户
 * - 404：版本不存在
 */

import { z } from 'zod'
import { loadOwnedReviewByVersionId } from '~~/server/services/assistant/contract/reviewGuard'
import { updateContractReviewVersionNoteDAO } from '~~/server/services/assistant/contract/contractReviewVersion.dao'

const bodySchema = z.object({
    lawyerNote: z.string().max(200).nullable(),
})

export default defineEventHandler(async (event) => {
    const guard = await loadOwnedReviewByVersionId(event, { actionLabel: '修改版本备注' })
    if (!guard.ok) return resError(event, guard.status, guard.message)

    const raw = await readBody(event).catch(() => null)
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')

    const versionId = guard.subId!
    const updated = await updateContractReviewVersionNoteDAO(versionId, parsed.data.lawyerNote)

    return resSuccess(event, '已更新备注', {
        id: updated.id,
        lawyerNote: updated.lawyerNote,
    })
})
