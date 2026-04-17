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
import { convertPdfService, getDocRecognitionByOssFileIdService } from './mineru.service'
import { createImageConversionService } from './ocr.service'
import { transcribeAudioService } from './asr.service'
import { embedMaterialUnifiedService } from './materialEmbedding.service'

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

    // 2. 授权检查：验证材料所属案件或文书草稿是否属于当前用户
    let hasAccess = false
    if (material.caseId != null) {
        const caseRecord = await prisma.cases.findFirst({
            where: { id: material.caseId, userId, deletedAt: null },
        })
        hasAccess = caseRecord != null
    } else if (material.draftId != null) {
        const draftRecord = await prisma.documentDrafts.findFirst({
            where: { id: material.draftId, userId, deletedAt: null },
        })
        hasAccess = draftRecord != null
    }
    if (!hasAccess) {
        throw new MaterialProcessError('无权处理此材料', 403)
    }

    // 3. 状态检查
    if (material.status === MaterialStatus.COMPLETED) {
        throw new MaterialProcessError('材料已处理完成，无需重复处理', 400)
    }
    if (material.status === MaterialStatus.PROCESSING) {
        throw new MaterialProcessError('材料正在处理中，请稍后', 400)
    }

    // 4. OSS 文件检查：无 OSS 文件的材料，检查是否已有文本内容（CASE_CONTENT 类型）
    if (!material.ossFileId) {
        const existingTextContent = await prisma.textContentRecords.findFirst({
            where: { materialId: material.id, deletedAt: null },
        })
        if (existingTextContent?.content) {
            // 文本材料内容已就绪，执行嵌入后标记完成
            if (options.enableEmbedding !== false) {
                try {
                    await embedMaterialUnifiedService(material.id, userId)
                    logger.info('文本材料向量化完成', { materialId })
                } catch (embedError: any) {
                    logger.error('文本材料向量化失败', {
                        materialId,
                        error: embedError.message,
                    })
                }
            }
            await updateMaterialStatusService(material.id, MaterialStatus.COMPLETED)
            return {
                id: material.id,
                status: MaterialStatus.COMPLETED,
                alreadyCompleted: false,
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
            await updateMaterialContentService(materialId)

            // 11. 向量化处理
            if (options.enableEmbedding !== false) {
                try {
                    await embedMaterialUnifiedService(material.id, userId)
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
        // 异常时回退状态为 pending
        try {
            await updateMaterialStatusService(materialId, MaterialStatus.PENDING)
        } catch {
            // 忽略状态回退失败
        }
        throw new MaterialProcessError(error.message || '材料处理失败', 500)
    }
}

// ============================================
// 内部处理函数
// ============================================

/**
 * 处理 PDF 材料（调用 MinerU 服务）
 */
async function processPdfMaterial(
    ossFileId: number,
    userId: number,
    options?: ProcessMaterialOptions['mineruOptions'],
) {
    try {
        const result = await convertPdfService(ossFileId, userId, {
            enableOcr: options?.enableOcr ?? false,
            enableFormula: options?.enableFormula ?? false,
            enableTable: options?.enableTable ?? false,
            pageRange: options?.pageRange,
        })
        if (!result.success) {
            return { success: false, error: result.error }
        }

        // 已有成功记录：直接获取内容（同步返回）
        if (result.task?.taskId === 'existing') {
            const record = await getDocRecognitionByOssFileIdService(ossFileId)
            if (record?.markdownContent) {
                return { success: true, content: record.markdownContent }
            }
            // 有记录但无内容（理论上不会发生），视为成功但无内容
            return { success: true }
        }

        // 新任务：异步处理，内容通过回调/轮询后更新到 docRecognitionRecords
        return { success: true }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
}

/**
 * 处理图片材料（调用 OCR 服务）
 */
async function processImageMaterial(ossFileId: number, userId: number) {
    try {
        const result = await createImageConversionService(ossFileId, userId)
        if (!result.success) {
            return { success: false, error: result.error }
        }
        return { success: true, content: result.record.markdownContent ?? undefined }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
}

/**
 * 处理音频材料（调用 ASR 服务）
 */
async function processAudioMaterial(
    ossFileId: number,
    userId: number,
    options?: ProcessMaterialOptions['asrOptions'],
) {
    try {
        const result = await transcribeAudioService(ossFileId, userId, {
            timestampAlignmentEnabled: options?.timestampAlignmentEnabled ?? false,
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

// ============================================
// 嵌入服务
// ============================================

/**
 * 嵌入单个材料（内部辅助函数）
 */
async function embedSingleMaterial(
    material: MaterialWithFile,
    userId: number,
): Promise<'success' | 'failed' | 'skipped'> {
    try {
        const result = await embedMaterialUnifiedService(material.id, userId)
        if (result.success) {
            return 'success'
        }
        // 如果返回的 error 包含"内容为空"类信息，视为 skipped
        if (result.error?.includes('内容为空') || result.error?.includes('不存在')) {
            logger.warn('材料嵌入跳过', { materialId: material.id, reason: result.error })
            return 'skipped'
        }
        logger.error('材料嵌入失败', { materialId: material.id, error: result.error })
        return 'failed'
    } catch (error: any) {
        logger.error('材料嵌入异常', { materialId: material.id, error: error.message })
        return 'failed'
    }
}

/**
 * 批量确保材料已嵌入
 *
 * 并行处理所有未嵌入的材料，返回统计结果
 *
 * @param materials 待嵌入的材料列表
 * @param userId 当前用户 ID
 * @returns 处理统计 { total, success, failed, skipped }
 */
export async function ensureMaterialsEmbeddedService(
    materials: MaterialWithFile[],
    userId: number,
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
        materials.map(material => embedSingleMaterial(material, userId))
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
            failed++
        }
    }

    return { total: materials.length, success, failed, skipped }
}

/** 识别记录表中 status=2 表示识别成功 */
const RECOGNITION_SUCCESS_STATUS = 2

/**
 * 通过 ossFileId 批量查询识别记录表，返回已识别的 materialId 集合
 */
function queryRecognitionByOssFileId(
    materials: MaterialWithFile[],
    findMany: (args: any) => Promise<{ ossFileId: number | null }[]>,
    resultMap: Map<number, boolean>,
): Promise<void> {
    const ossToMaterial = new Map(materials.map(m => [m.ossFileId!, m.id]))
    return findMany({
        where: {
            ossFileId: { in: [...ossToMaterial.keys()] },
            status: RECOGNITION_SUCCESS_STATUS,
            deletedAt: null,
        },
        select: { ossFileId: true },
    }).then(records => {
        const seen = new Set<number>()
        for (const r of records) {
            if (r.ossFileId && !seen.has(r.ossFileId)) {
                seen.add(r.ossFileId)
                const materialId = ossToMaterial.get(r.ossFileId)
                if (materialId) resultMap.set(materialId, true)
            }
        }
    })
}

/**
 * 批量检查材料是否已在各识别记录表中完成识别
 *
 * 按材料类型查询对应的识别记录表：
 * - 文本(CASE_CONTENT): textContentRecords，content 非空即已识别
 * - 文档(DOCUMENT): docRecognitionRecords，status === 2 即已识别
 * - 图片(IMAGE): imageRecognitionRecords，status === 2 即已识别
 * - 音频(AUDIO): asrRecords，status === 2 即已识别
 *
 * @returns Map<materialId, boolean>
 */
export async function batchCheckMaterialRecognizedService(
    materials: MaterialWithFile[],
): Promise<Map<number, boolean>> {
    const resultMap = new Map<number, boolean>()
    if (materials.length === 0) return resultMap

    for (const m of materials) {
        resultMap.set(m.id, false)
    }

    const textMaterials = materials.filter(m => m.type === CaseMaterialType.CASE_CONTENT)
    const docMaterials = materials.filter(m => m.type === CaseMaterialType.DOCUMENT && m.ossFileId)
    const imgMaterials = materials.filter(m => m.type === CaseMaterialType.IMAGE && m.ossFileId)
    const audioMaterials = materials.filter(m => m.type === CaseMaterialType.AUDIO && m.ossFileId)

    const queries: Promise<void>[] = []

    if (textMaterials.length > 0) {
        queries.push(
            prisma.textContentRecords.findMany({
                where: {
                    materialId: { in: textMaterials.map(m => m.id) },
                    content: { not: null },
                    deletedAt: null,
                },
                select: { materialId: true },
            }).then(records => {
                for (const r of records) {
                    if (r.materialId) resultMap.set(r.materialId, true)
                }
            })
        )
    }

    if (docMaterials.length > 0) {
        queries.push(queryRecognitionByOssFileId(docMaterials, prisma.docRecognitionRecords.findMany.bind(prisma.docRecognitionRecords), resultMap))
    }

    if (imgMaterials.length > 0) {
        queries.push(queryRecognitionByOssFileId(imgMaterials, prisma.imageRecognitionRecords.findMany.bind(prisma.imageRecognitionRecords), resultMap))
    }

    if (audioMaterials.length > 0) {
        queries.push(queryRecognitionByOssFileId(audioMaterials, prisma.asrRecords.findMany.bind(prisma.asrRecords), resultMap))
    }

    await Promise.all(queries)
    return resultMap
}
