/**
 * 处理材料
 *
 * POST /api/v1/material/process/:id
 *
 * 根据材料类型调用对应的处理服务：
 * - PDF：调用 MinerU 服务
 * - 图片：调用 OCR 服务
 * - 音频：调用 ASR 服务
 * Requirements: 3.8, 3.10, 3.11
 */

import { z } from 'zod'
import {
    getMaterialByIdService,
    updateMaterialStatusService,
    updateMaterialContentService,
} from '~~/server/services/material/material.service'
import { CaseMaterialType, MaterialStatus } from '#shared/types/material'
import { convertPdfService } from '~~/server/services/material/mineru.service'
import { createImageConversionService } from '~~/server/services/material/ocr.service'
import { transcribeAudioService } from '~~/server/services/material/asr.service'
import {
    embedMaterialService,
    type EmbedMaterialInput,
} from '~~/server/services/material/materialEmbedding.service'

// 路径参数验证
const paramsSchema = z.object({
    id: z.coerce.number({ message: '材料 ID 必须为数字' }).int().positive({ message: '材料 ID 必须为正整数' }),
})

// 请求体验证（可选参数）
const bodySchema = z.object({
    /** 是否向量化（默认 true） */
    enableEmbedding: z.boolean().optional().default(true),
    /** MinerU 转换选项 */
    mineruOptions: z.object({
        enableOcr: z.boolean().optional(),
        enableFormula: z.boolean().optional(),
        enableTable: z.boolean().optional(),
        pageRange: z.string().optional(),
    }).optional(),
    /** ASR 转录选项 */
    asrOptions: z.object({
        timestampAlignmentEnabled: z.boolean().optional(),
        languageHints: z.array(z.string()).optional(),
        disfluencyRemovalEnabled: z.boolean().optional(),
        diarizationEnabled: z.boolean().optional(),
    }).optional(),
})

/** 请求体类型 */
type ProcessMaterialBody = z.infer<typeof bodySchema>

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

    // 解析请求体
    const body = await readBody(event)
    const bodyResult = bodySchema.safeParse(body || {})
    const options: ProcessMaterialBody = bodyResult.success ? bodyResult.data : { enableEmbedding: true }

    const materialId = paramsResult.data.id

    try {
        // 获取材料信息
        const material = await getMaterialByIdService(materialId)

        if (!material) {
            return resError(event, 404, '材料不存在')
        }

        // 验证材料所属案件是否属于当前用户
        const caseRecord = await prisma.cases.findFirst({
            where: { id: material.caseId, userId: user.id, deletedAt: null },
        })

        if (!caseRecord) {
            return resError(event, 403, '无权处理此材料')
        }

        // 检查材料状态
        if (material.status === MaterialStatus.COMPLETED) {
            return resError(event, 400, '材料已处理完成，无需重复处理')
        }

        if (material.status === MaterialStatus.PROCESSING) {
            return resError(event, 400, '材料正在处理中，请稍后')
        }

        // 检查是否有 OSS 文件
        if (!material.ossFileId) {
            // 如果没有 OSS 文件但有内容，说明是文本类型或已在浏览器端处理
            if (material.content) {
                return resSuccess(event, '材料已有内容，无需处理', {
                    id: material.id,
                    status: MaterialStatus.COMPLETED,
                })
            }
            return resError(event, 400, '材料没有关联的文件，无法处理')
        }

        // 获取 OSS 文件信息
        const ossFile = await prisma.ossFiles.findFirst({
            where: { id: material.ossFileId, deletedAt: null },
        })

        if (!ossFile) {
            return resError(event, 404, '关联的文件不存在')
        }

        // 更新材料状态为处理中
        await updateMaterialStatusService(materialId, MaterialStatus.PROCESSING)

        // 根据材料类型调用对应的处理服务
        let processResult: { success: boolean; content?: string; error?: string }

        switch (material.type) {
            case MaterialType.DOCUMENT:
                // PDF 文档处理
                processResult = await processPdfMaterial(ossFile.id, user.id, options.mineruOptions)
                break

            case MaterialType.IMAGE:
                // 图片 OCR 处理
                processResult = await processImageMaterial(ossFile.id, user.id)
                break

            case MaterialType.AUDIO:
                // 音频 ASR 处理
                processResult = await processAudioMaterial(ossFile.id, user.id, options.asrOptions)
                break

            default:
                // 文本类型不需要服务端处理
                await updateMaterialStatusService(materialId, MaterialStatus.PENDING)
                return resError(event, 400, '该材料类型不需要服务端处理')
        }

        // 处理结果
        if (!processResult.success) {
            await updateMaterialStatusService(materialId, MaterialStatus.FAILED)
            return resError(event, 500, processResult.error || '材料处理失败')
        }

        // 如果有处理后的内容，更新材料
        if (processResult.content) {
            await updateMaterialContentService(materialId, processResult.content)

            // 向量化处理
            if (options.enableEmbedding !== false) {
                try {
                    // 获取案件会话信息
                    const session = await prisma.caseSessions.findFirst({
                        where: { caseId: material.caseId, deletedAt: null },
                        orderBy: { createdAt: 'desc' },
                    })

                    const embedInput: EmbedMaterialInput = {
                        content: processResult.content,
                        userId: user.id,
                        caseId: material.caseId,
                        materialId: material.id,
                        sessionId: session?.sessionId || '',
                        materialName: material.name,
                        materialType: material.type as MaterialType,
                    }

                    await embedMaterialService(embedInput)
                    logger.info('材料向量化完成', { materialId })
                } catch (embedError: any) {
                    // 向量化失败不影响主流程
                    logger.error('材料向量化失败', {
                        materialId,
                        error: embedError.message,
                    })
                }
            }

            return resSuccess(event, '材料处理成功', {
                id: material.id,
                status: MaterialStatus.COMPLETED,
                contentLength: processResult.content.length,
            })
        }

        // 异步处理（如 MinerU、ASR），返回处理中状态
        return resSuccess(event, '材料处理已提交，请稍后查询结果', {
            id: material.id,
            status: MaterialStatus.PROCESSING,
        })
    } catch (error: any) {
        logger.error('处理材料失败', {
            materialId,
            userId: user.id,
            error: error.message,
        })

        // 尝试更新材料状态为失败
        try {
            await updateMaterialStatusService(materialId, MaterialStatus.FAILED)
        } catch {
            // 忽略状态更新失败
        }

        return resError(event, 500, error.message || '处理材料失败')
    }
})

/**
 * 处理 PDF 材料
 */
async function processPdfMaterial(
    ossFileId: number,
    userId: number,
    options?: {
        enableOcr?: boolean
        enableFormula?: boolean
        enableTable?: boolean
        pageRange?: string
    }
): Promise<{ success: boolean; content?: string; error?: string }> {
    try {
        const result = await convertPdfService(ossFileId, userId, {
            enableOcr: options?.enableOcr,
            enableFormula: options?.enableFormula,
            enableTable: options?.enableTable,
            pageRange: options?.pageRange,
        })

        if (!result.success) {
            return { success: false, error: result.error }
        }

        // MinerU 是异步处理，返回成功但没有内容
        // 内容会在回调或轮询完成后更新
        return { success: true }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
}

/**
 * 处理图片材料
 */
async function processImageMaterial(
    ossFileId: number,
    userId: number
): Promise<{ success: boolean; content?: string; error?: string }> {
    try {
        const result = await createImageConversionService(ossFileId, userId)

        if (!result.success) {
            return { success: false, error: result.error }
        }

        // OCR 是同步处理，直接返回内容
        const content = result.record?.markdownContent || result.record?.htmlContent || undefined
        return { success: true, content }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
}

/**
 * 处理音频材料
 */
async function processAudioMaterial(
    ossFileId: number,
    userId: number,
    options?: {
        timestampAlignmentEnabled?: boolean
        languageHints?: string[]
        disfluencyRemovalEnabled?: boolean
        diarizationEnabled?: boolean
    }
): Promise<{ success: boolean; content?: string; error?: string }> {
    try {
        const result = await transcribeAudioService(ossFileId, userId, {
            timestampAlignmentEnabled: options?.timestampAlignmentEnabled,
            languageHints: options?.languageHints,
            disfluencyRemovalEnabled: options?.disfluencyRemovalEnabled,
            diarizationEnabled: options?.diarizationEnabled,
        })

        if (!result.success) {
            return { success: false, error: result.error }
        }

        // ASR 是异步处理，返回成功但没有内容
        // 内容会在轮询完成后更新
        return { success: true }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
}
