/**
 * POST /api/v1/assistant/document/drafts/:id/materials
 *
 * 把 OSS 文件附到当前文书草稿，触发完整识别+嵌入流水线。
 * 用于"用户在 AI 生成对话框临时附件"场景：附件入库后 search_case_materials
 * 工具才能通过 draftId → caseMaterials → 检索内容。
 *
 * Body：
 * - fileIds: number[]（必填，正整数数组）
 *
 * 错误码：
 * - 400 参数错误
 * - 401 未登录
 * - 403 非草稿所有者
 * - 404 草稿不存在
 */

import { z } from 'zod'
import {
    getDocumentDraftDAO,
} from '~~/server/services/assistant/document/documentDraft.dao'
import { ensureMaterialsReadyForDraftService } from '~~/server/services/material/materialPipeline.service'

const BodySchema = z.object({
    fileIds: z.array(z.number().int().positive()).min(1, 'fileIds 不能为空'),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const draftId = Number(getRouterParam(event, 'id'))
    if (!Number.isInteger(draftId) || draftId <= 0) {
        return resError(event, 400, '草稿 ID 无效')
    }

    const body = await readBody(event)
    const parsed = BodySchema.safeParse(body)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    const draft = await getDocumentDraftDAO(draftId)
    if (!draft) return resError(event, 404, '草稿不存在')
    if (draft.userId !== user.id) return resError(event, 403, '无权操作此草稿')

    // 并行处理（ensureMaterialsReadyForDraftService 内部幂等且会轮询至 COMPLETED）
    const results = await Promise.allSettled(
        parsed.data.fileIds.map(fileId =>
            ensureMaterialsReadyForDraftService(fileId, draftId, user.id),
        ),
    )

    const succeeded: number[] = []
    const failed: { fileId: number; reason: string }[] = []
    parsed.data.fileIds.forEach((fileId, idx) => {
        const r = results[idx]
        if (r && r.status === 'fulfilled') {
            succeeded.push(fileId)
        } else {
            failed.push({
                fileId,
                reason: r && r.status === 'rejected'
                    ? (r.reason instanceof Error ? r.reason.message : String(r.reason))
                    : '未知错误',
            })
        }
    })

    return resSuccess(event, '附件处理完成', {
        succeeded,
        failed,
    })
})
