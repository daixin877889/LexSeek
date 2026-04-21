/**
 * 删除文书草稿关联的单条材料（软删 case_materials + 清理向量）
 *
 * DELETE /api/v1/assistant/document/drafts/:id/materials/:materialId
 *
 * 允许删除的前提：材料通过 caseId 或 draftId 与本草稿"可见"。
 * 行为与案件材料 Tab 的删除等价（软删 case_materials），Sheet 与案件 Tab 看到的都会同步消失。
 */

import { z } from 'zod'
import { getDocumentDraftDAO } from '~~/server/services/assistant/document/documentDraft.dao'
import { deleteMaterialService } from '~~/server/services/material/material.service'
import { deleteMaterialEmbeddings } from '~~/server/services/material/materialEmbedding.service'

const paramsSchema = z.object({
    id: z.coerce.number().int().positive(),
    materialId: z.coerce.number().int().positive(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    const parsed = paramsSchema.safeParse({
        id: getRouterParam(event, 'id'),
        materialId: getRouterParam(event, 'materialId'),
    })
    if (!parsed.success) {
        return resError(event, 400, parseErrorMessage(parsed.error, '参数验证失败'))
    }
    const { id: draftId, materialId } = parsed.data

    const draft = await getDocumentDraftDAO(draftId)
    if (!draft) return resError(event, 404, '草稿不存在')
    if (draft.userId !== user.id) return resError(event, 403, '无权操作此草稿')

    // 仅允许删除本草稿"可见"的材料：按 caseId 或 draftId 任一分支匹配
    const material = await prisma.caseMaterials.findFirst({
        where: {
            id: materialId,
            deletedAt: null,
            OR: [
                draft.caseId != null ? { caseId: draft.caseId } : null,
                { draftId: draft.id },
            ].filter((o): o is NonNullable<typeof o> => o != null),
        },
        select: { id: true },
    })
    if (!material) {
        return resError(event, 404, '未找到对应材料或无权删除')
    }

    try {
        await deleteMaterialService(materialId)
        await deleteMaterialEmbeddings(materialId)

        logger.info('文书草稿删除关联材料', {
            draftId,
            materialId,
            userId: user.id,
        })

        return resSuccess(event, '已删除', { id: materialId })
    }
    catch (error) {
        const message = error instanceof Error ? error.message : '删除材料失败'
        logger.error('文书草稿删除关联材料失败', {
            draftId,
            materialId,
            userId: user.id,
            error: message,
        })
        return resError(event, 500, message)
    }
})
