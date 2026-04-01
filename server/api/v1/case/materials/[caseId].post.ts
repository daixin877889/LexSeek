/**
 * 向已有案件添加材料
 *
 * POST /api/v1/case/materials/:caseId
 *
 * 仅支持文件类材料（type=2/3/4），不支持文本（type=1）
 */

import { z } from 'zod'
import pLimit from 'p-limit'
import { CaseMaterialType } from '#shared/types/case'
import type { CaseMaterialParam } from '#shared/types/case'
import { validateCaseAccessService } from '~~/server/services/case/case.service'
import { batchAddCaseMaterialsService } from '~~/server/services/case/caseMaterial.service'
import { getMaterialsByCaseIdWithStatusService } from '~~/server/services/material/material.service'
import { CaseMaterialTypeText } from '#shared/types/case'

const paramsSchema = z.object({
    caseId: z.coerce.number().int().positive(),
})

const materialSchema = z.object({
    type: z.number().int().refine(
        (val) => [CaseMaterialType.DOCUMENT, CaseMaterialType.IMAGE, CaseMaterialType.AUDIO].includes(val),
        { message: '仅支持文件类材料（文档、图片、音频）' },
    ),
    name: z.string().optional(),
    ossFileId: z.number().int().positive({ message: '文件材料必须提供 ossFileId' }),
})

const bodySchema = z.object({
    materials: z.array(materialSchema).min(1, { message: '至少需要提供一个材料' }),
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

    const body = await readBody(event)
    const bodyResult = bodySchema.safeParse(body)
    if (!bodyResult.success) {
        return resError(event, 400, parseErrorMessage(bodyResult.error, '参数验证失败'))
    }

    try {
        // 1. 验证用户权限
        await validateCaseAccessService(caseId, user.id)

        // 2. 后端去重：查询当前案件已有材料的 ossFileId
        const existingMaterials = await getMaterialsByCaseIdWithStatusService(caseId)
        const existingOssFileIds = new Set(
            existingMaterials.filter(m => m.ossFileId).map(m => m.ossFileId),
        )
        const newMaterials = bodyResult.data.materials.filter(
            m => !existingOssFileIds.has(m.ossFileId),
        )

        if (newMaterials.length === 0) {
            return resSuccess(event, '所有材料已存在，无需重复添加', [])
        }

        // 3. 批量添加材料
        await batchAddCaseMaterialsService(
            caseId,
            user.id,
            newMaterials as CaseMaterialParam[],
        )

        // 4. 查询新增的材料记录（通过 ossFileId 匹配）
        const allMaterials = await getMaterialsByCaseIdWithStatusService(caseId)
        const newOssFileIds = new Set(newMaterials.map(m => m.ossFileId))
        const addedMaterials = allMaterials.filter(
            m => m.ossFileId && newOssFileIds.has(m.ossFileId),
        )

        // 5. 异步触发识别（fire-and-forget，限制并发避免 429 限流）
        const materialIdsToProcess = addedMaterials.map(m => m.id)
        if (materialIdsToProcess.length > 0) {
            const limit = pLimit(5)
            Promise.allSettled(
                materialIdsToProcess.map(id =>
                    limit(() => processMaterialService(id, user.id).catch(err => {
                        logger.warn('材料处理失败', { materialId: id, error: err.message })
                    })),
                ),
            ).catch(() => {})
        }

        // 6. 返回新增材料列表
        const responseData = addedMaterials.map(m => ({
            id: m.id,
            name: m.name,
            type: m.type,
            typeText: CaseMaterialTypeText[m.type as CaseMaterialType] ?? '未知',
            ossFileId: m.ossFileId,
            isEncrypted: m.isEncrypted,
            status: m.realStatus,
            summary: m.summary,
            fileName: m.fileName,
            fileSize: m.fileSize,
            fileType: m.fileType,
        }))

        logger.info('添加案件材料成功', {
            caseId,
            userId: user.id,
            count: responseData.length,
        })

        return resSuccess(event, '添加材料成功', responseData)
    } catch (error: any) {
        logger.error('添加案件材料失败', {
            caseId,
            userId: user.id,
            error: error.message,
        })

        if (error.message === '无权访问该案件') {
            return resError(event, 403, error.message)
        }

        return resError(event, 500, error.message || '添加材料失败')
    }
})
