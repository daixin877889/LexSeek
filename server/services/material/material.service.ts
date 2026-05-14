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
import { assembleSystemPromptTemplate } from '../agent-platform/nodeConfig/promptRenderer'
import { generateSummaryService } from '../ai/summaryService'
import { findDocRecognitionByOssFileIdDao, updateDocRecognitionRecordDao } from './mineru.dao'
import { findImageRecognitionByOssFileIdDao, updateImageRecognitionRecordDao } from './ocr.dao'
import { findAsrRecordByOssFileIdDao, updateAsrRecordDao } from './asr.dao'
import { extractTextFromAsrResult } from './asr.service'
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

/** 摘要长度统一 200 字（spec §8.1 拍板） */
const SUMMARY_MAX_CHARS = 200

/**
 * ASR summary 字段有效长度上限（字符）。
 *
 * commit aad0e0a1 之前 asr_records.summary 存的是逐字稿（数千~数万字），
 * 之后语义改成 200 字摘要。历史数据未迁移，旧逐字稿会被 generateMaterialSummaryService
 * 的"已存在 summary 防重早返"逻辑挡住，永远不重生成；snapshotMaterialReadiness 也会
 * 把它当成"已就绪摘要"，绕过 summarizing 状态。阈值 600 = SUMMARY_MAX_CHARS × 3 的
 * 宽容 buffer，与逐字稿动辄数千字明显区分。
 */
export const ASR_SUMMARY_MAX_VALID_CHARS = 600

/** 单次 LLM 失败重试间隔（毫秒，指数退避） */
const RETRY_DELAYS_MS = [5_000, 15_000, 45_000]

/**
 * inflight Map：同一 materialId 的并发请求复用同一 Promise，避免重复 LLM 调用
 */
const inflight = new Map<number, Promise<void>>()

/**
 * inflight Map：同一 ossFileId 的并发请求复用同一 Promise（OssFile 级摘要专用）
 *
 * 与 inflight 是不同命名空间：前者按案件材料 id（已绑定到 caseMaterials），
 * 后者按上传文件 id（caseMaterials 行未必存在）。
 *
 * 跨命名空间防重通过 generateMaterialSummaryInner 入口 await 该 Map 实现。
 */
const ossFileSummaryInflight = new Map<number, Promise<void>>()

/**
 * 为材料生成 200 字摘要。
 *
 * 升级版（spec §4.2）：
 * - 内部按 caseMaterials.{type, ossFileId} 分发到 4 张表的 summary 字段
 *   - CASE_CONTENT → textContentRecords.summary（按 materialId）
 *   - DOCUMENT → docRecognitionRecords.summary（按 ossFileId）
 *   - IMAGE → imageRecognitionRecords.summary（按 ossFileId）
 *   - AUDIO → asrRecords.summary（按 ossFileId）
 * - 防重：先 select 对应表 summary，已非空直接 return
 * - 并发去重：进程内 inflight Map<materialId, Promise<void>>
 * - 失败重试：3 次（5s/15s/45s 指数退避）
 * - 重试穷尽：caseMaterials.status=FAILED + return（不抛错）
 *
 * 失败不阻塞主流程，仅 logger.warn。
 */
export async function generateMaterialSummaryService(materialId: number): Promise<void> {
    const existing = inflight.get(materialId)
    if (existing) return existing

    const task = withLangfuseContext(
        { materialId: String(materialId), vertical: 'material-summary' },
        () => generateMaterialSummaryInner(materialId),
    ).finally(() => inflight.delete(materialId))

    inflight.set(materialId, task)
    return task
}

async function generateMaterialSummaryInner(materialId: number): Promise<void> {
    try {
        const material = await prisma.caseMaterials.findUnique({
            where: { id: materialId },
            select: { id: true, type: true, ossFileId: true },
        })
        if (!material) return

        // 跨命名空间防重：若同 ossFile 已有 OSS 级摘要任务在跑，等它完成再判定
        // （typical 场景：用户在小索/通用问答输入框上传文件触发 OSS 级摘要，
        //   随后点发送创建 caseMaterials 行，中间件再走一次 Material 级；
        //   这里 await 一下让 Material 级直接命中防重早返）
        if (material.ossFileId) {
            const ossPending = ossFileSummaryInflight.get(material.ossFileId)
            if (ossPending) {
                await ossPending.catch(() => { /* 已在内部 catch */ })
            }
        }

        // 按类型读对应识别记录的 summary + content（防重 + 提供 LLM 输入）
        const target = await loadSummaryTarget(material.id, material.type, material.ossFileId)
        if (!target) return  // 识别记录不存在 / 无内容
        if (target.summary) return  // 已有摘要，防重早返
        if (!target.content) return  // 无内容可总结

        const summary = await callSummaryLlm(target.content, { materialId })
        if (!summary) {
            logger.error('Material 摘要 LLM 重试穷尽，标记 caseMaterials.status=FAILED', { materialId })
            await prisma.caseMaterials.update({
                where: { id: materialId },
                data: { status: MaterialStatus.FAILED },
            }).catch(() => { /* 忽略状态写入失败 */ })
            return
        }

        // 写回对应表 summary
        await persistSummary(material.id, material.type, material.ossFileId, summary)
    } catch (e) {
        logger.warn('generateMaterialSummaryService 失败（不阻塞主流程）', { materialId, error: e })
    }
}

interface SummaryTarget {
    summary: string | null
    content: string  // 摘要 LLM 的输入文本（已 slice 到合理长度）
}

async function loadSummaryTarget(
    materialId: number,
    type: number,
    ossFileId: number | null,
): Promise<SummaryTarget | null> {
    if (type === CaseMaterialType.CASE_CONTENT) {
        const r = await findTextContentRecordByMaterialIdDAO(materialId)
        if (!r) return null
        return { summary: r.summary, content: (r.content ?? '').slice(0, 2000) }
    }
    if (!ossFileId) return null
    if (type === CaseMaterialType.DOCUMENT) {
        const r = await findDocRecognitionByOssFileIdDao(ossFileId)
        if (!r || r.status !== 2) return null
        return { summary: r.summary, content: (r.markdownContent ?? '').slice(0, 2000) }
    }
    if (type === CaseMaterialType.IMAGE) {
        const r = await findImageRecognitionByOssFileIdDao(ossFileId)
        if (!r || r.status !== 2) return null
        return { summary: r.summary, content: (r.markdownContent ?? '').slice(0, 2000) }
    }
    if (type === CaseMaterialType.AUDIO) {
        const r = await findAsrRecordByOssFileIdDao(ossFileId)
        if (!r || r.status !== 2) return null
        const transcribed = extractTextFromAsrResult(r.result) ?? ''
        // ASR summary 长度超阈值 = commit aad0e0a1 之前的逐字稿残留：
        // 视为无效，触发重新生成 200 字摘要
        const validSummary = r.summary && r.summary.length <= ASR_SUMMARY_MAX_VALID_CHARS
            ? r.summary
            : null
        return { summary: validSummary, content: transcribed.slice(0, 2000) }
    }
    return null
}

async function persistSummary(
    materialId: number,
    type: number,
    ossFileId: number | null,
    summary: string,
): Promise<void> {
    if (type === CaseMaterialType.CASE_CONTENT) {
        await prisma.textContentRecords.updateMany({
            where: { materialId, deletedAt: null },
            data: { summary },
        })
        return
    }
    if (!ossFileId) return
    if (type === CaseMaterialType.DOCUMENT) {
        const r = await findDocRecognitionByOssFileIdDao(ossFileId)
        if (r) await updateDocRecognitionRecordDao(r.id, { summary })
    } else if (type === CaseMaterialType.IMAGE) {
        const r = await findImageRecognitionByOssFileIdDao(ossFileId)
        if (r) await updateImageRecognitionRecordDao(r.id, { summary })
    } else if (type === CaseMaterialType.AUDIO) {
        const r = await findAsrRecordByOssFileIdDao(ossFileId)
        if (r) await updateAsrRecordDao(r.id, { summary })
    }
}

// ==================== OssFile 级摘要（不依赖 caseMaterials 行）====================

/**
 * 调用 LLM 生成摘要（含 3 次重试 + 节点配置查询）
 *
 * 抽出供 generateMaterialSummary / generateOssFileSummary 共用，避免重复实现。
 * @returns summary 字符串；重试穷尽返回 null（调用方决定后续动作）
 */
async function callSummaryLlm(
    content: string,
    identifier: { ossFileId?: number; materialId?: number },
): Promise<string | null> {
    const config = await getValidNodeConfig('materialAutoSummary', '材料自动摘要')
    const apiKey = config.modelApiKeys.find(k => k.status === 1)?.apiKey
    if (!apiKey) {
        logger.warn('materialAutoSummary 节点无可用 API Key', identifier)
        return null
    }
    const systemPrompt = assembleSystemPromptTemplate(config.prompts)
    if (!systemPrompt) {
        logger.warn('materialAutoSummary 节点无 system prompt', identifier)
        return null
    }
    const model = createChatModel({
        sdkType: config.modelSdkType,
        modelName: config.modelName,
        apiKey,
        baseUrl: config.modelProviderBaseUrl,
        temperature: 0,
        streaming: false,
    })

    let lastErr: unknown = null
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt++) {
        try {
            return await generateSummaryService(model, content, {
                maxChars: SUMMARY_MAX_CHARS,
                systemPrompt,
            })
        } catch (e) {
            lastErr = e
            logger.warn(`摘要 LLM 调用第 ${attempt + 1} 次失败`, { ...identifier, error: e })
            if (attempt < RETRY_DELAYS_MS.length) {
                await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]))
            }
        }
    }
    logger.error('摘要 LLM 重试穷尽', { ...identifier, error: lastErr })
    return null
}

interface OssFileSummaryTarget {
    summary: string | null
    content: string
    recordType: 'doc' | 'image' | 'audio'
    recordId: number
}

/**
 * 自动判断 ossFile 对应的识别记录类型（doc / image / audio 三选一）
 * 并返回当前 summary 与可供 LLM 输入的内容文本
 */
async function loadOssFileSummaryTarget(ossFileId: number): Promise<OssFileSummaryTarget | null> {
    const doc = await findDocRecognitionByOssFileIdDao(ossFileId)
    if (doc && doc.status === 2) {
        return {
            summary: doc.summary,
            content: (doc.markdownContent ?? '').slice(0, 2000),
            recordType: 'doc',
            recordId: doc.id,
        }
    }
    const img = await findImageRecognitionByOssFileIdDao(ossFileId)
    if (img && img.status === 2) {
        return {
            summary: img.summary,
            content: (img.markdownContent ?? '').slice(0, 2000),
            recordType: 'image',
            recordId: img.id,
        }
    }
    const asr = await findAsrRecordByOssFileIdDao(ossFileId)
    if (asr && asr.status === 2) {
        const transcribed = extractTextFromAsrResult(asr.result) ?? ''
        // 旧逐字稿过滤（与 loadSummaryTarget 保持一致）
        const validSummary = asr.summary && asr.summary.length <= ASR_SUMMARY_MAX_VALID_CHARS
            ? asr.summary
            : null
        return {
            summary: validSummary,
            content: transcribed.slice(0, 2000),
            recordType: 'audio',
            recordId: asr.id,
        }
    }
    return null
}

async function persistOssFileSummary(
    recordType: 'doc' | 'image' | 'audio',
    recordId: number,
    summary: string,
): Promise<void> {
    if (recordType === 'doc') {
        await updateDocRecognitionRecordDao(recordId, { summary })
    } else if (recordType === 'image') {
        await updateImageRecognitionRecordDao(recordId, { summary })
    } else {
        await updateAsrRecordDao(recordId, { summary })
    }
}

/**
 * 按 ossFileId 生成识别记录表的 200 字摘要（不依赖 caseMaterials 行）
 *
 * 与 generateMaterialSummaryService 的差异：
 * - 不依赖 caseMaterials 行（小索/通用问答输入框选文件即触发场景）
 * - 自动判断 ossFile 对应识别记录类型（doc / image / audio）
 * - 失败穷尽时不写 caseMaterials.status=FAILED（可能没有 caseMaterials 行；
 *   后续 generateMaterialSummaryService 会兜底标记）
 * - 独立 inflight Map（key=ossFileId）；与 Material 级跨命名空间防重通过
 *   generateMaterialSummaryInner 入口 await 实现
 *
 * 文字材料（CASE_CONTENT）不走这个函数——textContentRecords 必然伴随 caseMaterials，
 * 直接走 generateMaterialSummaryService 即可。
 *
 * 失败不阻塞主流程，仅 logger.warn。
 */
export async function generateOssFileSummaryService(ossFileId: number): Promise<void> {
    const existing = ossFileSummaryInflight.get(ossFileId)
    if (existing) return existing

    const task = withLangfuseContext(
        { ossFileId: String(ossFileId), vertical: 'material-summary' },
        () => generateOssFileSummaryInner(ossFileId),
    ).finally(() => ossFileSummaryInflight.delete(ossFileId))

    ossFileSummaryInflight.set(ossFileId, task)
    return task
}

async function generateOssFileSummaryInner(ossFileId: number): Promise<void> {
    try {
        const target = await loadOssFileSummaryTarget(ossFileId)
        if (!target) return  // 识别记录不存在或未成功
        if (target.summary) return  // 已有摘要，防重早返
        if (!target.content) return  // 无内容可总结

        const summary = await callSummaryLlm(target.content, { ossFileId })
        if (!summary) return  // LLM 重试穷尽，不写 caseMaterials.status

        await persistOssFileSummary(target.recordType, target.recordId, summary)
    } catch (e) {
        logger.warn('generateOssFileSummaryService 失败（不阻塞主流程）', { ossFileId, error: e })
    }
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
                        // 过滤旧 ASR summary 残留（commit aad0e0a1 之前存的是逐字稿）：长度超阈值视为无效
                        if (r.ossFileId && r.summary && r.summary.length <= ASR_SUMMARY_MAX_VALID_CHARS) {
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
