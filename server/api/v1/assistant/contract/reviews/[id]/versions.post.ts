/**
 * POST /api/v1/assistant/contract/reviews/:id/versions
 *
 * 手动保存一个新版本快照（lawyer_save 类型）。
 * 决策 4：律师随时可保存，不加状态门禁（审查进行中也允许）。
 *
 * 请求体：
 * - lawyerNote?: string（可选，最多 200 字）
 *
 * 错误码：
 * - 400：参数错误
 * - 401：未登录
 * - 403：审查不属于当前用户
 * - 404：审查不存在
 * - 409：版本号并发冲突，请重试
 */

import { z } from 'zod'
import { loadOwnedReview } from '~~/server/services/assistant/contract/reviewGuard'
import { saveContractReviewVersionService } from '~~/server/services/assistant/contract/contractReviewVersion.service'

const bodySchema = z.object({
    lawyerNote: z.string().max(200).nullish(),
})

export default defineEventHandler(async (event) => {
    const guard = await loadOwnedReview(event, { actionLabel: '保存新版本' })
    if (!guard.ok) return resError(event, guard.status, guard.message)

    const { user, review } = guard

    // UX-M1：body 可能是 undefined（律师点"一键快存"不带 body），`z.object` 直接拒
    // 会让产品侧体感"按了没反应"。默认成空对象保持 lawyerNote 走 nullish 的分支。
    const raw = (await readBody(event)) ?? {}
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')

    try {
        const version = await saveContractReviewVersionService({
            reviewId: review.id,
            systemLabel: 'lawyer_save',
            lawyerNote: parsed.data.lawyerNote ?? null,
            createdById: user.id,
        })

        return resSuccess(event, '已保存版本', {
            id: version.id,
            versionNumber: version.versionNumber,
            systemLabel: version.systemLabel,
            lawyerNote: version.lawyerNote,
            createdAt: version.createdAt.toISOString(),
        })
    } catch (err: unknown) {
        const e = err as { code?: string }
        // P2002：unique 约束冲突（并发 saveVersion），让前端重试
        if (e?.code === 'P2002') return resError(event, 409, '版本号冲突，请重试')
        throw err
    }
})
