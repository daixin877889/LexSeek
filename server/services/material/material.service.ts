/**
 * 材料服务层
 *
 * 提供案件材料的基础管理功能，包括材料保存、内容获取等
 * Requirements: 3.1, 3.2
 */

import type { caseMaterials, Prisma } from '~~/generated/prisma/client'
import {
    createMaterialDao,
    findMaterialByIdDao,
    findManyMaterialsDao,
    findMaterialsByCaseIdDao,
    findMaterialsByCaseOrDraftIdDao,
    findMaterialsByDraftIdDao,
    findMaterialsByIdsDao,
    updateMaterialDao,
    deleteMaterialDao,
} from './material.dao'
import {
    findTextContentRecordByMaterialIdDAO,
} from './textContentRecords.dao'
import { findRecognitionRecordsByOssFileIdsDao } from './material.dao'
import type { CreateMaterialInput, UpdateMaterialInput, MaterialQueryOptions } from '#shared/types/material'
import { MaterialStatus } from '#shared/types/material'
import { CaseMaterialType } from '#shared/types/case'
import { createChatModel } from '../node/chatModelFactory'
import { getValidNodeConfig } from '../node/node.service'
import { generateSummaryService } from '../ai/summaryService'
import { findDocRecognitionByOssFileIdDao } from './mineru.dao'
import type { asrRecords, ossFiles } from '~~/generated/prisma/client'
import { withLangfuseContext } from '~~/server/lib/langfuse'

/** 材料（包含文件信息） */
export interface MaterialWithFile extends caseMaterials {
    /** 文件名 */
    fileName?: string
    /** 文件大小 */
    fileSize?: number
    /** 文件类型 */
    fileType?: string
    /** 文件路径 */
    filePath?: string
}

// ==================== 共享辅助函数 ====================

/**
 * 为材料列表批量附加 OSS 文件信息
 * 提取公共的 ossFiles 查询 + fileMap 合并逻辑，供多个 Service 复用
 */
async function attachOssFileInfo(materials: caseMaterials[]): Promise<MaterialWithFile[]> {
    const ossFileIds = materials
        .filter((m) => m.ossFileId !== null)
        .map((m) => m.ossFileId as number)

    let fileMap = new Map<number, { fileName: string; fileSize: number; fileType: string; filePath?: string }>()

    if (ossFileIds.length > 0) {
        const ossFiles = await prisma.ossFiles.findMany({
            where: { id: { in: ossFileIds }, deletedAt: null },
            select: { id: true, fileName: true, fileSize: true, fileType: true, filePath: true },
        })
        fileMap = new Map(
            ossFiles.map((file) => [
                file.id,
                {
                    fileName: file.fileName,
                    fileSize: Number(file.fileSize),
                    fileType: file.fileType,
                    filePath: file.filePath ?? undefined,
                },
            ])
        )
    }

    return materials.map((material) => {
        const fileInfo = material.ossFileId ? fileMap.get(material.ossFileId) : undefined
        return {
            ...material,
            fileName: fileInfo?.fileName,
            fileSize: fileInfo?.fileSize,
            fileType: fileInfo?.fileType,
            filePath: fileInfo?.filePath,
        }
    })
}

// ==================== 服务层 ====================

/**
 * 创建材料
 * Requirements: 3.1, 3.2
 */
export const createMaterialService = async (
    data: CreateMaterialInput,
    tx?: Prisma.TransactionClient
): Promise<caseMaterials> => {
    // 应用层 XOR 校验：caseId 和 draftId 不能同时存在
    if (data.caseId !== null && data.caseId !== undefined && data.draftId !== undefined) {
        throw new Error('caseId 和 draftId 不能同时传入')
    }

    // 案件场景：验证案件是否存在
    if (data.caseId !== null && data.caseId !== undefined) {
        const caseExists = await (tx || prisma).cases.findFirst({
            where: { id: data.caseId, deletedAt: null },
        })
        if (!caseExists) {
            throw new Error('案件不存在')
        }
    }

    return await createMaterialDao(data, tx)
}

/**
 * 获取材料详情
 */
export const getMaterialByIdService = async (
    id: number
): Promise<MaterialWithFile | null> => {
    const material = await findMaterialByIdDao(id)
    if (!material) {
        return null
    }

    // 如果有关联的 OSS 文件，获取文件信息
    if (material.ossFileId) {
        const ossFile = await prisma.ossFiles.findFirst({
            where: { id: material.ossFileId, deletedAt: null },
            select: { fileName: true, fileSize: true, fileType: true, filePath: true },
        })

        return {
            ...material,
            fileName: ossFile?.fileName,
            fileSize: ossFile?.fileSize ? Number(ossFile.fileSize) : undefined,
            fileType: ossFile?.fileType,
            filePath: ossFile?.filePath ?? undefined,
        }
    }

    return material
}

/**
 * 获取材料列表（分页）
 */
export const getMaterialsService = async (
    options: MaterialQueryOptions = {}
): Promise<{ list: MaterialWithFile[]; total: number }> => {
    const { list, total } = await findManyMaterialsDao(options)
    return { list: await attachOssFileInfo(list), total }
}

/**
 * 获取案件的所有材料
 */
export const getMaterialsByCaseIdService = async (
    caseId: number
): Promise<MaterialWithFile[]> => {
    const materials = await findMaterialsByCaseIdDao(caseId)
    return attachOssFileInfo(materials)
}

/**
 * 获取文书草稿的所有材料
 */
export const getMaterialsByDraftIdService = async (
    draftId: number
): Promise<MaterialWithFile[]> => {
    const materials = await findMaterialsByDraftIdDao(draftId)
    return attachOssFileInfo(materials)
}

/** 带真实状态的材料项 */
export interface MaterialWithRealStatus extends MaterialWithFile {
    /** 真实状态：1=待处理, 2=处理中, 3=已完成, 4=失败 */
    realStatus: number
}

/**
 * 根据识别表判断材料的真实状态，并附加到材料项上（不依赖 case_materials.status）
 *
 * 抽公共函数供 caseId / caseId|draftId 两个入口复用。
 */
async function computeRealStatusForMaterials(
    materials: MaterialWithFile[],
): Promise<MaterialWithRealStatus[]> {
    if (materials.length === 0) return []

    // 收集需要查询的 ossFileId 和 materialId
    const ossFileIds = materials
        .filter(m => m.ossFileId !== null)
        .map(m => m.ossFileId as number)

    const materialIds = materials
        .filter(m => m.type === CaseMaterialType.CASE_CONTENT)
        .map(m => m.id)

    // 并行查询各识别表
    const { docRecords, imageRecords, asrRecords, textRecords } =
        await findRecognitionRecordsByOssFileIdsDao(ossFileIds, materialIds)

    const docMap = new Map(docRecords.map(r => [r.ossFileId, r.status]))
    const imageMap = new Map(imageRecords.map(r => [r.ossFileId, r.status]))
    const asrMap = new Map(asrRecords.map(r => [r.ossFileId, r.status]))
    const textMap = new Map(
        textRecords.filter(r => r.materialId !== null).map(r => [r.materialId as number, !!r.content]),
    )

    // 根据识别表判断真实状态
    function getRealStatus(material: MaterialWithFile): number {
        switch (material.type) {
            case CaseMaterialType.CASE_CONTENT: {
                const hasContent = textMap.get(material.id)
                return hasContent ? 3 : 1
            }
            case CaseMaterialType.DOCUMENT: {
                if (!material.ossFileId) return 1
                const status = docMap.get(material.ossFileId)
                if (status === undefined) return 1
                if (status === 2) return 3  // SUCCESS
                if (status === 1) return 2  // PROCESSING
                if (status === 3) return 4  // FAILED
                return 1
            }
            case CaseMaterialType.IMAGE: {
                if (!material.ossFileId) return 1
                const status = imageMap.get(material.ossFileId)
                if (status === undefined) return 1
                if (status === 2) return 3  // COMPLETED
                if (status === 1) return 2  // PROCESSING
                if (status === 3) return 4  // FAILED
                return 1
            }
            case CaseMaterialType.AUDIO: {
                if (!material.ossFileId) return 1
                const status = asrMap.get(material.ossFileId)
                if (status === undefined) return 1
                if (status === 2) return 3  // SUCCESS
                if (status === 1) return 2  // PROCESSING
                if (status === 3) return 4  // FAILED
                return 1
            }
            default:
                return 1
        }
    }

    return materials.map(material => ({ ...material, realStatus: getRealStatus(material) }))
}

/**
 * 获取案件的所有材料（带真实状态）
 * 状态通过关联的识别表判断，不依赖 case_materials.status
 */
export const getMaterialsByCaseIdWithStatusService = async (
    caseId: number,
): Promise<MaterialWithRealStatus[]> => {
    const materials = await getMaterialsByCaseIdService(caseId)
    return computeRealStatusForMaterials(materials)
}

/**
 * 按 caseId 或 draftId 合并获取材料（无 realStatus，供检索/工具用）
 *
 * OR 合并：caseId 命中 ∪ draftId 命中，DAO 层走 Prisma OR 天然去重。
 */
export const getMaterialsByCaseOrDraftIdService = async (
    caseId: number | null,
    draftId: number | null,
): Promise<MaterialWithFile[]> => {
    const materials = await findMaterialsByCaseOrDraftIdDao(caseId, draftId)
    return attachOssFileInfo(materials)
}

/**
 * 按 caseId 或 draftId 合并获取材料（带真实状态，供 related-materials API 用）
 */
export const getMaterialsByCaseOrDraftIdWithStatusService = async (
    caseId: number | null,
    draftId: number | null,
): Promise<MaterialWithRealStatus[]> => {
    const materials = await getMaterialsByCaseOrDraftIdService(caseId, draftId)
    return computeRealStatusForMaterials(materials)
}

/**
 * 获取材料内容
 * Requirements: 3.1, 3.2
 */
export const getMaterialContentService = async (
    id: number
): Promise<string | null> => {
    const material = await findMaterialByIdDao(id)
    if (!material) {
        return null
    }

    // 从 textContentRecords 获取内容（content 已迁移到该表）
    const record = await findTextContentRecordByMaterialIdDAO(id)
    return record?.content ?? null
}

/**
 * 更新材料
 */
export const updateMaterialService = async (
    id: number,
    data: UpdateMaterialInput,
    tx?: Prisma.TransactionClient
): Promise<caseMaterials> => {
    // 检查材料是否存在
    const existing = await findMaterialByIdDao(id, tx)
    if (!existing) {
        throw new Error('材料不存在')
    }

    return await updateMaterialDao(id, data, tx)
}

/**
 * 更新材料状态
 */
export const updateMaterialStatusService = async (
    id: number,
    status: MaterialStatus,
    tx?: Prisma.TransactionClient
): Promise<caseMaterials> => {
    return await updateMaterialDao(id, { status }, tx)
}

/**
 * 更新材料状态为已完成
 * content 已迁移到 textContentRecords/docRecognitionRecords 等识别记录表
 */
export const updateMaterialContentService = async (
    id: number,
    tx?: Prisma.TransactionClient
): Promise<caseMaterials> => {
    return await updateMaterialDao(
        id,
        { status: MaterialStatus.COMPLETED },
        tx
    )
}

/**
 * ASR / MinerU 等异步识别完成时调用：把所有引用该 ossFile 的活跃 caseMaterials
 * 切到目标状态（COMPLETED / FAILED）。COMPLETED 时异步触发 100 字摘要生成。
 *
 * 历史 bug：ASR/MinerU 的 complete*Service 只更新自己的 records 表（asrRecords /
 * docRecognitionRecords），不切 caseMaterials.status，导致 case 列表里音频/PDF 永远
 * 显示"待识别"。原本只有 ensureMaterialsReadyForDraftService 走 draft 单文件路径才有轮询
 * 兜底切状态——普通案件 fire-and-forget 上传走 processMaterialService 完全没人切。
 *
 * 业务边界：理论上一个 ossFile 一般只对应一条 caseMaterials，但跨 case/draft 引用同一文件
 * 时可能多条，故用 updateMany + findMany 全部切。
 */
export async function markMaterialsByOssFileIdService(
    ossFileId: number,
    status: MaterialStatus.COMPLETED | MaterialStatus.FAILED,
): Promise<void> {
    const records = await prisma.caseMaterials.findMany({
        where: { ossFileId, deletedAt: null },
        select: { id: true },
    })
    if (records.length === 0) return

    await prisma.caseMaterials.updateMany({
        where: { ossFileId, deletedAt: null },
        data: { status },
    })

    if (status === MaterialStatus.COMPLETED) {
        for (const r of records) {
            generateMaterialSummaryService(r.id).catch(() => { /* 已在内部 catch */ })
        }
    }
}

/**
 * 删除材料
 */
export const deleteMaterialService = async (
    id: number,
    tx?: Prisma.TransactionClient
): Promise<caseMaterials> => {
    // 检查材料是否存在
    const existing = await findMaterialByIdDao(id, tx)
    if (!existing) {
        throw new Error('材料不存在')
    }

    return await deleteMaterialDao(id, tx)
}

/**
 * 批量获取材料
 */
export const getMaterialsByIdsService = async (
    ids: number[]
): Promise<MaterialWithFile[]> => {
    const materials = await findMaterialsByIdsDao(ids)
    return attachOssFileInfo(materials)
}

/**
 * 获取案件已完成处理的材料内容（聚合）
 * 用于工作流中获取所有材料的文本内容
 * content 已迁移到 textContentRecords 表
 */
export const getCompletedMaterialsContentService = async (
    caseId: number
): Promise<{ materialId: number; name: string; type: CaseMaterialType; content: string }[]> => {
    // 获取已完成状态的材料
    const materials = await prisma.caseMaterials.findMany({
        where: {
            caseId,
            status: MaterialStatus.COMPLETED,
            deletedAt: null,
        },
        select: {
            id: true,
            name: true,
            type: true,
        },
        orderBy: { createdAt: 'asc' },
    })

    if (materials.length === 0) {
        return []
    }

    // 从 textContentRecords 获取内容
    const textRecords = await prisma.textContentRecords.findMany({
        where: {
            materialId: { in: materials.map(m => m.id) },
            content: { not: null },
            deletedAt: null,
        },
        select: {
            materialId: true,
            content: true,
        },
    })

    const contentMap = new Map(
        textRecords
            .filter(r => r.materialId !== null && r.content !== null)
            .map(r => [r.materialId as number, r.content as string])
    )

    return materials
        .filter(m => contentMap.has(m.id))
        .map(m => ({
            materialId: m.id,
            name: m.name,
            type: m.type as CaseMaterialType,
            content: contentMap.get(m.id) as string,
        }))
}

/**
 * 检查案件是否有待处理的材料
 */
export const hasPendingMaterialsService = async (
    caseId: number
): Promise<boolean> => {
    const count = await prisma.caseMaterials.count({
        where: {
            caseId,
            status: { in: [MaterialStatus.PENDING, MaterialStatus.PROCESSING] },
            deletedAt: null,
        },
    })
    return count > 0
}

/**
 * 获取案件材料统计
 */
export const getMaterialsStatsService = async (
    caseId: number
): Promise<{
    total: number
    pending: number
    processing: number
    completed: number
    failed: number
}> => {
    const [total, pending, processing, completed, failed] = await Promise.all([
        prisma.caseMaterials.count({
            where: { caseId, deletedAt: null },
        }),
        prisma.caseMaterials.count({
            where: { caseId, status: MaterialStatus.PENDING, deletedAt: null },
        }),
        prisma.caseMaterials.count({
            where: { caseId, status: MaterialStatus.PROCESSING, deletedAt: null },
        }),
        prisma.caseMaterials.count({
            where: { caseId, status: MaterialStatus.COMPLETED, deletedAt: null },
        }),
        prisma.caseMaterials.count({
            where: { caseId, status: MaterialStatus.FAILED, deletedAt: null },
        }),
    ])

    return { total, pending, processing, completed, failed }
}

/**
 * 为材料生成 100 字摘要并写入 caseMaterials.summary
 * 触发时机：材料文本就绪（OCR/ASR 完成）后异步调用
 * 失败不阻塞主流程，仅 logger.warn
 */
export async function generateMaterialSummaryService(materialId: number): Promise<void> {
    return withLangfuseContext(
        { materialId: String(materialId), vertical: 'material-summary' },
        () => generateMaterialSummaryInner(materialId),
    )
}

async function generateMaterialSummaryInner(materialId: number): Promise<void> {
    try {
        const material = await prisma.caseMaterials.findUnique({
            where: { id: materialId },
            select: { id: true, ossFileId: true, type: true },
        })
        if (!material) return

        const content = await loadMaterialText(materialId, 500)
        if (!content) return

        const config = await getValidNodeConfig('materialAutoSummary', '材料自动摘要')
        const apiKey = config.modelApiKeys.find(k => k.status === 1)?.apiKey
        if (!apiKey) {
            logger.warn('materialAutoSummary 节点无可用 API Key', { materialId })
            return
        }
        const systemPrompt = config.prompts.find(p => p.type === 'system' && p.status === 1)?.content
        if (!systemPrompt) {
            logger.warn('materialAutoSummary 节点无 system prompt', { materialId })
            return
        }

        const model = createChatModel({
            sdkType: config.modelSdkType,
            modelName: config.modelName,
            apiKey,
            baseUrl: config.modelProviderBaseUrl,
            temperature: 0,
            streaming: false,
        })
        // 注意：调用 LLM 但不写回——caseMaterials.summary 已删，
        // Task 3 将把简介按 type 分发写入 4 张识别记录表（doc/image/asr/textContent）。
        // 此处暂时留空写入路径，仍消耗 LLM 配额；Task 3 落地前调用此函数没有持久化效果。
        await generateSummaryService(model, content, { maxChars: 100, systemPrompt })
    } catch (e) {
        logger.warn('generateMaterialSummaryService 失败（不阻塞主流程）', { materialId, error: e })
    }
}

/**
 * 读材料正文前 maxChars 字（用于摘要生成）
 */
async function loadMaterialText(materialId: number, maxChars: number): Promise<string> {
    const m = await prisma.caseMaterials.findUnique({
        where: { id: materialId },
        select: { id: true, type: true, ossFileId: true },
    })
    if (!m) return ''
    // 文本：从 textContentRecords 读
    if (m.type === CaseMaterialType.CASE_CONTENT) {
        const record = await findTextContentRecordByMaterialIdDAO(materialId)
        return (record?.content ?? '').slice(0, maxChars)
    }
    // 文档 / 图片：走 OCR（docRecognitionRecords → markdownContent）
    if ((m.type === CaseMaterialType.DOCUMENT || m.type === CaseMaterialType.IMAGE) && m.ossFileId) {
        const record = await findDocRecognitionByOssFileIdDao(m.ossFileId)
        return (record?.markdownContent ?? '').slice(0, maxChars)
    }
    // 音频：从 asrRecords 读 summary
    if (m.type === CaseMaterialType.AUDIO && m.ossFileId) {
        const asr = await prisma.asrRecords.findFirst({
            where: { ossFileId: m.ossFileId, deletedAt: null },
            select: { summary: true },
        })
        if (asr?.summary) return asr.summary.slice(0, maxChars)
    }
    return ''
}

// ==================== 跨表摘要查询 ====================

/** 输入：批量按材料查 200 字摘要时所需的最小字段集 */
export interface MaterialSummaryInput {
    id: number
    type: number  // CaseMaterialType
    ossFileId: number | null
}

/**
 * 批量按材料查 200 字摘要，按 type 分组并行查 4 张表后合并到 Map<materialId, summary>。
 *
 * - 4 种类型并行查询（Promise.all），单次往返时间取决于最慢的那张表
 * - 找不到识别记录或 summary 为 null 的 materialId 不进 Map（调用方自行处理 fallback）
 *
 * 用途：替换原来读 caseMaterials.summary 的所有路径（系统提示词构建、material API、
 * process_materials 工具等）。
 */
export async function getMaterialSummariesByMaterials(
    inputs: MaterialSummaryInput[],
): Promise<Map<number, string>> {
    const result = new Map<number, string>()
    if (inputs.length === 0) return result

    const textIds = inputs.filter(m => m.type === CaseMaterialType.CASE_CONTENT).map(m => m.id)
    const docOssFileIds = inputs
        .filter(m => m.type === CaseMaterialType.DOCUMENT && m.ossFileId)
        .map(m => m.ossFileId!)
    const imgOssFileIds = inputs
        .filter(m => m.type === CaseMaterialType.IMAGE && m.ossFileId)
        .map(m => m.ossFileId!)
    const audioOssFileIds = inputs
        .filter(m => m.type === CaseMaterialType.AUDIO && m.ossFileId)
        .map(m => m.ossFileId!)

    // 反向映射 ossFileId → materialId[]（同一文件可能被多个材料引用）
    const docOssToMat = new Map<number, number[]>()
    const imgOssToMat = new Map<number, number[]>()
    const audioOssToMat = new Map<number, number[]>()
    for (const m of inputs) {
        if (!m.ossFileId) continue
        const target =
            m.type === CaseMaterialType.DOCUMENT ? docOssToMat
            : m.type === CaseMaterialType.IMAGE ? imgOssToMat
            : m.type === CaseMaterialType.AUDIO ? audioOssToMat
            : null
        if (!target) continue
        const list = target.get(m.ossFileId) ?? []
        list.push(m.id)
        target.set(m.ossFileId, list)
    }

    await Promise.all([
        textIds.length > 0
            ? prisma.textContentRecords
                .findMany({
                    where: { materialId: { in: textIds }, deletedAt: null },
                    select: { materialId: true, summary: true },
                })
                .then(rows => {
                    for (const r of rows) {
                        if (r.materialId && r.summary) result.set(r.materialId, r.summary)
                    }
                })
            : Promise.resolve(),
        docOssFileIds.length > 0
            ? prisma.docRecognitionRecords
                .findMany({
                    where: { ossFileId: { in: docOssFileIds }, deletedAt: null },
                    select: { ossFileId: true, summary: true },
                    orderBy: { createdAt: 'desc' },
                })
                .then(rows => {
                    for (const r of rows) {
                        if (r.ossFileId && r.summary) {
                            for (const matId of docOssToMat.get(r.ossFileId) ?? []) {
                                if (!result.has(matId)) result.set(matId, r.summary)
                            }
                        }
                    }
                })
            : Promise.resolve(),
        imgOssFileIds.length > 0
            ? prisma.imageRecognitionRecords
                .findMany({
                    where: { ossFileId: { in: imgOssFileIds }, deletedAt: null },
                    select: { ossFileId: true, summary: true },
                    orderBy: { createdAt: 'desc' },
                })
                .then(rows => {
                    for (const r of rows) {
                        if (r.ossFileId && r.summary) {
                            for (const matId of imgOssToMat.get(r.ossFileId) ?? []) {
                                if (!result.has(matId)) result.set(matId, r.summary)
                            }
                        }
                    }
                })
            : Promise.resolve(),
        audioOssFileIds.length > 0
            ? prisma.asrRecords
                .findMany({
                    where: { ossFileId: { in: audioOssFileIds }, deletedAt: null },
                    select: { ossFileId: true, summary: true },
                    orderBy: { createdAt: 'desc' },
                })
                .then(rows => {
                    for (const r of rows) {
                        if (r.ossFileId && r.summary) {
                            for (const matId of audioOssToMat.get(r.ossFileId) ?? []) {
                                if (!result.has(matId)) result.set(matId, r.summary)
                            }
                        }
                    }
                })
            : Promise.resolve(),
    ])

    return result
}
