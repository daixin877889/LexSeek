/**
 * POST /api/v1/assistant/contract/reviews/:id/export-pdf
 *
 * 服务端渲染合同审查 PDF 下载。
 *
 * 请求体：`{ includeRisks: boolean }`
 *
 * 错误分支：
 *  - 401 未登录
 *  - 400 reviewId 无效 / body 校验失败（zod strict）
 *  - 404 review 不存在或不属于当前用户（service 内合并归口）
 *  - 500 生成异常（日志打点）
 *
 * 成功：直接返回 PDF 流（Content-Type: application/pdf）。
 *
 * **Feature: contract-review-m6.2**
 */
import { z } from 'zod'
import {
    exportReviewPdfService,
    ContractReviewNotFoundError,
    ContractReviewForbiddenError,
} from '~~/server/services/assistant/contract/contractReviewPdf.service'
import { loadOwnedReview } from '~~/server/services/assistant/contract/reviewGuard'

const BodySchema = z
    .object({
        includeRisks: z.boolean(),
    })
    .strict()

export default defineEventHandler(async (event) => {
    // body 校验先于 guard：保持 fail-fast 语义
    const rawBody = await readBody(event).catch(() => null)
    if (!rawBody || typeof rawBody !== 'object') {
        return resError(event, 400, '请求体无效')
    }
    const parsed = BodySchema.safeParse(rawBody)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '请求参数错误')
    }

    const guard = await loadOwnedReview(event, { actionLabel: '导出 PDF' })
    if (!guard.ok) return resError(event, guard.status, guard.message)
    const { user, review } = guard

    try {
        const buf = await exportReviewPdfService(review.id, user.id, parsed.data)
        setResponseHeader(event, 'Content-Type', 'application/pdf')
        setResponseHeader(
            event,
            'Content-Disposition',
            `attachment; filename="contract-review-${review.id}.pdf"`,
        )
        setResponseHeader(event, 'Content-Length', buf.length)
        return buf
    }
    catch (e: unknown) {
        // CORE-L1：区分 404 vs 403 vs 500，避免越权访问遮蔽成 404 让日志告警丢
        if (e instanceof ContractReviewNotFoundError) {
            return resError(event, 404, '合同审查不存在')
        }
        if (e instanceof ContractReviewForbiddenError) {
            return resError(event, 403, '无权导出该合同审查')
        }
        const msg = e instanceof Error ? e.message : String(e)
        logger.error('export-pdf failed', {
            reviewId: review.id,
            userId: user.id,
            err: msg,
        })
        return resError(event, 500, 'PDF 生成失败')
    }
})
