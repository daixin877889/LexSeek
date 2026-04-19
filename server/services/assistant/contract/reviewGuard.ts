/**
 * 合同审查 :id 端点的鉴权 + 加载 guard
 *
 * 6 个 review [id] handler 共享的 4 步样板（401 未登录 → 400 id 无效 →
 * 404 不存在 → 403 越权）抽到这里集中维护，handler 只需调用一次 guard
 * 拿到 { user, review }，业务分支自己负责（status 校验、enqueue 等）。
 */
import type { H3Event } from 'h3'
import type { contractReviews } from '~~/generated/prisma/client'
import { getContractReviewDAO } from './contractReview.dao'

interface AuthUser {
    id: number
    [key: string]: unknown
}

export type ReviewGuardResult =
    | { ok: true; user: AuthUser; review: contractReviews }
    | { ok: false; status: number; message: string }

interface LoadOptions {
    /**
     * 403 文案模板，最终拼成 `无权${actionLabel}`，默认 `访问该合同审查`。
     * 用 PATCH/重生/导出 PDF 等需要明确动作语义的端点应传入更精确的标签。
     */
    actionLabel?: string
}

/**
 * 校验请求合法性并加载当前用户名下的合同审查记录。
 *
 * - 401 `event.context.auth.user` 为空
 * - 400 路径参数 `:id` 不是正整数
 * - 404 review 不存在或已软删（DAO 内已过滤 deletedAt）
 * - 403 review 属于他人
 *
 * 失败时返回 `{ ok: false, status, message }`，handler 直接 `resError(event, status, message)`。
 * 成功时返回 `{ ok: true, user, review }`。
 */
export async function loadOwnedReview(
    event: H3Event,
    options: LoadOptions = {},
): Promise<ReviewGuardResult> {
    const user = event.context.auth?.user as AuthUser | undefined
    if (!user) return { ok: false, status: 401, message: '请先登录' }

    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isInteger(id) || id <= 0) {
        return { ok: false, status: 400, message: '合同审查 ID 无效' }
    }

    const review = await getContractReviewDAO(id)
    if (!review) return { ok: false, status: 404, message: '合同审查不存在' }
    if (review.userId !== user.id) {
        return { ok: false, status: 403, message: `无权${options.actionLabel ?? '访问该合同审查'}` }
    }

    return { ok: true, user, review }
}
