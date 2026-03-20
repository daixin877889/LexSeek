/**
 * 材料处理编排服务
 *
 * 根据材料类型分发到对应的处理服务（PDF/图片/音频），
 * 处理结果更新和向量化。
 * Requirements: 3.8, 3.10, 3.11
 */

import {
    getMaterialByIdService,
    updateMaterialStatusService,
    updateMaterialContentService,
    type MaterialWithFile,
} from './material.service'
import { CaseMaterialType } from '#shared/types/case'
import { MaterialStatus } from '#shared/types/material'
import { convertPdfService } from './mineru.service'
import { createImageConversionService } from './ocr.service'
import { transcribeAudioService } from './asr.service'
import type { EmbedMaterialInput } from './materialEmbedding.service'
import { updateMaterialEmbeddingStatusDAO } from '../case/caseMaterial.dao'

/**
 * 材料处理业务错误
 * code 与 resError 的 code 字段对齐
 */
export class MaterialProcessError extends Error {
    constructor(message: string, public code: number) {
        super(message)
        this.name = 'MaterialProcessError'
    }
}

/** 材料处理选项 */
export interface ProcessMaterialOptions {
    /** 是否向量化（默认 true） */
    enableEmbedding?: boolean
    /** MinerU 转换选项 */
    mineruOptions?: {
        enableOcr?: boolean
        enableFormula?: boolean
        enableTable?: boolean
        pageRange?: string
    }
    /** ASR 转录选项 */
    asrOptions?: {
        timestampAlignmentEnabled?: boolean
        languageHints?: string[]
        disfluencyRemovalEnabled?: boolean
        diarizationEnabled?: boolean
    }
}

/** 材料处理结果 */
export interface ProcessMaterialResult {
    id: number
    status: MaterialStatus
    contentLength?: number
    /** 标记材料已有内容无需处理的情况 */
    alreadyCompleted?: boolean
}

/** 内部处理结果类型 */
interface InternalProcessResult {
    success: boolean
    content?: string
    error?: string
}

/**
 * 处理材料（编排函数）
 *
 * 包含授权检查、状态校验、分发到具体处理服务、结果更新和向量化。
 * Requirements: 3.8, 3.10, 3.11
 *
 * @param materialId 材料 ID
 * @param userId 当前用户 ID（用于授权检查）
 * @param options 处理选项
 * @returns 处理结果
 * @throws MaterialProcessError 业务错误（包含 code 用于 API 层返回）
 */
export const processMaterialService = async (
    materialId: number,
    userId: number,
    options: ProcessMaterialOptions = {},
): Promise<ProcessMaterialResult> => {
    // 1. 获取材料信息
    const material = await getMaterialByIdService(materialId)
    if (!material) {
        throw new MaterialProcessError('材料不存在', 404)
    }

    // 2. 授权检查：验证材料所属案件是否属于当前用户
    const caseRecord = await prisma.cases.findFirst({
        where: { id: material.caseId, userId, deletedAt: null },
    })
    if (!caseRecord) {
        throw new MaterialProcessError('无权处理此材料', 403)
    }

    // 3. 状态检查
    if (material.status === MaterialStatus.COMPLETED) {
        throw new MaterialProcessError('材料已处理完成，无需重复处理', 400)
    }
    if (material.status === MaterialStatus.PROCESSING) {
        throw new MaterialProcessError('材料正在处理中，请稍后', 400)
    }

    // 4. OSS 文件检查
    if (!material.ossFileId) {
        if (material.content) {
            return {
                id: material.id,
                status: MaterialStatus.COMPLETED,
                alreadyCompleted: true,
            }
        }
        throw new MaterialProcessError('材料没有关联的文件，无法处理', 400)
    }

    // 5. 获取 OSS 文件信息
    const ossFile = await prisma.ossFiles.findFirst({
        where: { id: material.ossFileId, deletedAt: null },
    })
    if (!ossFile) {
        throw new MaterialProcessError('关联的文件不存在', 404)
    }

    // 6. 更新状态为处理中
    await updateMaterialStatusService(materialId, MaterialStatus.PROCESSING)

    // 7-12. 分发处理（包裹在 try-catch 中，失败时回退状态）
    try {
        // 8. 按类型分发
        let processResult: InternalProcessResult

        switch (material.type) {
            case CaseMaterialType.DOCUMENT:
                processResult = await processPdfMaterial(ossFile.id, userId, options.mineruOptions)
                break
            case CaseMaterialType.IMAGE:
                processResult = await processImageMaterial(ossFile.id, userId)
                break
            case CaseMaterialType.AUDIO:
                processResult = await processAudioMaterial(ossFile.id, userId, options.asrOptions)
                break
            default:
                await updateMaterialStatusService(materialId, MaterialStatus.PENDING)
                throw new MaterialProcessError('该材料类型不需要服务端处理', 400)
        }

        // 9. 处理失败
        if (!processResult.success) {
            try {
                await updateMaterialStatusService(materialId, MaterialStatus.FAILED)
            } catch {
                // 忽略状态更新失败
            }
            throw new MaterialProcessError(processResult.error || '材料处理失败', 500)
        }

        // 10. 有内容则更新材料
        if (processResult.content) {
            await updateMaterialContentService(materialId, processResult.content)

            // 11. 向量化处理
            if (options.enableEmbedding !== false) {
                try {
                    const session = await prisma.caseSessions.findFirst({
                        where: { caseId: material.caseId, deletedAt: null },
                        orderBy: { createdAt: 'desc' },
                    })

                    const embedInput: EmbedMaterialInput = {
                        content: processResult.content,
                        userId,
                        caseId: material.caseId,
                        materialId: material.id,
                        sessionId: session?.sessionId || '',
                        materialName: material.name,
                        materialType: material.type as CaseMaterialType,
                    }

                    const { embedMaterialService } = await import('./materialEmbedding.service')
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

            // 12. 返回同步处理结果
            return {
                id: material.id,
                status: MaterialStatus.COMPLETED,
                contentLength: processResult.content.length,
            }
        }

        // 12. 异步处理（MinerU/ASR），返回处理中状态
        return {
            id: material.id,
            status: MaterialStatus.PROCESSING,
        }
    } catch (error: any) {
        // 状态回退（MaterialProcessError 中部分已处理状态，这里兜底）
        if (!(error instanceof MaterialProcessError)) {
            logger.error('处理材料失败', {
                materialId,
                userId,
                error: error.message,
            })
            try {
                await updateMaterialStatusService(materialId, MaterialStatus.FAILED)
            } catch {
                // 忽略状态更新失败
            }
        }
        throw error
    }
}

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
): Promise<InternalProcessResult> {
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
): Promise<InternalProcessResult> {
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
): Promise<InternalProcessResult> {
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


/**
 * 确保材料列表全部完成嵌入
 *
 * 对未嵌入的材料按类型分类，全并行调用对应的嵌入服务。
 * 失败的材料记录日志但不阻断流程。
 *
 * @param materials 需要嵌入的材料列表
 * @param userId 用户 ID
 * @param caseId 案件 ID
 * @param sessionId 会话 ID
 * @returns 嵌入统计结果
 */
export async function ensureMaterialsEmbeddedService(
    materials: MaterialWithFile[],
    userId: number,
    caseId: number,
    sessionId: string
): Promise<{
    total: number
    success: number
    failed: number
    skipped: number
}> {
    if (materials.length === 0) {
        return { total: 0, success: 0, failed: 0, skipped: 0 }
    }

    const results = await Promise.allSettled(
        materials.map(material => embedSingleMaterial(material, userId, caseId, sessionId))
    )

    let success = 0
    let failed = 0
    let skipped = 0

    for (const result of results) {
        if (result.status === 'fulfilled') {
            switch (result.value) {
                case 'success': success++; break
                case 'failed': failed++; break
                case 'skipped': skipped++; break
            }
        } else {
            // Promise.allSettled rejected 不应发生（内部已 try-catch），但以防万一
            failed++
        }
    }

    return { total: materials.length, success, failed, skipped }
}

/**
 * 嵌入单个材料（内部辅助函数）
 * 按材料类型分发到对应的嵌入服务
 */
async function embedSingleMaterial(
    material: MaterialWithFile,
    userId: number,
    caseId: number,
    sessionId: string
): Promise<'success' | 'failed' | 'skipped'> {
    try {
        if (material.type === CaseMaterialType.CASE_CONTENT) {
            // 文本材料：使用 embedTextMaterialService（含完整状态管理）
            const { embedTextMaterialService } = await import('../case/caseMaterial.service')
            const result = await embedTextMaterialService(material.id, userId, caseId, sessionId)
            return result.success ? 'success' : 'failed'
        }

        // 非文本材料：校验 content
        if (!material.content || material.content.trim() === '') {
            logger.warn('材料内容为空，跳过嵌入', { materialId: material.id, type: material.type })
            return 'skipped'
        }

        // 更新状态为 processing
        await updateMaterialEmbeddingStatusDAO(material.id, 'processing')

        // 构造输入并调用 embedMaterialService（Nuxt 自动导入的全局版本，可通过 vi.stubGlobal mock）
        const input: EmbedMaterialInput = {
            content: material.content,
            userId,
            caseId,
            materialId: material.id,
            sessionId,
            materialName: material.name,
            materialType: material.type as CaseMaterialType,
        }
        await embedMaterialService(input)

        // 更新状态为 completed
        await updateMaterialEmbeddingStatusDAO(material.id, 'completed')
        return 'success'
    } catch (error: any) {
        logger.error('材料嵌入失败', {
            materialId: material.id,
            type: material.type,
            error: error.message,
        })

        // 非文本材料尝试更新状态为 failed（文本材料由 embedTextMaterialService 内部管理状态）
        if (material.type !== CaseMaterialType.CASE_CONTENT) {
            try {
                await updateMaterialEmbeddingStatusDAO(material.id, 'failed')
            } catch {
                // 状态更新失败不阻断
            }
        }

        return 'failed'
    }
}
