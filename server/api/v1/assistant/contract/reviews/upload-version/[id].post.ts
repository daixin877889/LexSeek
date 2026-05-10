/**
 * POST /api/v1/assistant/contract/reviews/upload-version/:id
 *
 * 客户回传 docx 上传处理入口。返回 SSE 流（text/event-stream）。
 * Body: { ossFileId: number }
 *
 * 错误分支（流打开前）：
 *  - 401 未登录
 *  - 400 reviewId 无效 / body 格式错误
 *  - 403/404 归属校验失败
 *  - 409 审查进行中（busy 状态），不允许上传新版本
 *
 * 流打开后失败：发 upload-version-error 事件再关流。
 *
 * **Feature: contract-review-versioning-phase-b**
 */
import { z } from 'zod'
import { createEventStream } from 'h3'
import { loadOwnedReview } from '~~/server/services/assistant/contract/reviewGuard'
import { uploadClientVersionService } from '~~/server/services/assistant/contract/uploadClientVersion.service'
import { CONTRACT_UPLOAD_VERSION_SSE_EVENT, isContractBusyStatus } from '#shared/types/contract'
import { withLangfuseContext } from '~~/server/lib/langfuse'

const bodySchema = z.object({
    ossFileId: z.number().int().positive(),
})

export default defineEventHandler(async (event) => {
    const guard = await loadOwnedReview(event, { actionLabel: '上传新版本' })
    if (!guard.ok) return resError(event, guard.status, guard.message)
    const { user, review } = guard

    // busy 状态拦截
    if (isContractBusyStatus(review.status)) {
        return resError(event, 409, '审查进行中，请等待完成再上传新版本')
    }

    const raw = await readBody(event)
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    const eventStream = createEventStream(event)

    void withLangfuseContext(
        {
            reviewId: String(review.id),
            caseId: review.caseId ?? undefined,
            userId: user.id,
            vertical: 'contract',
        },
        async () => {
        try {
            for await (const evt of uploadClientVersionService({
                review,
                ossFileId: parsed.data.ossFileId,
                userId: user.id,
            })) {
                const eventName =
                    evt.type === 'progress' ? CONTRACT_UPLOAD_VERSION_SSE_EVENT.PROGRESS
                    : evt.type === 'complete' ? CONTRACT_UPLOAD_VERSION_SSE_EVENT.COMPLETE
                    : CONTRACT_UPLOAD_VERSION_SSE_EVENT.ERROR

                await eventStream.push({ event: eventName, data: JSON.stringify(evt.data) })

                if (evt.type === 'error' || evt.type === 'complete') break
            }
        } catch (e: unknown) {
            logger.error('upload-version handler 异常', { reviewId: review.id, err: e instanceof Error ? e.message : String(e) })
            await eventStream.push({
                event: CONTRACT_UPLOAD_VERSION_SSE_EVENT.ERROR,
                data: JSON.stringify({ step: 'merge', code: 'INTERNAL', message: '服务器内部错误' }),
            })
        } finally {
            await eventStream.close()
        }
        },
    )

    return eventStream.send()
})
