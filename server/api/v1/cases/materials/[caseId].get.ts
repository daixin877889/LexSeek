/**
 * 获取案件材料列表
 *
 * GET /api/v1/cases/materials/:caseId
 *
 * 获取指定案件的所有材料（带文件信息和真实处理状态）
 */

import { z } from 'zod'
import { getMaterialsByCaseIdWithStatusService, getMaterialSummariesByMaterials } from '~~/server/services/material/material.service'
import { validateCaseAccessService } from '~~/server/services/case/case.service'
import { CaseMaterialType, CaseMaterialTypeText } from '#shared/types/case'
import { parseErrorMessage } from '#shared/utils/apiResponse'

const paramsSchema = z.object({
    caseId: z.coerce.number().int().positive(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    const caseIdStr = getRouterParam(event, 'caseId')
    const paramsResult = paramsSchema.safeParse({ caseId: caseIdStr })
    if (!paramsResult.success) {
        return resError(event, 400, parseErrorMessage(paramsResult.error, '参数验证失败'))
    }

    const caseId = paramsResult.data.caseId

    try {
        await validateCaseAccessService(caseId, user.id)

        const materials = await getMaterialsByCaseIdWithStatusService(caseId)

        // 跨表查 summary（已迁出 caseMaterials.summary，按 type 分发到识别记录表）
        const summaryMap = await getMaterialSummariesByMaterials(
            materials.map(m => ({ id: m.id, type: m.type, ossFileId: m.ossFileId })),
        )

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
            fileName: m.fileName,
            fileSize: m.fileSize,
            fileType: m.fileType,
        }))

        logger.info('获取案件材料列表成功', { caseId, userId: user.id, count: responseData.length })

        return resSuccess(event, '获取材料列表成功', responseData)
    } catch (error: any) {
        logger.error('获取案件材料列表失败', { caseId, userId: user.id, error: error.message })

        if (error.message === '无权访问该案件') {
            return resError(event, 403, error.message)
        }

        return resError(event, 500, error.message || '获取材料列表失败')
    }
})
