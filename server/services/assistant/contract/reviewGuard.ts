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

// ==================== 子资源 guard（版本 / 风险 / 批注）====================

/** 从子资源 id 反查 review（通用内部函数） */
type ReviewLookup = (subId: number) => Promise<{ reviewId: number } | null>

/**
 * 通用：从任意子资源 id 反查 review 并做 owner 校验。
 * 复用 loadOwnedReview 的 401/400/404/403 语义。
 */
async function loadOwnedReviewFromSubResource(
    event: H3Event,
    paramName: string,
    lookup: ReviewLookup,
    options: LoadOptions = {},
): Promise<ReviewGuardResult> {
    const user = event.context.auth?.user as AuthUser | undefined
    if (!user) return { ok: false, status: 401, message: '请先登录' }

    const subId = Number(getRouterParam(event, paramName))
    if (!Number.isInteger(subId) || subId <= 0) {
        return { ok: false, status: 400, message: `${paramName} 无效` }
    }

    const sub = await lookup(subId)
    if (!sub) return { ok: false, status: 404, message: '资源不存在' }

    const review = await getContractReviewDAO(sub.reviewId)
    if (!review) return { ok: false, status: 404, message: '合同审查不存在' }
    if (review.userId !== user.id) {
        return { ok: false, status: 403, message: `无权${options.actionLabel ?? '访问该合同审查'}` }
    }

    return { ok: true, user, review }
}

/**
 * 通过版本 ID（versionId）校验当前用户是否拥有对应的合同审查。
 * 适用于 GET/PATCH /reviews/versions/:versionId 端点。
 */
export async function loadOwnedReviewByVersionId(
    event: H3Event,
    options: LoadOptions = {},
): Promise<ReviewGuardResult> {
    return loadOwnedReviewFromSubResource(event, 'versionId', async (id) => {
        return prisma.contractReviewVersions.findUnique({
            where: { id },
            select: { reviewId: true },
        })
    }, options)
}

/**
 * 通过风险 ID（riskId）校验当前用户是否拥有对应的合同审查。
 * 适用于 PATCH /reviews/risks/:riskId 端点。
 */
export async function loadOwnedReviewByRiskId(
    event: H3Event,
    options: LoadOptions = {},
): Promise<ReviewGuardResult> {
    return loadOwnedReviewFromSubResource(event, 'riskId', async (id) => {
        return prisma.contractRisks.findUnique({
            where: { id },
            select: { reviewId: true },
        })
    }, options)
}

/**
 * 通过批注 ID（annotationId）校验当前用户是否拥有对应的合同审查。
 * lookup 额外返回 authorUserId，供 handler 校验"只能改自己的批注"。
 * 适用于 PATCH/DELETE /reviews/annotations/:annotationId 端点。
 */
export async function loadOwnedReviewByAnnotationId(
    event: H3Event,
    options: LoadOptions = {},
): Promise<ReviewGuardResult> {
    return loadOwnedReviewFromSubResource(event, 'annotationId', async (id) => {
        return prisma.contractAnnotations.findUnique({
            where: { id },
            select: { reviewId: true, authorUserId: true },
        })
    }, options)
}
