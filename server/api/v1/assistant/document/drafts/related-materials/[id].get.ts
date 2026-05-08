/**
 * GET /api/v1/assistant/document/drafts/related-materials/:id
 *
 * 返回本 draft 能看到的全部材料（本案件材料 ∪ 本 draft 材料，双绑记录去重一次）。
 *
 * 响应字段对齐前端 CaseDetailMaterialItem（app/composables/useCaseDetail.ts:15-27），
 * 供 drafts/[id].vue 的"禁用列表"和"查看所有材料 Sheet"共用。
 *
 * 错误码：
 * - 400 草稿 ID 无效
 * - 401 未登录
 * - 403 非草稿所有者
 * - 404 草稿不存在
 */

import { getDocumentDraftDAO } from '~~/server/services/assistant/document/documentDraft.dao'
import { getMaterialsByCaseOrDraftIdWithStatusService, getMaterialSummariesByMaterials } from '~~/server/services/material/material.service'
import { CaseMaterialType, CaseMaterialTypeText } from '#shared/types/case'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const draftId = Number(getRouterParam(event, 'id'))
    if (!Number.isInteger(draftId) || draftId <= 0) {
        return resError(event, 400, '草稿 ID 无效')
    }

    const draft = await getDocumentDraftDAO(draftId)
    if (!draft) return resError(event, 404, '草稿不存在')
    if (draft.userId !== user.id) return resError(event, 403, '无权访问此草稿')

    const materials = await getMaterialsByCaseOrDraftIdWithStatusService(
        draft.caseId ?? null,
        draft.id,
    )

    // 跨表查 summary（已迁出 caseMaterials.summary，按 type 分发到识别记录表）
    const summaryMap = await getMaterialSummariesByMaterials(
        materials.map(m => ({ id: m.id, type: m.type, ossFileId: m.ossFileId })),
    )

    // 映射到 CaseDetailMaterialItem 形状（与 /api/v1/cases/:caseId/materials 保持风格一致）
    const responseData = materials.map(m => ({
        id: m.id,
        name: m.name,
        type: m.type,
        typeText: CaseMaterialTypeText[m.type as CaseMaterialType] ?? '未知',
        ossFileId: m.ossFileId,
        isEncrypted: m.isEncrypted,
        status: m.realStatus,
        summary: summaryMap.get(m.id) ?? null,
        createdAt: m.createdAt,
        fileName: m.fileName ?? null,
        fileSize: m.fileSize ?? null,
        fileType: m.fileType ?? null,
    }))

    return resSuccess(event, '获取相关材料成功', responseData)
})
