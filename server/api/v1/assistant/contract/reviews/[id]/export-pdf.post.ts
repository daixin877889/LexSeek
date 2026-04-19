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
import { exportReviewPdfService } from '~~/server/services/assistant/contract/contractReviewPdf.service'

const BodySchema = z
    .object({
        includeRisks: z.boolean(),
    })
    .strict()

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    const idParam = getRouterParam(event, 'id')
    const reviewId = Number(idParam)
    if (!Number.isInteger(reviewId) || reviewId <= 0) {
        return resError(event, 400, '合同审查 ID 无效')
    }

    const rawBody = await readBody(event)
    const parsed = BodySchema.safeParse(rawBody)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '请求参数错误')
    }

    try {
        const buf = await exportReviewPdfService(reviewId, user.id, parsed.data)
        setResponseHeader(event, 'Content-Type', 'application/pdf')
        setResponseHeader(
            event,
            'Content-Disposition',
            `attachment; filename="contract-review-${reviewId}.pdf"`,
        )
        setResponseHeader(event, 'Content-Length', buf.length)
        return buf
    }
    catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg === 'review not found') {
            return resError(event, 404, '合同审查不存在')
        }
        logger.error('export-pdf failed', { reviewId, err: msg })
        return resError(event, 500, 'PDF 生成失败')
    }
})
