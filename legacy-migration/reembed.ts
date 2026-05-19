/**
 * 案件分析向量重建脚本（迁移后置步骤）
 *
 * 历史数据迁移后 case_analysis_embeddings 表为空——本脚本为迁移来的历史案件分析
 * 补齐语义检索向量，并补全迁移后仍缺失的分析摘要。
 *
 * 为什么不处理案件材料：
 * 材料的识别 / 嵌入 / 摘要由新项目 caseProcessMaterialMiddleware 在每次案件分析或
 * 小索对话启动前自动补齐（ensureMaterialsReadyService，只补缺失项）——迁移材料会自愈，
 * 无需脚本。而 case_analysis_embeddings 只在新分析完成时（completeAnalysisWithRAG）
 * 写入，历史迁移的分析永不会被自动嵌入，必须由本脚本补。
 *
 * 幂等：按 case_analysis_embeddings 是否已含该 analysisId 判断，重跑自动跳过已完成项；
 * 失败项自动重试一轮。
 *
 * 用法（从仓库根目录执行）:
 *   npx tsx legacy-migration/reembed.ts
 *   npx tsx legacy-migration/reembed.ts --limit=10
 *   npx tsx legacy-migration/reembed.ts --concurrency=8
 */

// -----------------------------------------------------------------------
// 初始化全局依赖（模拟 Nuxt 自动导入）——必须在导入服务层模块之前执行
// -----------------------------------------------------------------------

import 'dotenv/config' // 加载仓库根 .env（tsx 不像 bun 那样自动加载）
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client'
import { logger as sharedLogger } from '../shared/utils/logger/index'

function createPrismaClient() {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) throw new Error('DATABASE_URL 环境变量未设置')
    const adapter = new PrismaPg({ connectionString: databaseUrl, options: '-c TimeZone=UTC' })
    return new PrismaClient({ adapter })
}

const g = globalThis as Record<string, unknown>
g.prisma = createPrismaClient()
g.logger = sharedLogger
g.useRuntimeConfig = () => ({
    embedding: {
        apiKey: process.env.NUXT_EMBEDDING_API_KEY || process.env.EMBEDDING_API_KEY,
        baseUrl: process.env.NUXT_EMBEDDING_BASE_URL || process.env.EMBEDDING_BASE_URL,
        model: process.env.NUXT_EMBEDDING_MODEL || process.env.EMBEDDING_MODEL || 'text-embedding-v4',
        dimensions: Number(process.env.NUXT_EMBEDDING_DIMENSIONS || process.env.EMBEDDING_DIMENSIONS || 1536),
        batchSize: Number(process.env.NUXT_EMBEDDING_BATCH_SIZE || process.env.EMBEDDING_BATCH_SIZE || 5),
    },
    public: { logLevel: process.env.LOG_LEVEL || 'INFO' },
})

// -----------------------------------------------------------------------
// 导入服务层（在全局依赖就绪后）
// -----------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import pLimit from 'p-limit'
import { addDocumentsToVectorStore } from '../server/services/legal/vectorStore.service'
import { getValidNodeConfig } from '../server/services/node/node.service'
import { createChatModel } from '../server/services/node/chatModelFactory'
import { assembleSystemPromptTemplate } from '../server/services/agent-platform/nodeConfig/promptRenderer'
import { generateSummaryService } from '../server/services/ai/summaryService'

const prisma = g.prisma as InstanceType<typeof PrismaClient>
const DEFAULT_CONCURRENCY = 5

// -----------------------------------------------------------------------
// 通用工具
// -----------------------------------------------------------------------

/** p-limit 滑动窗口并发执行；worker 返回 false 视为失败，返回失败项列表 */
async function runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    label: string,
    worker: (item: T) => Promise<boolean>,
): Promise<T[]> {
    const limit = pLimit(concurrency)
    let done = 0
    const total = items.length
    const failed: T[] = []
    await Promise.all(items.map(item => limit(async () => {
        let ok = false
        try {
            ok = await worker(item)
        } catch (e) {
            sharedLogger.warn(`[${label}] 处理异常`, { error: e })
        }
        if (!ok) failed.push(item)
        done++
        if (done % 50 === 0 || done === total) sharedLogger.info(`[${label}] 进度 ${done}/${total}`)
    })))
    return failed
}

/** 并发执行 + 失败重试一轮 */
async function runWithRetry<T>(
    items: T[],
    concurrency: number,
    label: string,
    worker: (item: T) => Promise<boolean>,
): Promise<void> {
    if (items.length === 0) {
        sharedLogger.info(`[${label}] 无待处理项`)
        return
    }
    let failed = await runWithConcurrency(items, concurrency, label, worker)
    if (failed.length > 0) {
        sharedLogger.info(`[${label}] 第二轮重试 ${failed.length} 项`)
        failed = await runWithConcurrency(failed, concurrency, `${label}-重试`, worker)
    }
    sharedLogger.info(`[${label}] 完成：成功 ${items.length - failed.length} / 失败 ${failed.length}`)
    if (failed.length > 0) sharedLogger.warn(`[${label}] 最终失败项：${JSON.stringify(failed).slice(0, 500)}`)
}

/** 按段落切块（\n\n 分隔，每块最多 maxChars）——与 initAnalysis.service.ts 一致 */
function splitByParagraph(text: string, maxChars: number): string[] {
    const paras = text.split(/\n\n+/).filter(p => p.trim())
    const chunks: string[] = []
    let current = ''
    for (const p of paras) {
        if ((current + p).length > maxChars) {
            if (current) chunks.push(current)
            current = p
        } else {
            current = current ? `${current}\n\n${p}` : p
        }
    }
    if (current) chunks.push(current)
    return chunks
}

const isBlank = (s: string | null | undefined) => s == null || s.trim() === ''

// -----------------------------------------------------------------------
// 案件分析重嵌入 + 缺失摘要补全
// -----------------------------------------------------------------------

/** 一次性加载 analysisSummary 节点的摘要模型；配置不全返回 null（跳过摘要补全） */
async function loadAnalysisSummaryModel(): Promise<{ model: any; systemPrompt: string } | null> {
    try {
        const cfg = await getValidNodeConfig('analysisSummary', '案件分析结果摘要')
        const apiKey = cfg.modelApiKeys.find(k => k.status === 1)?.apiKey
        const systemPrompt = assembleSystemPromptTemplate(cfg.prompts)
        if (!apiKey || !systemPrompt) {
            sharedLogger.warn('analysisSummary 节点配置不完整，跳过分析摘要补全')
            return null
        }
        const model = createChatModel({
            sdkType: cfg.modelSdkType,
            modelName: cfg.modelName,
            apiKey,
            baseUrl: cfg.modelProviderBaseUrl,
            temperature: 0,
            streaming: false,
        })
        return { model, systemPrompt }
    } catch (e) {
        sharedLogger.warn('获取 analysisSummary 节点失败，跳过分析摘要补全', { error: e })
        return null
    }
}

async function processAnalyses(concurrency: number, limit?: number): Promise<void> {
    sharedLogger.info('===== 案件分析重嵌入 + 摘要补全 =====')

    // 已嵌入的 analysisId（幂等：重跑跳过）
    const embeddedRows = await prisma.$queryRawUnsafe<{ aid: string }[]>(
        `SELECT DISTINCT metadata->>'analysisId' AS aid
         FROM case_analysis_embeddings
         WHERE metadata->>'analysisId' IS NOT NULL`,
    )
    const embeddedIds = new Set(embeddedRows.map(r => Number(r.aid)))

    let analyses = await prisma.caseAnalyses.findMany({
        where: { deletedAt: null, status: 2, analysisResult: { not: null } },
        select: {
            id: true, caseId: true, nodeId: true, analysisType: true,
            version: true, isActive: true, analysisResult: true, summary: true,
        },
        orderBy: { id: 'asc' },
    })
    if (limit) analyses = analyses.slice(0, limit)

    const todo = analyses.filter(a => !embeddedIds.has(a.id) || isBlank(a.summary))
    sharedLogger.info(
        `分析共 ${analyses.length}，待处理 ${todo.length}`
        + `（待嵌入 ${analyses.filter(a => !embeddedIds.has(a.id)).length} / 待补摘要 ${analyses.filter(a => isBlank(a.summary)).length}）`,
    )

    const summaryModel = await loadAnalysisSummaryModel()

    await runWithRetry(todo, concurrency, '分析', async (a): Promise<boolean> => {
        const content = a.analysisResult ?? ''

        // 补摘要（仅缺失才补；失败不阻塞嵌入）
        if (isBlank(a.summary) && summaryModel) {
            try {
                const truncated = content.length > 8000
                    ? `${content.slice(0, 8000)}\n\n[内容过长已截断]`
                    : content
                const summary = await generateSummaryService(summaryModel.model, truncated, {
                    maxChars: 400,
                    systemPrompt: summaryModel.systemPrompt,
                })
                if (summary) {
                    await prisma.caseAnalyses.update({ where: { id: a.id }, data: { summary } })
                }
            } catch (e) {
                sharedLogger.warn(`分析 ${a.id} 摘要补全失败`, { error: e })
            }
        }

        // 重嵌入（切块写 case_analysis_embeddings——与 initAnalysis Stage 2 一致）
        if (!embeddedIds.has(a.id)) {
            const chunks = splitByParagraph(content, 500)
            if (chunks.length === 0) return true // 无正文可嵌
            const ids = chunks.map(() => randomUUID())
            const docs = chunks.map((chunk, i) => ({
                pageContent: chunk,
                metadata: {
                    id: ids[i],
                    caseId: a.caseId,
                    analysisId: a.id,
                    nodeId: a.nodeId,
                    analysisType: a.analysisType,
                    version: a.version,
                    isActive: a.isActive,
                    chunkIndex: i,
                },
            }))
            await addDocumentsToVectorStore(docs, ids, { tableName: 'case_analysis_embeddings' })
            // 手工回填 tsv（addDocuments 不写 tsv 列）
            await prisma.$executeRawUnsafe(
                `UPDATE case_analysis_embeddings
                 SET tsv = to_tsvector('chinese', COALESCE(text, ''))
                 WHERE id = ANY($1::uuid[]) AND tsv IS NULL`,
                ids,
            )
        }
        return true
    })
}

// -----------------------------------------------------------------------
// 入口
// -----------------------------------------------------------------------

async function main(): Promise<void> {
    const args = process.argv.slice(2)
    const concurrencyStr = args.find(a => a.startsWith('--concurrency='))?.split('=')[1]
    const concurrency = concurrencyStr ? parseInt(concurrencyStr, 10) : DEFAULT_CONCURRENCY
    const limitStr = args.find(a => a.startsWith('--limit='))?.split('=')[1]
    const limit = limitStr ? parseInt(limitStr, 10) : undefined

    sharedLogger.info(`案件分析向量重建：concurrency=${concurrency}${limit ? ` limit=${limit}` : ''}`)

    try {
        await processAnalyses(concurrency, limit)
        sharedLogger.info('===== 案件分析向量重建完成 =====')
        process.exit(0)
    } catch (error) {
        sharedLogger.error('脚本执行失败:', error)
        process.exit(1)
    } finally {
        await prisma.$disconnect()
    }
}

main()
