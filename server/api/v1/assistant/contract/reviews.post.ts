/**
 * POST /api/v1/assistant/contract/reviews
 *
 * 创建合同审查任务。支持两种来源：
 * - sourceType='upload'：传 ossFileId 引用已上传的 .docx 文件
 * - sourceType='paste'：传 text 粘贴文本，服务端转换为 .docx 后存储
 *
 * 返回 { reviewId, sessionId }。
 *
 * 错误码：
 * - 400：参数校验失败 / 非 .docx MIME / sourceType 不支持
 * - 401：未登录
 * - 403：ossFileId 不属于当前用户
 * - 413：粘贴文本过长（> 50000 字）
 *
 * 参见 spec §11 - 合同审查
 */

import { z } from 'zod'
import { createAndStartContractReviewService } from '~~/server/services/assistant/contract/contractReview.service'

const BodySchema = z.object({
    sourceType: z.enum(['upload', 'paste']),
    ossFileId: z.number().int().positive().optional(),
    text: z.string().optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const body = await readBody(event)
    const parsed = BodySchema.safeParse(body)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    const result = await createAndStartContractReviewService({
        userId: user.id,
        ...parsed.data,
    })

    if ('error' in result) {
        return resError(event, result.code, result.error)
    }

    return resSuccess(event, '创建成功', result)
})
