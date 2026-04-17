/**
 * 材料就绪保障 Pipeline
 *
 * 确保案件所有材料已完成识别和嵌入，供中间件和工具复用。
 * 只对未识别的触发识别，只对未嵌入的触发嵌入，避免重复处理。
 */
import { getMaterialsByCaseIdService, getMaterialsByDraftIdService, type MaterialWithFile } from './material.service'
import { batchCheckMaterialEmbeddedService, embedMaterialUnifiedService } from './materialEmbedding.service'
import { processMaterialService, batchCheckMaterialRecognizedService } from './materialProcess.service'
import { CaseMaterialType } from '#shared/types/case'
import { createMaterialDao, findMaterialByIdDao, findMaterialByDraftIdAndOssFileIdDao } from './material.dao'

export interface MaterialFailedItem {
    materialId: number
    name: string
    error: string
}

export interface MaterialReadyResult {
    materials: MaterialWithFile[]
    totalMaterials: number
    alreadyEmbedded: number
    newlyProcessed: number
    embeddedMap: Map<number, boolean>
    failed: MaterialFailedItem[]
}

/** 从 Promise.allSettled 结果中收集失败项 */
function collectSettledFailures<T>(
    results: PromiseSettledResult<T>[],
    materials: MaterialWithFile[],
): MaterialFailedItem[] {
    const failures: MaterialFailedItem[] = []
    for (let i = 0; i < results.length; i++) {
        if (results[i]!.status === 'rejected') {
            const reason = (results[i]! as PromiseRejectedResult).reason
            failures.push({
                materialId: materials[i]!.id,
                name: materials[i]!.name,
                error: reason instanceof Error ? reason.message : String(reason),
            })
        }
    }
    return failures
}

export async function ensureMaterialsReadyService(
    caseId: number,
    userId: number,
): Promise<MaterialReadyResult> {
    // 1. 获取全部材料
    const materials = await getMaterialsByCaseIdService(caseId)
    if (materials.length === 0) {
        return {
            materials: [],
            totalMaterials: 0,
            alreadyEmbedded: 0,
            newlyProcessed: 0,
            embeddedMap: new Map(),
            failed: [],
        }
    }

    const failed: MaterialFailedItem[] = []

    // 2. 识别阶段：检查识别状态，对未识别的触发识别
    const recognizedMap = await batchCheckMaterialRecognizedService(materials)
    const notRecognized = materials.filter(m => !recognizedMap.get(m.id))

    if (notRecognized.length > 0) {
        // 对于异步识别的材料（PDF via MinerU、音频 via ASR），
        // processMaterialService 可能返回 PROCESSING 状态，
        // 后续嵌入会因内容为空而失败，这是预期行为。
        // TODO: 大量材料时考虑添加并发限制（p-limit）
        const recognitionResults = await Promise.allSettled(
            notRecognized.map(material => processMaterialService(material.id, userId))
        )
        failed.push(...collectSettledFailures(recognitionResults, notRecognized))
    }

    // 3. 嵌入阶段：检查嵌入状态，对未嵌入的触发嵌入
    const ids = materials.map(m => m.id)
    const embeddedMap = await batchCheckMaterialEmbeddedService(ids)

    const alreadyEmbedded = materials.filter(m => embeddedMap.get(m.id)).length
    const notEmbedded = materials.filter(m => !embeddedMap.get(m.id))

    let newlyProcessed = 0

    if (notEmbedded.length > 0) {
        // 排除识别阶段已失败的材料（不需要再尝试嵌入）
        const failedIds = new Set(failed.map(f => f.materialId))
        const toEmbed = notEmbedded.filter(m => !failedIds.has(m.id))

        const embeddingResults = await Promise.allSettled(
            toEmbed.map(material => embedMaterialUnifiedService(material.id, userId))
        )

        const embeddingFailures = collectSettledFailures(embeddingResults, toEmbed)
        newlyProcessed = toEmbed.length - embeddingFailures.length
        failed.push(...embeddingFailures)
    }

    // 4. 获取最终嵌入状态
    const finalEmbeddedMap = notEmbedded.length > 0
        ? await batchCheckMaterialEmbeddedService(ids)
        : embeddedMap

    return {
        materials,
        totalMaterials: materials.length,
        alreadyEmbedded,
        newlyProcessed,
        embeddedMap: finalEmbeddedMap,
        failed,
    }
}

// ==================== 材料上下文服务 ====================

export const TOKEN_THRESHOLD = 32000

/** 按材料类型返回向量表中的 sourceId */
export function getSourceId(material: MaterialWithFile): number {
    if (material.type === CaseMaterialType.CASE_CONTENT) {
        return material.id
    }
    return material.ossFileId!
}

/** 简单 token 估算（中文约 2 字符/token，英文约 4 字符/token） */
export function estimateTokens(text: string): number {
    if (!text) return 0
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
    const otherChars = text.length - chineseChars
    return Math.ceil(chineseChars / 2 + otherChars / 4)
}

/**
 * 从各识别记录表获取材料的实际内容
 *
 * caseMaterials 表只有元信息，内容分散在：
 * - 文本(1): textContentRecords.content (按 materialId)
 * - 文档(2): docRecognitionRecords.markdownContent (按 ossFileId)
 * - 图片(3): imageRecognitionRecords.markdownContent (按 ossFileId)
 * - 音频(4): asrRecords.summary (按 ossFileId)，fallback 到 result JSON 提取纯文本
 */

/**
 * 从 ASR result JSON 中提取纯文本（当 summary 为空时的 fallback）
 *
 * 兼容两种格式：
 * - 扁平格式: { sentences: [{ text }] }
 * - SimplifiedAsrResult 嵌套格式: { transcripts: [{ sentences: [{ text }] }] }
 */
export function extractTextFromAsrResult(result: any): string | null {
    if (!result) return null

    // 扁平格式: { sentences: [...] }
    if (result.sentences && Array.isArray(result.sentences)) {
        const text = result.sentences
            .map((s: any) => s.text || '')
            .filter(Boolean)
            .join('\n')
        if (text) return text
    }

    // SimplifiedAsrResult 嵌套格式: { transcripts: [{ sentences: [...] }] }
    if (result.transcripts && Array.isArray(result.transcripts)) {
        const text = result.transcripts
            .flatMap((t: any) => t.sentences || [])
            .map((s: any) => s.text || '')
            .filter(Boolean)
            .join('\n')
        if (text) return text
    }

    // 兜底：直接取 text 字段
    if (typeof result.text === 'string' && result.text.trim()) {
        return result.text
    }

    return null
}

export async function fetchMaterialContents(
    materials: { id: number; type: number; ossFileId: number | null }[]
): Promise<Map<number, string>> {
    const contentMap = new Map<number, string>()

    const textMaterials = materials.filter(m => m.type === CaseMaterialType.CASE_CONTENT)
    const docMaterials = materials.filter(m => m.type === CaseMaterialType.DOCUMENT && m.ossFileId)
    const imgMaterials = materials.filter(m => m.type === CaseMaterialType.IMAGE && m.ossFileId)
    const audioMaterials = materials.filter(m => m.type === CaseMaterialType.AUDIO && m.ossFileId)

    const queries: Promise<void>[] = []

    // 文本材料：从 textContentRecords 获取
    if (textMaterials.length > 0) {
        queries.push(
            prisma.textContentRecords.findMany({
                where: {
                    materialId: { in: textMaterials.map(m => m.id) },
                    content: { not: null },
                    deletedAt: null,
                },
                select: { materialId: true, content: true },
            }).then(records => {
                for (const r of records) {
                    if (r.materialId && r.content) {
                        contentMap.set(r.materialId, r.content)
                    }
                }
            })
        )
    }

    // 文档材料：从 docRecognitionRecords 获取
    if (docMaterials.length > 0) {
        const ossFileIdToMaterialId = new Map(docMaterials.map(m => [m.ossFileId!, m.id]))
        queries.push(
            prisma.docRecognitionRecords.findMany({
                where: {
                    ossFileId: { in: [...ossFileIdToMaterialId.keys()] },
                    markdownContent: { not: null },
                    deletedAt: null,
                },
                select: { ossFileId: true, markdownContent: true },
                orderBy: { createdAt: 'desc' },
            }).then(records => {
                const seen = new Set<number>()
                for (const r of records) {
                    if (r.ossFileId && r.markdownContent && !seen.has(r.ossFileId)) {
                        seen.add(r.ossFileId)
                        const materialId = ossFileIdToMaterialId.get(r.ossFileId)
                        if (materialId) contentMap.set(materialId, r.markdownContent)
                    }
                }
            })
        )
    }

    // 图片材料：从 imageRecognitionRecords 获取
    if (imgMaterials.length > 0) {
        const ossFileIdToMaterialId = new Map(imgMaterials.map(m => [m.ossFileId!, m.id]))
        queries.push(
            prisma.imageRecognitionRecords.findMany({
                where: {
                    ossFileId: { in: [...ossFileIdToMaterialId.keys()] },
                    markdownContent: { not: null },
                    deletedAt: null,
                },
                select: { ossFileId: true, markdownContent: true },
                orderBy: { createdAt: 'desc' },
            }).then(records => {
                const seen = new Set<number>()
                for (const r of records) {
                    if (r.ossFileId && r.markdownContent && !seen.has(r.ossFileId)) {
                        seen.add(r.ossFileId)
                        const materialId = ossFileIdToMaterialId.get(r.ossFileId)
                        if (materialId) contentMap.set(materialId, r.markdownContent)
                    }
                }
            })
        )
    }

    // 音频材料：从 asrRecords 获取（优先 summary，fallback 到 result 文本）
    if (audioMaterials.length > 0) {
        const ossFileIdToMaterialId = new Map(audioMaterials.map(m => [m.ossFileId!, m.id]))
        queries.push(
            prisma.asrRecords.findMany({
                where: {
                    ossFileId: { in: [...ossFileIdToMaterialId.keys()] },
                    status: 2, // SUCCESS
                    deletedAt: null,
                },
                select: { ossFileId: true, summary: true, result: true },
                orderBy: { createdAt: 'desc' },
            }).then(records => {
                const seen = new Set<number>()
                for (const r of records) {
                    if (r.ossFileId && !seen.has(r.ossFileId)) {
                        // 优先使用 summary（已格式化的转录文本）
                        // fallback：从 result JSON 提取纯文本
                        const content = r.summary || extractTextFromAsrResult(r.result)
                        if (content) {
                            seen.add(r.ossFileId)
                            const materialId = ossFileIdToMaterialId.get(r.ossFileId)
                            if (materialId) contentMap.set(materialId, content)
                        }
                    }
                }
            })
        )
    }

    await Promise.all(queries)
    return contentMap
}

// ==================== 上下文构建 ====================

/** 材料类型优先级：数值越高越优先注入全文 */
export const MATERIAL_PRIORITY: Record<number, number> = {
    1: 10, // CASE_CONTENT — 最高
    2: 8,  // DOCUMENT — 核心证据
    3: 5,  // IMAGE — 辅助
    4: 3,  // AUDIO — 通常较长
}

export interface MaterialContextItem {
    sourceId: number
    name: string
    type: number
    hasContent: boolean
    /** 当前条目的注入模式：全文或摘要 */
    mode: 'full' | 'summary'
    content?: string
    summary?: string
}

export interface MaterialContextResult {
    mode: 'full' | 'summary' | 'graded' | 'empty'
    totalTokens: number
    materialList: MaterialContextItem[]
}

export async function getMaterialContextService(
    materials: MaterialWithFile[],
    tokenBudget: number = TOKEN_THRESHOLD,
): Promise<MaterialContextResult> {
    if (materials.length === 0) {
        return { mode: 'empty', totalTokens: 0, materialList: [] }
    }

    const contentMap = await fetchMaterialContents(materials)

    // 按优先级降序排列，保证高价值材料优先获得全文预算
    const sorted = [...materials].sort(
        (a, b) => (MATERIAL_PRIORITY[b.type] || 0) - (MATERIAL_PRIORITY[a.type] || 0),
    )

    let usedTokens = 0
    let allFull = true
    let allSummary = true
    const materialList: MaterialContextItem[] = []

    // 逐份材料累加 token：预算内注入全文，超出后注入摘要
    for (const m of sorted) {
        const content = contentMap.get(m.id)
        if (!content) {
            materialList.push({
                sourceId: getSourceId(m),
                name: m.name,
                type: m.type,
                hasContent: false,
                mode: 'summary',
                summary: `[材料: ${m.name}，暂无内容]`,
            })
            allFull = false
            continue
        }

        const tokens = estimateTokens(content)
        if (usedTokens + tokens <= tokenBudget) {
            materialList.push({
                sourceId: getSourceId(m),
                name: m.name,
                type: m.type,
                hasContent: true,
                mode: 'full',
                content,
            })
            usedTokens += tokens
            allSummary = false
        } else {
            // 超出预算 → 降级为摘要
            materialList.push({
                sourceId: getSourceId(m),
                name: m.name,
                type: m.type,
                hasContent: true,
                mode: 'summary',
                summary: m.summary || content.substring(0, 200) + '...',
            })
            allFull = false
        }
    }

    // 为需要摘要但尚无摘要（仅有截断文本）的材料批量生成摘要并缓存
    const needSummaryItems = materialList.filter(
        item => item.mode === 'summary' && item.hasContent && item.summary?.endsWith('...'),
    )
    if (needSummaryItems.length > 0) {
        const needSourceIds = new Set(needSummaryItems.map(item => item.sourceId))
        const sourceIdToMaterial = new Map(sorted.map(m => [getSourceId(m), m]))
        const needSummaryMaterials = sorted.filter(m => needSourceIds.has(getSourceId(m)))
        try {
            const { generateAndCacheSummaries } = await import('./materialSummary.service')
            const generatedMap = await generateAndCacheSummaries(needSummaryMaterials, contentMap)
            for (const item of needSummaryItems) {
                const material = sourceIdToMaterial.get(item.sourceId)
                if (material && generatedMap.has(material.id)) {
                    item.summary = generatedMap.get(material.id)!
                }
            }
        } catch (error) {
            logger.warn('材料摘要批量生成失败，回退到截断模式', { error })
        }
    }

    const mode = allFull ? 'full' : allSummary ? 'summary' : 'graded'
    return { mode, totalTokens: usedTokens, materialList }
}

function formatMaterialList(items: MaterialContextItem[]): { stats: string; body: string } {
    const fullCount = items.filter(m => m.mode === 'full').length
    const summaryCount = items.filter(m => m.mode === 'summary').length
    const stats = `共 ${items.length} 份，${fullCount} 份全文 + ${summaryCount} 份摘要`
    const body = items
        .map(m => m.mode === 'full'
            ? `## [sourceId=${m.sourceId}] ${m.name} [全文]\n${m.content || '[暂无内容]'}`
            : `## [sourceId=${m.sourceId}] ${m.name} [摘要]\n${m.summary || '[暂无摘要]'}`)
        .join('\n\n')
    return { stats, body }
}

export function buildMaterialContextMessage(context: MaterialContextResult): string {
    if (context.mode === 'empty') return ''
    const { stats, body } = formatMaterialList(context.materialList)
    const header = `以下是本案件的材料内容（${stats}）。\n摘要材料需要详细内容时请使用 search_case_materials 工具，传入 sourceId 精确检索。\n`
    return header + '\n' + body
}

export function buildIncrementalMaterialMessage(context: MaterialContextResult): string {
    if (context.mode === 'empty') return ''
    const { stats, body } = formatMaterialList(context.materialList)
    const header = `案件新增了以下材料（${stats}）。\n摘要材料需要详细内容时请使用 search_case_materials 工具，传入 sourceId 精确检索。\n`
    return header + '\n' + body
}

// ==================== 材料检索服务 ====================

import { Document } from '@langchain/core/documents'
import {
    similaritySearchWithScore,
} from '~~/server/services/legal/vectorStore.service'
import {
    caseMaterialVectorConfig,
    type ContentEmbeddingMetadata,
} from './materialEmbedding.service'
import { retrievalRouterService } from '../retrieval/retrievalRouter.service'

export interface MaterialSearchToolResult {
    index: number
    content: string
    source: {
        sourceId: number
        sourceName: string
        chunkIndex?: number
    }
    relevanceScore?: number
}

/**
 * 材料检索核心逻辑（供工具层调用）
 *
 * 支持三种检索模式：
 * - query only: 语义搜索，通过 caseId→sourceId 集合限定范围
 * - query + sourceId: 语义搜索，限定到指定 sourceId
 * - sourceId only: 精确查询完整内容
 */
export async function searchMaterialsService(
    userId: number,
    caseId: number,
    options: { query?: string; sourceId?: number; k?: number },
): Promise<MaterialSearchToolResult[]> {
    const { query, sourceId, k = 5 } = options

    const allMaterials = await getMaterialsByCaseIdService(caseId)

    const targetMaterials = sourceId
        ? allMaterials.filter(m => getSourceId(m) === sourceId)
        : allMaterials

    if (targetMaterials.length === 0) return []

    // 无 query → 精确查询完整内容
    if (!query) {
        const contentMap = await fetchMaterialContents(targetMaterials)
        return targetMaterials.map((m, index) => ({
            index: index + 1,
            content: contentMap.get(m.id) || '[暂无内容]',
            source: {
                sourceId: getSourceId(m),
                sourceName: m.name,
            },
        }))
    }

    // 有 query → 走统一检索路由器
    const sourceIds = targetMaterials.map(m => String(getSourceId(m)))
    const results = await retrievalRouterService({
        query,
        type: 'case_material',
        k,
        metadataFilter: { userId: String(userId) },
        sourceIds,
    })

    return results.map((r, index) => ({
        index: index + 1,
        content: r.content,
        source: {
            sourceId: Number(r.metadata.sourceId),
            sourceName: r.metadata.sourceName as string,
            chunkIndex: r.metadata.chunkIndex as number | undefined,
        },
        relevanceScore: r.score,
    }))
}

// ==================== draftId-based 并行扩展函数 ====================

const POLL_INTERVAL_MS = 1000
const MAX_POLLS = 30 // 30s 超时

/**
 * 基于文书草稿 ID 的材料检索服务（供工具层调用）
 *
 * 与 searchMaterialsService 结构相同，但按 draftId 获取材料范围。
 * - query only: 语义搜索，通过 draftId→sourceId 集合限定范围
 * - sourceId only: 精确查询完整内容
 */
export async function searchMaterialsByDraftService(
    userId: number,
    draftId: number,
    options: { query?: string; sourceId?: number; k?: number },
): Promise<MaterialSearchToolResult[]> {
    const { query, sourceId, k = 5 } = options

    const allMaterials = await getMaterialsByDraftIdService(draftId)

    const targetMaterials = sourceId
        ? allMaterials.filter(m => getSourceId(m) === sourceId)
        : allMaterials

    if (targetMaterials.length === 0) return []

    // 无 query → 精确查询完整内容
    if (!query) {
        const contentMap = await fetchMaterialContents(targetMaterials)
        return targetMaterials.map((m, index) => ({
            index: index + 1,
            content: contentMap.get(m.id) || '[暂无内容]',
            source: {
                sourceId: getSourceId(m),
                sourceName: m.name,
            },
        }))
    }

    // 有 query → 走统一检索路由器
    const sourceIds = targetMaterials.map(m => String(getSourceId(m)))
    const results = await retrievalRouterService({
        query,
        type: 'case_material',
        k,
        metadataFilter: { userId: String(userId) },
        sourceIds,
    })

    return results.map((r, index) => ({
        index: index + 1,
        content: r.content,
        source: {
            sourceId: Number(r.metadata.sourceId),
            sourceName: r.metadata.sourceName as string,
            chunkIndex: r.metadata.chunkIndex as number | undefined,
        },
        relevanceScore: r.score,
    }))
}

/**
 * 单文件材料就绪保障（文书草稿场景）
 *
 * 1. 查询 caseMaterials 是否已有 (draftId + ossFileId) 记录
 * 2. 无则创建（caseId=null, draftId=X）
 * 3. 触发 OCR + embedding pipeline（复用 embedMaterialUnifiedService）
 * 4. 轮询直至 status=processed；30s 超时抛错
 */
export async function ensureMaterialsReadyForDraftService(
    ossFileId: number,
    draftId: number,
    userId: number,
): Promise<{ id: number; status: number; draftId: number | null; ossFileId: number | null }> {
    // 1. 应用层去重：精确查找已有 (draftId, ossFileId) 记录
    const existing = await findMaterialByDraftIdAndOssFileIdDao(draftId, ossFileId)

    let materialId: number

    if (existing) {
        materialId = existing.id
        if (existing.status === 3) {
            return { id: existing.id, status: existing.status, draftId: existing.draftId, ossFileId: existing.ossFileId }
        }
    } else {
        // 2. 创建新材料记录（caseId=null, draftId=X，XOR 保证互斥）
        const ossFile = await prisma.ossFiles.findFirst({
            where: { id: ossFileId, deletedAt: null },
            select: { fileName: true },
        })
        const newMaterial = await createMaterialDao({
            caseId: null,
            draftId,
            ossFileId,
            name: ossFile?.fileName ?? `材料_${ossFileId}`,
            type: CaseMaterialType.DOCUMENT,
        })
        materialId = newMaterial.id

        // 3. 触发 embedding pipeline
        await embedMaterialUnifiedService(materialId, userId)
    }

    // 4. 轮询直至 status=processed（3）
    for (let i = 0; i < MAX_POLLS; i++) {
        const updated = await findMaterialByIdDao(materialId)
        if (updated?.status === 3) {
            return { id: updated.id, status: updated.status, draftId: updated.draftId, ossFileId: updated.ossFileId }
        }
        if (updated?.status === 4) {
            throw new Error(`材料处理失败: ${materialId}`)
        }
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    }

    throw new Error(`材料处理超时: ${materialId}`)
}
