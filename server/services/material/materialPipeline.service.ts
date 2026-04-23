/**
 * 材料就绪保障 Pipeline
 *
 * 确保案件所有材料已完成识别和嵌入，供中间件和工具复用。
 * 只对未识别的触发识别，只对未嵌入的触发嵌入，避免重复处理。
 */
import { getMaterialByIdService, getMaterialsByCaseIdService, getMaterialsByCaseOrDraftIdService, getMaterialsByDraftIdService, updateMaterialStatusService, generateMaterialSummaryService, type MaterialWithFile } from './material.service'
import { batchCheckMaterialEmbeddedService, embedMaterialUnifiedService } from './materialEmbedding.service'
import { processMaterialService, batchCheckMaterialRecognizedService, MaterialProcessError } from './materialProcess.service'
import { CaseMaterialType, getMaterialTypeFromMime } from '#shared/types/case'
import { MaterialStatus } from '#shared/types/material'
import { createMaterialDao, findMaterialByIdDao, findActiveMaterialByOssFileIdDao } from './material.dao'
import { countTokensSync } from '~~/server/utils/tokenCounter'

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

/**
 * 公共「识别 → 嵌入 → 复查」三阶段流水线。
 *
 * 抽给 ensureMaterialsReadyService（caseId）/ ensureMaterialsReadyByDraftService（draftId）
 * 复用，差异仅在材料来源；本函数只看 materials 列表。
 *
 * - 异步识别（PDF MinerU / 音频 ASR）会返回 PROCESSING，调用方约定后续轮询
 * - 识别失败的材料不再尝试嵌入（避免空内容嵌入）
 * - initialFailed 用于把上游 per-file 预处理产生的失败项一起带入结果
 */
async function runRecognitionAndEmbeddingPipeline(
    materials: MaterialWithFile[],
    userId: number,
    initialFailed: MaterialFailedItem[] = [],
): Promise<MaterialReadyResult> {
    if (materials.length === 0) {
        return {
            materials: [],
            totalMaterials: 0,
            alreadyEmbedded: 0,
            newlyProcessed: 0,
            embeddedMap: new Map(),
            failed: initialFailed,
        }
    }

    const failed: MaterialFailedItem[] = [...initialFailed]

    // 识别阶段：检查识别状态，对未识别的触发识别
    const recognizedMap = await batchCheckMaterialRecognizedService(materials)
    const notRecognized = materials.filter(m => !recognizedMap.get(m.id))
    if (notRecognized.length > 0) {
        // TODO: 大量材料时考虑添加并发限制（p-limit）
        const recognitionResults = await Promise.allSettled(
            notRecognized.map(material => processMaterialService(material.id, userId)),
        )
        failed.push(...collectSettledFailures(recognitionResults, notRecognized))
    }

    // 嵌入阶段：检查嵌入状态，对未嵌入的触发嵌入
    const ids = materials.map(m => m.id)
    const embeddedMap = await batchCheckMaterialEmbeddedService(ids)
    const alreadyEmbedded = materials.filter(m => embeddedMap.get(m.id)).length
    const notEmbedded = materials.filter(m => !embeddedMap.get(m.id))

    let newlyProcessed = 0
    const finalEmbeddedMap = new Map(embeddedMap)
    if (notEmbedded.length > 0) {
        // 排除识别阶段已失败的材料（不需要再尝试嵌入）
        const failedIds = new Set(failed.map(f => f.materialId))
        const toEmbed = notEmbedded.filter(m => !failedIds.has(m.id))

        const embeddingResults = await Promise.allSettled(
            toEmbed.map(material => embedMaterialUnifiedService(material.id, userId)),
        )
        const embeddingFailures = collectSettledFailures(embeddingResults, toEmbed)
        const embeddingFailedIds = new Set(embeddingFailures.map(f => f.materialId))
        for (const m of toEmbed) {
            if (!embeddingFailedIds.has(m.id)) finalEmbeddedMap.set(m.id, true)
        }
        newlyProcessed = toEmbed.length - embeddingFailures.length
        failed.push(...embeddingFailures)
    }

    return {
        materials,
        totalMaterials: materials.length,
        alreadyEmbedded,
        newlyProcessed,
        embeddedMap: finalEmbeddedMap,
        failed,
    }
}

export async function ensureMaterialsReadyService(
    caseId: number,
    userId: number,
): Promise<MaterialReadyResult> {
    const materials = await getMaterialsByCaseIdService(caseId)
    return runRecognitionAndEmbeddingPipeline(materials, userId)
}

/**
 * 文书草稿批处理：按 draftId 扫描关联材料并确保识别+嵌入。
 *
 * 与 ensureMaterialsReadyService 对偶（后者按 caseId），用于文书生成 Agent 的
 * process_materials 工具 draftId 分支。
 *
 * 可选 fileIds 参数：
 * - 不传 → 扫 draft 下现有 caseMaterials 全部
 * - 传 → 仅处理指定 OSS 文件。若这些 fileId 尚未绑定到 draft（用户刚在输入框选的新文件），
 *   会自动通过 ensureMaterialsReadyForDraftService 建立 (draftId, ossFileId) 记录并触发
 *   完整识别+嵌入+轮询流水线；随后再按处理后的全量 caseMaterials 走统一识别/嵌入补齐。
 *
 * @param draftId 文书草稿 ID
 * @param userId 调用用户
 * @param options.fileIds 可选：仅处理这些 OSS 文件
 * @param options.caseId 可选：草稿所属案件 ID，传入后每个 fileId 会透传给单文件 pipeline 实现 case/draft 双绑
 */
export async function ensureMaterialsReadyByDraftService(
    draftId: number,
    userId: number,
    options: { fileIds?: number[]; caseId?: number | null } = {},
): Promise<MaterialReadyResult> {
    const initialFailed: MaterialFailedItem[] = []
    const caseId = options.caseId ?? null

    // 1. 对于用户新选的 fileIds，先走单文件 pipeline 保证 caseMaterials 行存在且跑完
    //    （ensureMaterialsReadyForDraftService 内部幂等，已 COMPLETED 会立即返回）
    if (options.fileIds && options.fileIds.length > 0) {
        const perFileResults = await Promise.allSettled(
            options.fileIds.map(fid => ensureMaterialsReadyForDraftService(fid, draftId, userId, caseId)),
        )
        for (let i = 0; i < perFileResults.length; i++) {
            const r = perFileResults[i]!
            if (r.status === 'rejected') {
                initialFailed.push({
                    materialId: 0,
                    name: `ossFile_${options.fileIds[i]}`,
                    error: r.reason instanceof Error ? r.reason.message : String(r.reason),
                })
            }
        }
    }

    // 2. 拉取 draft 全量材料（或仅过滤出本次关心的 ossFileId），交给共享流水线
    const allMaterials = await getMaterialsByDraftIdService(draftId)
    const materials = options.fileIds && options.fileIds.length > 0
        ? allMaterials.filter(m => m.ossFileId != null && options.fileIds!.includes(m.ossFileId))
        : allMaterials

    return runRecognitionAndEmbeddingPipeline(materials, userId, initialFailed)
}

// ==================== 材料上下文服务 ====================

/**
 * 材料上下文 token 预算阈值（tiktoken 估算）
 * 小于此阈值全文返回；超过则切到 graded/summary 模式。
 * 预算保守设置为 15K，给 system prompt、工具定义、历史消息及模型输出留足余量。
 */
export const TOKEN_THRESHOLD = 15000

/** 按材料类型返回向量表中的 sourceId */
export function getSourceId(material: MaterialWithFile): number {
    if (material.type === CaseMaterialType.CASE_CONTENT) {
        return material.id
    }
    return material.ossFileId!
}

/**
 * Token 估算：统一走 tiktoken (cl100k_base)，tiktoken 初始化失败时自动回退到字符估算。
 *
 * 调用 countTokensSync 而非字符估算，避免中文/JSON 结构序列化后 token 数被严重低估，
 * 进而导致 TOKEN_THRESHOLD 形同虚设（材料上下文仍可能把模型窗口撑爆）。
 */
export function estimateTokens(text: string): number {
    if (!text) return 0
    return countTokensSync(text)
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

/**
 * @deprecated M2 起改用 getMaterialListWithSummariesService（清单+摘要）；
 * 全文召回通过 search_case_materials 工具按需执行。
 * 此函数仅在合同审查等需要全文的场景中保留。
 */
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

    // 索引模式占位文案（用于预算完全耗尽时，仅告知 AI 该材料存在）
    const INDEX_ONLY_HINT = '[材料索引，请使用 search_case_materials 工具按关键字检索完整内容]'
    const indexOnlyTokens = estimateTokens(INDEX_ONLY_HINT)

    // 逐份材料按三档分配预算：
    // 1) full  — 全文（content）
    // 2) summary — 摘要（summary 字段或内容前 200 字）
    // 3) index — 只保留名称/类型占位，AI 需通过 search_case_materials 按需调档
    // summary 分支也必须累加实际 tokens，否则 totalTokens 与返回 payload 严重不符。
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

        const fullTokens = estimateTokens(content)
        if (usedTokens + fullTokens <= tokenBudget) {
            materialList.push({
                sourceId: getSourceId(m),
                name: m.name,
                type: m.type,
                hasContent: true,
                mode: 'full',
                content,
            })
            usedTokens += fullTokens
            allSummary = false
            continue
        }

        // 超出全文预算 → 尝试降级为摘要
        const summaryText = m.summary || content.substring(0, 200) + '...'
        const summaryTokens = estimateTokens(summaryText)
        if (usedTokens + summaryTokens <= tokenBudget) {
            materialList.push({
                sourceId: getSourceId(m),
                name: m.name,
                type: m.type,
                hasContent: true,
                mode: 'summary',
                summary: summaryText,
            })
            usedTokens += summaryTokens
            allFull = false
            continue
        }

        // 摘要也超预算 → 降级为索引模式（名称 + 占位文案）
        materialList.push({
            sourceId: getSourceId(m),
            name: m.name,
            type: m.type,
            hasContent: true,
            mode: 'summary',
            summary: INDEX_ONLY_HINT,
        })
        usedTokens += indexOnlyTokens
        allFull = false
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
 * 在已选定 materials 集合内执行检索（共享实现）。
 *
 * 三种模式：
 * - 无 query → 精确返回每份材料的完整内容
 * - 有 query / sourceId → 走统一检索路由器做向量召回
 *
 * sourceId 作 in-memory 过滤，对小集合（< 几十份材料）够用；上游 case/draft
 * 入口分别按各自维度拉取材料后再调用本函数。
 */
async function searchWithinMaterialsService(
    userId: number,
    materials: MaterialWithFile[],
    options: { query?: string; sourceId?: number; k?: number },
): Promise<MaterialSearchToolResult[]> {
    const { query, sourceId, k = 5 } = options

    const targetMaterials = sourceId
        ? materials.filter(m => getSourceId(m) === sourceId)
        : materials

    if (targetMaterials.length === 0) return []

    // 无 query → 精确查询完整内容
    // 浏览模式（无 query + 无 sourceId）按 k 限流避免一次返回过多材料；
    // 精确查询（指定 sourceId）只会命中单份材料，k 不再生效。
    if (!query) {
        const limitedMaterials = sourceId ? targetMaterials : targetMaterials.slice(0, k)
        const contentMap = await fetchMaterialContents(limitedMaterials)
        return limitedMaterials.map((m, index) => ({
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
    const allMaterials = await getMaterialsByCaseIdService(caseId)
    return searchWithinMaterialsService(userId, allMaterials, options)
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
    const allMaterials = await getMaterialsByDraftIdService(draftId)
    return searchWithinMaterialsService(userId, allMaterials, options)
}

/**
 * 按 caseId 或 draftId 合并检索材料（search_case_materials 工具用）
 *
 * 合并 caseId/draftId 两个范围的材料后走相同的 embedding retrieval / 精确查询逻辑。
 * Prisma OR 查询天然对同一条记录去重。
 */
export async function searchMaterialsByCaseOrDraftService(
    userId: number,
    ids: { caseId: number | null; draftId: number | null },
    options: { query?: string; sourceId?: number; k?: number },
): Promise<MaterialSearchToolResult[]> {
    if (ids.caseId == null && ids.draftId == null) return []
    const allMaterials = await getMaterialsByCaseOrDraftIdService(ids.caseId, ids.draftId)
    return searchWithinMaterialsService(userId, allMaterials, options)
}

/**
 * 单文件材料就绪保障（文书草稿场景）
 *
 * 1. 按 (draftId, ossFileId) 去重查询或创建 caseMaterials 记录
 *    - 新建时按 ossFiles.fileType(MIME) 推断 materialType，避免硬编码 DOCUMENT 导致音频/图片走错分支
 * 2. 调用 processMaterialService 触发完整识别 + 嵌入 + 状态机
 *    - 已识别文件会命中幂等分支（如 PDF 的 taskId==='existing'），同步完成
 *    - 异步场景（MinerU/ASR）返回 PROCESSING，由下方轮询等待
 * 3. 轮询 caseMaterials.status 直至 COMPLETED(3) / FAILED(4)；超时抛错
 */
export async function ensureMaterialsReadyForDraftService(
    ossFileId: number,
    draftId: number,
    userId: number,
    caseId?: number | null,
): Promise<{ id: number; status: number; draftId: number | null; ossFileId: number | null }> {
    // 查重：按 ossFileId 找活跃记录，避免同一 ossFile 产生多条记录
    // 安全性由 ossFiles.userId 单 owner 保证（调用方传入的 ossFileId 必属当前 user）
    const existing = await findActiveMaterialByOssFileIdDao(ossFileId)

    let materialId: number

    if (existing) {
        materialId = existing.id

        // 按需补齐缺失字段：case-only → 补 draftId；draft-only → 补 caseId；双绑 → 无变更
        const patch: Partial<{ caseId: number; draftId: number }> = {}
        if (caseId != null && existing.caseId == null) {
            patch.caseId = caseId
        } else if (caseId != null && existing.caseId != null && existing.caseId !== caseId) {
            // 异常场景：ossFile 已绑定到另一 case（当前业务不会发生），记警告但不覆盖
            logger.warn('case_materials caseId 冲突，保留原值不覆盖', {
                materialId: existing.id,
                existingCaseId: existing.caseId,
                incomingCaseId: caseId,
            })
        }
        if (existing.draftId !== draftId) {
            if (existing.draftId != null) {
                // 异常场景：同 case 下两个活跃 draft 用同文件，后写赢
                logger.warn('case_materials draftId 被覆盖', {
                    materialId: existing.id,
                    oldDraftId: existing.draftId,
                    newDraftId: draftId,
                })
            }
            patch.draftId = draftId
        }
        if (Object.keys(patch).length > 0) {
            await prisma.caseMaterials.update({ where: { id: existing.id }, data: patch })
        }

        // 已 COMPLETED 直接返回（跳过识别）
        if (existing.status === MaterialStatus.COMPLETED) {
            return { id: existing.id, status: existing.status, draftId, ossFileId: existing.ossFileId }
        }
    } else {
        const ossFile = await prisma.ossFiles.findFirst({
            where: { id: ossFileId, deletedAt: null },
            select: { fileName: true, fileType: true },
        })
        if (!ossFile) {
            throw new Error(`OSS 文件不存在: ${ossFileId}`)
        }
        const materialType = getMaterialTypeFromMime(ossFile.fileType)
        const newMaterial = await createMaterialDao({
            caseId: caseId ?? null,
            draftId,
            ossFileId,
            name: ossFile.fileName ?? `材料_${ossFileId}`,
            type: materialType,
        })
        materialId = newMaterial.id
    }

    // 跨 draft 复用：该 ossFile 已识别且已嵌入（lastEmbeddingAt 命中），
    // 直接置当前 caseMaterial 为 COMPLETED，跳过 processMaterialService，
    // 避免重复识别 + 重复写向量。
    const materialDetail = await getMaterialByIdService(materialId)
    if (materialDetail) {
        const [recognizedMap, embeddedMap] = await Promise.all([
            batchCheckMaterialRecognizedService([materialDetail]),
            batchCheckMaterialEmbeddedService([materialId]),
        ])
        if (recognizedMap.get(materialId) && embeddedMap.get(materialId)) {
            if (materialDetail.status !== MaterialStatus.COMPLETED) {
                await updateMaterialStatusService(materialId, MaterialStatus.COMPLETED)
            }
            // 异步触发摘要生成（fire-and-forget，失败不阻塞）
            generateMaterialSummaryService(materialId).catch(() => { /* 已在内部 catch */ })
            return {
                id: materialId,
                status: MaterialStatus.COMPLETED,
                draftId: materialDetail.draftId,
                ossFileId: materialDetail.ossFileId,
            }
        }
    }

    // 触发识别 + 嵌入（内部负责状态机 PENDING→PROCESSING→COMPLETED/FAILED）
    // 已是 PROCESSING/COMPLETED 会抛 code=400，属正常幂等情况，交给后续轮询判定
    try {
        await processMaterialService(materialId, userId)
    } catch (err) {
        if (!(err instanceof MaterialProcessError) || err.code !== 400) {
            throw err
        }
    }

    // 轮询直至终态
    for (let i = 0; i < MAX_POLLS; i++) {
        const updated = await findMaterialByIdDao(materialId)
        if (updated?.status === MaterialStatus.COMPLETED) {
            return { id: updated.id, status: updated.status, draftId: updated.draftId, ossFileId: updated.ossFileId }
        }
        if (updated?.status === MaterialStatus.FAILED) {
            throw new Error(`材料处理失败: ${materialId}`)
        }
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    }

    throw new Error(`材料处理超时: ${materialId}`)
}

/**
 * 返回案件材料清单 + 摘要（供 moduleContextBuilder ⑤ 段使用）
 * 不返回全文；全文请通过 search_case_materials 工具按需召回。
 */
export async function getMaterialListWithSummariesService(caseId: number): Promise<Array<{
    id: number
    name: string
    type: number
    summary: string | null
}>> {
    return prisma.caseMaterials.findMany({
        where: { caseId, deletedAt: null, status: 3 /* COMPLETED */ },
        select: { id: true, name: true, type: true, summary: true },
        orderBy: { createdAt: 'asc' },
    })
}
