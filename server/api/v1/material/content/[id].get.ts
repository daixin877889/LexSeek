/**
 * 获取材料内容
 *
 * GET /api/v1/material/content/:id
 *
 * 获取材料的处理后内容，支持获取原始内容（需要解密）
 * Requirements: 3.2
 */

import { z } from 'zod'
import {
    getMaterialByIdService,
    getMaterialContentService,
} from '~~/server/services/material/material.service'
import {
    MaterialStatus,
    MaterialStatusText,
} from '#shared/types/material'
import { CaseMaterialType, CaseMaterialTypeText } from '#shared/types/case'

// 路径参数验证
const paramsSchema = z.object({
    id: z.coerce.number({ message: '材料 ID 必须为数字' }).int().positive({ message: '材料 ID 必须为正整数' }),
})

// 查询参数验证
const querySchema = z.object({
    /** 是否包含详细信息 */
    detail: z.coerce.boolean().optional().default(false),
})

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 解析路径参数
    const id = getRouterParam(event, 'id')
    const paramsResult = paramsSchema.safeParse({ id })

    if (!paramsResult.success) {
        return resError(event, 400, parseErrorMessage(paramsResult.error, '参数验证失败'))
    }

    // 解析查询参数
    const query = getQuery(event)
    const queryResult = querySchema.safeParse(query)
    const options = queryResult.success ? queryResult.data : { detail: false }

    const materialId = paramsResult.data.id

    try {
        // 获取材料信息
        const material = await getMaterialByIdService(materialId)

        if (!material) {
            return resError(event, 404, '材料不存在')
        }

        // 验证材料访问权限：通过案件或文书草稿关联到当前用户
        let hasAccess = false
        if (material.caseId != null) {
            const caseRecord = await prisma.cases.findFirst({
                where: { id: material.caseId, userId: user.id, deletedAt: null },
            })
            hasAccess = caseRecord != null
        } else if (material.draftId != null) {
            const draftRecord = await prisma.documentDrafts.findFirst({
                where: { id: material.draftId, userId: user.id, deletedAt: null },
            })
            hasAccess = draftRecord != null
        }

        if (!hasAccess) {
            return resError(event, 403, '无权访问此材料')
        }

        // 检查材料状态
        // 文本材料（CASE_CONTENT）的内容在创建时即就绪，历史数据可能 status 未更新，需兼容
        const isTextMaterial = material.type === CaseMaterialType.CASE_CONTENT

        if (material.status === MaterialStatus.PENDING && !isTextMaterial) {
            return resError(event, 400, '材料尚未处理，请先调用处理接口')
        }

        if (material.status === MaterialStatus.PROCESSING) {
            return resSuccess(event, '材料正在处理中', {
                id: material.id,
                status: material.status,
                statusText: MaterialStatusText[material.status as MaterialStatus],
                content: null,
            })
        }

        if (material.status === MaterialStatus.FAILED) {
            return resError(event, 500, '材料处理失败，请重试')
        }

        // 获取材料内容
        const content = await getMaterialContentService(materialId)

        // 构建响应数据
        const responseData: Record<string, any> = {
            id: material.id,
            content,
            status: material.status,
            statusText: MaterialStatusText[material.status as MaterialStatus],
        }

        // 如果需要详细信息
        if (options.detail) {
            responseData.caseId = material.caseId
            responseData.name = material.name
            responseData.type = material.type
            responseData.typeText = CaseMaterialTypeText[material.type as CaseMaterialType]
            responseData.ossFileId = material.ossFileId
            responseData.isEncrypted = material.isEncrypted
            responseData.createdAt = material.createdAt
            responseData.updatedAt = material.updatedAt

            // 如果有关联的文件信息
            if (material.fileName) {
                responseData.file = {
                    name: material.fileName,
                    size: material.fileSize,
                    type: material.fileType,
                }
            }
        }

        return resSuccess(event, '获取材料内容成功', responseData)
    } catch (error: any) {
        logger.error('获取材料内容失败', {
            materialId,
            userId: user.id,
            error: error.message,
        })
        return resError(event, 500, error.message || '获取材料内容失败')
    }
})
